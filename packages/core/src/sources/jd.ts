import type { Quote, QuoteSource } from '../types.ts';

const BATCH_URL = 'https://api.jdjygold.com/gw2/generic/hj/h5/m/cfBatchGetLatestPriceInfo';

/** sku 与银行的对应关系取自京东黄金频道页 bundle 里写死的映射表 */
const PRODUCTS: Record<string, { symbol: string; name: string; label: string }> = {
  '1961543816': { symbol: 'ZS', name: '浙商积存金', label: '浙商' },
  '21001001000001': { symbol: 'MS', name: '民生积存金', label: '民生' },
  '2005453243': { symbol: 'GS', name: '工商积存金', label: '工商' },
  '2024345112': { symbol: 'GF', name: '广发积存金', label: '广发' },
  '2039007297': { symbol: 'XY', name: '兴业积存金', label: '兴业' },
  '2045976593': { symbol: 'ZX', name: '中信积存金', label: '中信' },
};

// 纯数字对象键会被 JS 按数值升序枚举，21001001000001 会掉到最后，所以顺序单独写死
const SKU_ORDER = [
  '1961543816',
  '21001001000001',
  '2005453243',
  '2024345112',
  '2039007297',
  '2045976593',
];

export const JD_PRODUCT_SKUS = SKU_ORDER;

/** 当前监测的品种代号，供外壳清理已下线品种的历史采样 */
export const JD_SYMBOLS = SKU_ORDER.map((sku) => PRODUCTS[sku].symbol);

interface BatchRow {
  productSku: string;
  buyPrice?: string;
  sellPrice?: string;
  upAndDownRate?: string;
  time?: string;
}

function toNumber(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/** 接口把涨跌幅写成 "+1.86%"，带正负号和百分号后缀 */
function toPct(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw.replace(/[+%＋]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function parseBatchPrice(payload: unknown, fetchedAt = Date.now()): Quote[] {
  const rows = (payload as { resultData?: { code?: string; data?: BatchRow[] } })
    ?.resultData;
  if (rows?.code !== '00000000' || !Array.isArray(rows.data)) {
    throw new Error(`jd batch 返回异常: ${JSON.stringify(payload).slice(0, 160)}`);
  }

  // 接口返回顺序不稳定（民生常排在最后），按 SKU_ORDER 输出，默认民生第二
  const bySku = new Map(rows.data.map((row) => [row.productSku, row]));
  const quotes: Quote[] = [];
  for (const sku of SKU_ORDER) {
    const row = bySku.get(sku);
    if (!row) continue;
    const product = PRODUCTS[sku];
    const buyPrice = toNumber(row.buyPrice);
    const sellPrice = toNumber(row.sellPrice);
    if (!Number.isFinite(buyPrice)) continue;

    quotes.push({
      sourceId: 'jd',
      symbol: product.symbol,
      name: product.name,
      label: product.label,
      currency: 'CNY',
      unit: 'GRAM',
      buyPrice,
      sellPrice: Number.isFinite(sellPrice) ? sellPrice : buyPrice,
      midPrice: (buyPrice + (Number.isFinite(sellPrice) ? sellPrice : buyPrice)) / 2,
      spread: Number.isFinite(sellPrice)
        ? Number((buyPrice - sellPrice).toFixed(4))
        : 0,
      basis: 'realtime',
      dayChangePct: toPct(row.upAndDownRate),
      quotedAt: toNumber(row.time) || fetchedAt,
      fetchedAt,
    });
  }
  return quotes;
}

export const jdSource: QuoteSource = {
  id: 'jd',
  label: '京东金融代销积存金（浙商/民生/工商/广发/兴业/中信）',
  async fetchQuotes() {
    const res = await globalThis.fetch(BATCH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://m.jdjygold.com',
        referer: 'https://m.jdjygold.com/',
        'user-agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
      body: JSON.stringify({ productSkus: JD_PRODUCT_SKUS }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`jd batch http ${res.status}`);
    return parseBatchPrice(await res.json());
  },
};
