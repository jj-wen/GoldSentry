import { evaluateRules, type AlertRule, type FiredAlert } from './alerts.ts';
import { formatPct, formatPrice, priceTone, updateAgeText, type PriceTone } from './format.ts';
import type { QuoteStore } from './store.ts';
import type { Quote } from './types.ts';

/** 伦敦金现（XAU/USD）只是参考行情，不混进银行报价，避免影响提醒与计算口径 */
const LONDON_URL = 'https://hq.sinajs.cn/list=hf_XAU,fx_susdcny';
export const LONDON_GOLD_SYMBOL = 'XAU';
export const TROY_OUNCE_GRAMS = 31.1034768;

export interface LondonGold {
  price: number;
  bid: number;
  ask: number;
  prevClose: number;
  dayChangePct: number | undefined;
  quotedAt: number;
  fetchedAt: number;
  usdCny: number | undefined;
  /** 按在岸汇率折算的元/克，汇率缺失时为 undefined */
  cnyPerGram: number | undefined;
}

export interface LondonGoldView {
  name: string;
  price: number;
  priceText: string;
  priceInput: string;
  pctText: string;
  tone: PriceTone;
  unitText: string;
  cnyText: string;
  cnyInput: string;
  fxText: string;
  updateText: string;
}

function num(raw: string | undefined): number | undefined {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 新浪返回的日期与时间都是北京时间 */
function beijingTimestamp(dateKey: string | undefined, timeText: string | undefined, now: number): number {
  if (!dateKey || !timeText) return now;
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute, second] = timeText.split(':').map(Number);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return now;
  return Date.UTC(year, month - 1, day, hour, minute, second) - 8 * 3_600_000;
}

function fieldOf(text: string, variable: string): string[] | null {
  const match = text.match(new RegExp(`hq_str_${variable}="([^"]*)"`));
  return match ? match[1].split(',') : null;
}

/**
 * 新浪外盘字段：0 现价、2 买价、3 卖价、4 最高、5 最低、6 时间、7 昨收、8 开盘、12 日期。
 * 汇率字段 8 为现价（在岸），缺失时退回 1。
 */
export function parseLondonGold(text: string, now = Date.now()): LondonGold {
  const gold = fieldOf(text, 'hf_XAU');
  if (!gold) throw new Error('新浪伦敦金返回为空');

  const price = num(gold[0]);
  if (price === undefined) throw new Error('新浪伦敦金价格无效');
  const bid = num(gold[2]) ?? price;
  const ask = num(gold[3]) ?? price;
  const prevClose = num(gold[7]) ?? price;
  const quotedAt = beijingTimestamp(gold[12], gold[6], now);

  const fx = fieldOf(text, 'fx_susdcny');
  const usdCny = fx ? (num(fx[8]) ?? num(fx[1])) : undefined;

  return {
    price,
    bid,
    ask,
    prevClose,
    dayChangePct: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : undefined,
    quotedAt,
    fetchedAt: now,
    usdCny,
    cnyPerGram: usdCny === undefined ? undefined : (price * usdCny) / TROY_OUNCE_GRAMS,
  };
}

export async function fetchLondonGold(): Promise<LondonGold> {
  const res = await globalThis.fetch(LONDON_URL, {
    headers: {
      referer: 'https://finance.sina.com.cn/',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`新浪伦敦金 http ${res.status}`);
  // 响应是 GBK，但这里只取数字字段，中文品种名由本地常量提供
  return parseLondonGold(await res.text());
}

/** 面板只贴字符串，单位与折算都在 core 里定 */
export function londonGoldView(gold: LondonGold, now = Date.now()): LondonGoldView {
  return {
    name: '伦敦金',
    price: gold.price,
    priceText: formatPrice(gold.price),
    priceInput: formatPrice(gold.price),
    pctText: formatPct(gold.dayChangePct),
    tone: priceTone(gold.dayChangePct),
    unitText: '美元/盎司',
    cnyText: gold.cnyPerGram === undefined ? '汇率未知，暂不折算' : `≈ ${formatPrice(gold.cnyPerGram)} 元/克`,
    cnyInput: gold.cnyPerGram === undefined ? '' : formatPrice(gold.cnyPerGram),
    fxText: gold.usdCny === undefined ? '' : `在岸汇率 ${gold.usdCny.toFixed(4)}`,
    updateText: updateAgeText(gold.quotedAt, 'realtime', now),
  };
}

export type LondonConvertField = 'usdOz' | 'cnyGram';

export interface LondonConversion {
  usdOz: number;
  cnyGram: number;
  /** 展示用算式，常量与结果都用同一份数值，避免和右侧结果对不上 */
  formula: string;
}

/** 详情页换算器：任意一边输入，另一边按当前在岸汇率换算 */
export function convertLondonGold(
  value: number,
  field: LondonConvertField,
  usdCny: number,
): LondonConversion | null {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(usdCny) || usdCny <= 0) return null;
  const usdOz = field === 'cnyGram' ? (value * TROY_OUNCE_GRAMS) / usdCny : value;
  const cnyGram = field === 'cnyGram' ? value : (value * usdCny) / TROY_OUNCE_GRAMS;
  const formula =
    field === 'cnyGram'
      ? `${formatPrice(value)} 元/克 × ${TROY_OUNCE_GRAMS} ÷ ${usdCny.toFixed(4)} ≈ ${formatPrice(usdOz)} 美元/盎司`
      : `${formatPrice(value)} 美元/盎司 × ${usdCny.toFixed(4)} ÷ ${TROY_OUNCE_GRAMS} ≈ ${formatPrice(cnyGram)} 元/克`;
  return { usdOz, cnyGram, formula };
}

/** 国内银行买入价相对伦敦金折算价的溢价，正数表示银行更贵 */
export function londonPremium(
  bankBuyPrice: number,
  cnyPerGram: number,
): { amount: number; pct: number } | null {
  if (
    !Number.isFinite(bankBuyPrice) ||
    !Number.isFinite(cnyPerGram) ||
    bankBuyPrice <= 0 ||
    cnyPerGram <= 0
  ) {
    return null;
  }
  return { amount: bankBuyPrice - cnyPerGram, pct: ((bankBuyPrice - cnyPerGram) / cnyPerGram) * 100 };
}

/** 伦敦金规则单独求值：阈值按美元/盎司，和银行报价共用同一套上升沿与推送 */
export function evaluateLondonGoldRules(
  rules: AlertRule[],
  gold: LondonGold,
  store: QuoteStore,
  now = Date.now(),
): FiredAlert[] {
  const quote: Quote = {
    sourceId: 'sina',
    symbol: LONDON_GOLD_SYMBOL,
    name: '伦敦金',
    label: '伦敦金',
    currency: 'USD',
    unit: 'OUNCE',
    buyPrice: gold.price,
    sellPrice: gold.bid,
    midPrice: gold.price,
    spread: Math.max(0, gold.ask - gold.bid),
    basis: 'realtime',
    dayChangePct: gold.dayChangePct,
    quotedAt: gold.quotedAt,
    fetchedAt: gold.fetchedAt,
  };
  return evaluateRules(rules, quote, store, now);
}
