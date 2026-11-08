export interface FeeInfo {
  /** 买入（认购/主动积存）费率，百分比数值；0 表示免收 */
  buyPct?: number;
  /** 卖出（赎回）费率 */
  sellPct?: number;
  /** 口径说明 */
  note: string;
  /** 该费率的核实日期，费率会随银行活动变动 */
  asOf: string;
}

/**
 * 京东接口不返回费率字段，这里只能放人工核实的公开报道值。
 * 未列出的银行只查到"有优惠"但没查到具体数字，宁可显示未知也不要编。
 */
export const PRODUCT_FEES: Record<string, FeeInfo> = {
  GS: { buyPct: 0, sellPct: undefined, note: '主动积存与定投 0 手续费（赎回费率未见公开数字）', asOf: '2026-10-20' },
  ZS: { buyPct: 0, sellPct: 0.4, note: '免认购费；赎回按赎回金额 0.4%', asOf: '2026-11-05' },
  NJ: { buyPct: 0.05, note: '买入 0.05%，仅江苏/北京/上海/杭州客户', asOf: '2026-10-20' },
  MS: { note: '公开报道仅称有费率优惠，未给出具体数字，以银行 App 为准', asOf: '2026-10-20' },
  GF: { note: '公开报道仅称有费率优惠，未给出具体数字，以银行 App 为准', asOf: '2026-10-20' },
  XY: { note: '公开报道仅称有费率优惠，未给出具体数字，以银行 App 为准', asOf: '2026-10-20' },
  ZX: { note: '公开报道仅称有费率优惠，未给出具体数字，以银行 App 为准', asOf: '2026-10-20' },
  AU9999: { note: '账户金成本主要体现为点差，未见单独手续费口径', asOf: '2026-11-05' },
  AU9995: { note: '账户金成本主要体现为点差，未见单独手续费口径', asOf: '2026-11-05' },
  JJC: { note: '费率以银行公告为准', asOf: '2026-11-05' },
};

export function feeOf(symbol: string): FeeInfo | undefined {
  return PRODUCT_FEES[symbol];
}

/** 面板短显示：买/卖费率，未知用 — */
export function feeShortText(symbol: string): string {
  const fee = PRODUCT_FEES[symbol];
  if (!fee || (fee.buyPct === undefined && fee.sellPct === undefined)) return '—';
  const part = (value?: number) => (value === undefined ? '—' : `${value}%`);
  return `${part(fee.buyPct)}/${part(fee.sellPct)}`;
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
