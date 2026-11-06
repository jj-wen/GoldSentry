import { formatPrice } from './format.ts';
import type { Quote } from './types.ts';
import type { QuoteStore } from './store.ts';

export interface AlertRule {
  id: string;
  symbol: string;
  enabled: boolean;
  /** 客户买入价涨到该值触发 */
  above?: number;
  /** 客户买入价跌到该值触发 */
  below?: number;
  /** 相对当日首笔的涨跌幅绝对值达到该百分比触发 */
  absDayChangePct?: number;
  cooldownMinutes: number;
}

export interface FiredAlert {
  ruleId: string;
  symbol: string;
  title: string;
  body: string;
}

/** 提醒方向：到价上穿、到价下穿、当日涨跌幅绝对值 */
export type RuleKind = 'above' | 'below' | 'swing';

export const RULE_KIND_ORDER: RuleKind[] = ['above', 'below', 'swing'];

export const RULE_KIND_TEXT: Record<RuleKind, string> = {
  above: '涨到 ≥',
  below: '跌到 ≤',
  swing: '当日 ±%',
};

export const RULE_KIND_UNIT: Record<RuleKind, string> = {
  above: '元/克',
  below: '元/克',
  swing: '%',
};

/** 冷却按方向给：到价可以早点再来一次，涨跌幅波动本来就该隔久一点 */
export const RULE_COOLDOWN_MINUTES: Record<RuleKind, number> = {
  above: 120,
  below: 120,
  swing: 60,
};

/** 面板和 VS Code 用同一套 id：`品种-方向`，换方向就是另一条规则 */
export function ruleIdOf(symbol: string, kind: RuleKind): string {
  return `${symbol}-${kind}`;
}

/** 从已有规则反推方向，供两端回填下拉 */
export function ruleKindOf(rule: AlertRule): RuleKind {
  if (rule.above !== undefined) return 'above';
  if (rule.below !== undefined) return 'below';
  return 'swing';
}

/** 面板一行一条，字段全是 DOM 里出来的脏值 */
export interface RuleRow {
  symbol?: string;
  kind?: string;
  value?: unknown;
  enabled?: unknown;
}

/**
 * 把面板提交的行编译成规则：非法阈值直接丢（不写半条规则），
 * 同品种同方向只留第一条，id 与 VS Code 那边写出来的完全一致，两端能共用同一个文件。
 */
export function compileRules(rows: unknown): AlertRule[] {
  if (!Array.isArray(rows)) return [];
  const out: AlertRule[] = [];
  for (const raw of rows) {
    const row = (raw ?? {}) as RuleRow;
    const symbol = typeof row.symbol === 'string' ? row.symbol.trim() : '';
    if (!symbol) continue;
    const kind: RuleKind = RULE_KIND_ORDER.includes(row.kind as RuleKind) ? (row.kind as RuleKind) : 'below';
    const value = typeof row.value === 'number' ? row.value : Number(row.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    const id = ruleIdOf(symbol, kind);
    if (out.some((rule) => rule.id === id)) continue;
    const rule: AlertRule = {
      id,
      symbol,
      enabled: row.enabled !== false,
      cooldownMinutes: RULE_COOLDOWN_MINUTES[kind],
    };
    if (kind === 'above') rule.above = value;
    else if (kind === 'below') rule.below = value;
    else rule.absDayChangePct = value;
    out.push(rule);
  }
  return out;
}

/** 到价一律以「你实际要付的客户买入价」为准，而不是中间价 */
function priceOf(quote: Quote): number {
  return quote.buyPrice;
}

function matchRule(rule: AlertRule, quote: Quote, store: QuoteStore, now: number): string | null {
  const price = priceOf(quote);
  const stamp = `现价 ${formatPrice(price)} · 卖出价 ${formatPrice(quote.sellPrice)} · 点差 ${formatPrice(quote.spread)}`;

  if (rule.above !== undefined && price >= rule.above) {
    return `${quote.name} 涨到 ${formatPrice(price)}|阈值 ${formatPrice(rule.above)} · ${stamp}`;
  }
  if (rule.below !== undefined && price <= rule.below) {
    return `${quote.name} 跌到 ${formatPrice(price)}|阈值 ${formatPrice(rule.below)} · ${stamp}`;
  }
  if (rule.absDayChangePct !== undefined) {
    // 数据源自带的相对昨收涨跌幅优先，它按银行口径算，比本地当日首笔更准
    const fromFeed = quote.dayChangePct;
    const pct =
      fromFeed !== undefined && Number.isFinite(fromFeed)
        ? fromFeed
        : store.dayChangePct(quote.symbol, price, now);
    if (pct !== null && Math.abs(pct) >= rule.absDayChangePct) {
      return (
        `${quote.name} 当日${pct >= 0 ? '涨' : '跌'} ${Math.abs(pct).toFixed(2)}%` +
        `|现价 ${formatPrice(price)} · 触发线 ±${rule.absDayChangePct}%`
      );
    }
  }
  return null;
}

/**
 * 只在条件由假变真的那一轮触发（上升沿）。
 * 价格长期停在阈值同一侧时不重复提醒，否则冷却期一过就刷屏。
 */
export function evaluateRules(
  rules: AlertRule[],
  quote: Quote,
  store: QuoteStore,
  now = Date.now(),
): FiredAlert[] {
  const fired: FiredAlert[] = [];

  for (const rule of rules) {
    if (!rule.enabled || rule.symbol !== quote.symbol) continue;

    const hit = matchRule(rule, quote, store, now);
    const previous = store.lastRuleState(rule.id);

    if (hit === null) {
      if (previous !== false) store.setRuleState(rule.id, false);
      continue;
    }

    // previous === undefined 是首次求值，静默记下状态；已经为 true 说明本轮仍在同一次穿越里
    if (previous === false && store.canFire(rule.id, now, rule.cooldownMinutes)) {
      const [title, body] = hit.split('|');
      fired.push({ ruleId: rule.id, symbol: quote.symbol, title, body });
      store.markFired(rule.id, now);
    }
    if (previous !== true) store.setRuleState(rule.id, true);
  }

  return fired;
}
