import { formatPct, formatPrice } from './format.ts';
import { formatGrams } from './calculator.ts';
import type { PortfolioSummary } from './calculator.ts';
import type { Quote } from './types.ts';
import type { QuoteStore } from './store.ts';

/** 组合持仓规则用这个保留品种码，不会和真实行情品种冲突 */
export const PORTFOLIO_SYMBOL = 'PORTFOLIO';

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
  /** 组合浮盈达到该百分比触发 */
  pnlPctAbove?: number;
  /** 组合浮亏达到该百分比触发（存正数，比较时取负） */
  pnlPctBelow?: number;
  /** 组合浮盈达到该金额触发 */
  pnlAmountAbove?: number;
  /** 组合浮亏达到该金额触发（存正数，比较时取负） */
  pnlAmountBelow?: number;
  cooldownMinutes: number;
}

export interface FiredAlert {
  ruleId: string;
  symbol: string;
  title: string;
  body: string;
}

/** 提醒方向：到价上穿、到价下穿、当日涨跌幅、组合浮盈/浮亏 */
export type RuleKind =
  | 'above'
  | 'below'
  | 'swing'
  | 'pnlPctAbove'
  | 'pnlPctBelow'
  | 'pnlAmountAbove'
  | 'pnlAmountBelow';

export const RULE_KIND_ORDER: RuleKind[] = [
  'above',
  'below',
  'swing',
  'pnlPctAbove',
  'pnlPctBelow',
  'pnlAmountAbove',
  'pnlAmountBelow',
];

export const RULE_KIND_TEXT: Record<RuleKind, string> = {
  above: '涨到 ≥',
  below: '跌到 ≤',
  swing: '当日 ±%',
  pnlPctAbove: '浮盈 ≥',
  pnlPctBelow: '浮亏 ≤',
  pnlAmountAbove: '浮盈额 ≥',
  pnlAmountBelow: '浮亏额 ≤',
};

export const RULE_KIND_UNIT: Record<RuleKind, string> = {
  above: '元/克',
  below: '元/克',
  swing: '%',
  pnlPctAbove: '%',
  pnlPctBelow: '%',
  pnlAmountAbove: '元',
  pnlAmountBelow: '元',
};

/** 冷却按方向给：到价每次重新穿越都要提醒，不设冷却；涨跌幅与盈亏波动本来就该隔久一点 */
export const RULE_COOLDOWN_MINUTES: Record<RuleKind, number> = {
  above: 0,
  below: 0,
  swing: 60,
  pnlPctAbove: 180,
  pnlPctBelow: 180,
  pnlAmountAbove: 180,
  pnlAmountBelow: 180,
};

/** 组合盈亏规则不绑定具体银行，统一走保留品种码 */
export function isPortfolioKind(kind: RuleKind): boolean {
  return kind.startsWith('pnl');
}

/** 面板和 VS Code 用同一套 id：`品种-方向`，换方向就是另一条规则 */
export function ruleIdOf(symbol: string, kind: RuleKind): string {
  return `${symbol}-${kind}`;
}

/** 从已有规则反推方向，供两端回填下拉 */
export function ruleKindOf(rule: AlertRule): RuleKind {
  if (rule.pnlPctAbove !== undefined) return 'pnlPctAbove';
  if (rule.pnlPctBelow !== undefined) return 'pnlPctBelow';
  if (rule.pnlAmountAbove !== undefined) return 'pnlAmountAbove';
  if (rule.pnlAmountBelow !== undefined) return 'pnlAmountBelow';
  if (rule.above !== undefined) return 'above';
  if (rule.below !== undefined) return 'below';
  return 'swing';
}

/** 面板回填阈值：方向和值一起给，避免外壳自己 switch 字段 */
export function ruleValueOf(rule: AlertRule): number | undefined {
  const kind = ruleKindOf(rule);
  switch (kind) {
    case 'above':
      return rule.above;
    case 'below':
      return rule.below;
    case 'swing':
      return rule.absDayChangePct;
    case 'pnlPctAbove':
      return rule.pnlPctAbove;
    case 'pnlPctBelow':
      return rule.pnlPctBelow;
    case 'pnlAmountAbove':
      return rule.pnlAmountAbove;
    default:
      return rule.pnlAmountBelow;
  }
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
    const kind: RuleKind = RULE_KIND_ORDER.includes(row.kind as RuleKind) ? (row.kind as RuleKind) : 'below';
    // 组合盈亏规则固定用保留品种码，避免和某家银行绑在一起
    const symbol = isPortfolioKind(kind)
      ? PORTFOLIO_SYMBOL
      : typeof row.symbol === 'string'
        ? row.symbol.trim()
        : '';
    if (!symbol) continue;
    // 到价/涨跌幅规则不能挂到组合上，否则永远匹配不到行情
    if (!isPortfolioKind(kind) && symbol === PORTFOLIO_SYMBOL) continue;
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
    else if (kind === 'swing') rule.absDayChangePct = value;
    else if (kind === 'pnlPctAbove') rule.pnlPctAbove = value;
    else if (kind === 'pnlPctBelow') rule.pnlPctBelow = value;
    else if (kind === 'pnlAmountAbove') rule.pnlAmountAbove = value;
    else rule.pnlAmountBelow = value;
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
  // 伦敦金按美元/盎司报价，提醒里要带单位，避免和元/克混在一起
  const unit = quote.currency === 'USD' ? ' 美元/盎司' : '';
  const unitNote = quote.currency === 'USD' ? '（美元/盎司）' : '';
  const stamp = `现价 ${formatPrice(price)} · 卖出价 ${formatPrice(quote.sellPrice)} · 点差 ${formatPrice(quote.spread)}${unitNote}`;

  if (rule.above !== undefined && price >= rule.above) {
    return `${quote.name} 涨到 ${formatPrice(price)}${unit}|阈值 ${formatPrice(rule.above)}${unit} · ${stamp}`;
  }
  if (rule.below !== undefined && price <= rule.below) {
    return `${quote.name} 跌到 ${formatPrice(price)}${unit}|阈值 ${formatPrice(rule.below)}${unit} · ${stamp}`;
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
        `|现价 ${formatPrice(price)}${unit} · 触发线 ±${rule.absDayChangePct}%`
      );
    }
  }
  return null;
}

/** 只在条件由假变真的那一轮触发（上升沿）。价格长期停在同一侧不重复提醒。 */
function fireOnEdge(
  rule: AlertRule,
  hit: string | null,
  store: QuoteStore,
  now: number,
): FiredAlert | null {
  const previous = store.lastRuleState(rule.id);
  if (hit === null) {
    if (previous !== false) store.setRuleState(rule.id, false);
    return null;
  }
  let fired: FiredAlert | null = null;
  // 到价不设冷却：价格回到阈值另一侧后再次穿越就是新的一次机会，不能因为上次提醒过就吞掉。
  // 已保存的规则里可能是旧版 120 分钟冷却，这里按方向覆盖，不依赖文件里的值。
  const cooldownMinutes = rule.above !== undefined || rule.below !== undefined ? 0 : rule.cooldownMinutes;
  // previous === undefined 是首次求值，静默记下状态；已经为 true 说明本轮仍在同一次穿越里
  if (previous === false && store.canFire(rule.id, now, cooldownMinutes)) {
    const [title, body] = hit.split('|');
    fired = { ruleId: rule.id, symbol: rule.symbol, title, body };
    store.markFired(rule.id, now);
  }
  if (previous !== true) store.setRuleState(rule.id, true);
  return fired;
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
    const alert = fireOnEdge(rule, matchRule(rule, quote, store, now), store, now);
    if (alert) fired.push(alert);
  }

  return fired;
}

function signedPrice(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatPrice(value)}`;
}

function portfolioStamp(summary: PortfolioSummary): string {
  const pct = summary.pnlPct === null ? '' : `（${formatPct(summary.pnlPct)}）`;
  return (
    `浮动盈亏 ${signedPrice(summary.pnl)}${pct}` +
    ` · 持仓 ${formatGrams(summary.grams)} · 成本 ${formatPrice(summary.cost)} · 市值 ¥${formatPrice(summary.value)}`
  );
}

function matchPortfolioRule(rule: AlertRule, summary: PortfolioSummary): string | null {
  // 缺价或已清仓时不算盈亏，避免拿不完整的合计误报
  if (!summary.complete || summary.grams <= 0) return null;
  const pnl = summary.pnl;
  const pct = summary.pnlPct;
  const stamp = portfolioStamp(summary);

  if (rule.pnlPctAbove !== undefined && pct !== null && pct >= rule.pnlPctAbove) {
    return `组合持仓 浮盈 ${formatPct(pct)}|${stamp} · 触发线 +${rule.pnlPctAbove}%`;
  }
  if (rule.pnlPctBelow !== undefined && pct !== null && pct <= -rule.pnlPctBelow) {
    return `组合持仓 浮亏 ${formatPct(pct)}|${stamp} · 触发线 -${rule.pnlPctBelow}%`;
  }
  if (rule.pnlAmountAbove !== undefined && pnl >= rule.pnlAmountAbove) {
    return `组合持仓 浮盈 ${signedPrice(pnl)}|${stamp} · 触发线 +${formatPrice(rule.pnlAmountAbove)} 元`;
  }
  if (rule.pnlAmountBelow !== undefined && pnl <= -rule.pnlAmountBelow) {
    return `组合持仓 浮亏 ${signedPrice(pnl)}|${stamp} · 触发线 -${formatPrice(rule.pnlAmountBelow)} 元`;
  }
  return null;
}

/** 组合盈亏规则没有具体行情品种，轮询后拿整个组合的汇总单独求值 */
export function evaluatePortfolioRules(
  rules: AlertRule[],
  summary: PortfolioSummary | null,
  store: QuoteStore,
  now = Date.now(),
): FiredAlert[] {
  const fired: FiredAlert[] = [];
  for (const rule of rules) {
    if (!rule.enabled || rule.symbol !== PORTFOLIO_SYMBOL) continue;
    const hit = summary ? matchPortfolioRule(rule, summary) : null;
    const alert = fireOnEdge(rule, hit, store, now);
    if (alert) fired.push(alert);
  }
  return fired;
}
