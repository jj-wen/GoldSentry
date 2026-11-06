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
