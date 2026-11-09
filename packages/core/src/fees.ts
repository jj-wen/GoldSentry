export interface FeeInfo {
  /** 买入（认购/主动积存）费率，百分比数值；0 表示免收 */
  buyPct?: number;
  /** 卖出（赎回）费率 */
  sellPct?: number;
  /** 人工核实的买卖点差（元/克）；上游只给单边价时用它兜底显示 */
  spread?: number;
  /** 只查到区间的点差（如 "4–6"），与 spread 二选一 */
  spreadText?: string;
  /** 口径说明 */
  note: string;
  /** 该费率的核实日期，费率会随银行活动变动 */
  asOf: string;
}

/**
 * 京东接口不返回费率字段，这里只能放人工核实的公开数据。
 * 百分比是费率口径，spread/spreadText 是元/克的点差口径（上游点差为 0 时兜底展示）。
 * 未列出的银行只查到"有优惠"但没查到具体数字，宁可显示未知也不要编。
 */
export const PRODUCT_FEES: Record<string, FeeInfo> = {
  GS: { buyPct: 0.2, sellPct: 0.5, note: '买入 0.2%、卖出 0.5%（用户提供的银行对比表，数据更新至 2026.8）', asOf: '2026-08-31' },
  ZS: { buyPct: 0, sellPct: 0.4, note: '免认购费；赎回按赎回金额 0.4%', asOf: '2026-11-05' },
  NJ: { spread: 2.8, note: '点差 2.8 元/克起（实际点差可能大于 2.8；仅部分产品，对比表数据更新至 2026.8）', asOf: '2026-08-31' },
  MS: { spread: 3.8, note: '实际点差 3.8 元/克（用户核实；对比表列买入 0 / 卖出 0.4%）', asOf: '2026-11-09' },
  GF: { note: '公开报道仅称有费率优惠，未给出具体数字，以银行 App 为准', asOf: '2026-10-20' },
  XY: { spread: 3.8, note: '点差 3.8 元/克（买卖价差，对比表数据更新至 2026.8）', asOf: '2026-08-31' },
  ZX: { spread: 2.7, note: '点差 2.7 元/克（用户核实，以银行 App 为准）', asOf: '2026-11-09' },
  AU9999: { note: '账户金成本主要体现为点差，未见单独手续费口径', asOf: '2026-11-05' },
  AU9995: { note: '账户金成本主要体现为点差，未见单独手续费口径', asOf: '2026-11-05' },
  JJC: { spreadText: '4–6', note: '点差 4–6 元/克（买卖价差；买入价每日 10:30 定价，与实时赎回价混合，不可与实时品种直接对比）', asOf: '2026-08-31' },
};

export function feeOf(symbol: string): FeeInfo | undefined {
  return PRODUCT_FEES[symbol];
}

/** 面板短显示：买/卖费率或人工核实点差，未知用 — */
export function feeShortText(symbol: string): string {
  const fee = PRODUCT_FEES[symbol];
  if (!fee) return '—';
  if (fee.buyPct !== undefined || fee.sellPct !== undefined) {
    const part = (value?: number) => (value === undefined ? '—' : `${value}%`);
    return `${part(fee.buyPct)}/${part(fee.sellPct)}`;
  }
  if (fee.spreadText) return `${fee.spreadText}元`;
  if (fee.spread !== undefined) return `${fee.spread.toFixed(2)}元`;
  return '—';
}

/** 人工核实的费率放久了会失真，超过这个天数就提示重新核对 */
export const FEE_STALE_DAYS = 90;

export function feeAgeDays(asOf: string, now = Date.now()): number | undefined {
  const ts = Date.parse(asOf);
  if (!Number.isFinite(ts)) return undefined;
  return Math.max(0, Math.floor((now - ts) / 86_400_000));
}

export interface FeeCell {
  text: string;
  stale: boolean;
  note: string;
}

/**
 * 只有真的显示出费率数字时才标"待核对"：
 * 本来就查不到数字（显示 —）的品种再标黄只是噪音。
 */
export function feeCell(symbol: string, now = Date.now()): FeeCell {
  const fee = PRODUCT_FEES[symbol];
  const text = feeShortText(symbol);
  const age = fee ? feeAgeDays(fee.asOf, now) : undefined;
  const stale = text !== '—' && age !== undefined && age > FEE_STALE_DAYS;
  const note = fee ? `${fee.note}（截至 ${fee.asOf}）` : '费率未知';
  return {
    text: stale ? `${text} ⚠` : text,
    stale,
    note: stale ? `${note}；已 ${age} 天未核对，请以银行 App 为准` : note,
  };
}
