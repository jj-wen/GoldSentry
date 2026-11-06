import type { Quote, QuoteSource } from '../types.ts';

const FEED_URL = 'https://wealth.ccb.com/cn/home/news/zhgjs_new.xml';

const VARIETIES: Record<string, { symbol: string; name: string; label: string; basis: Quote['basis'] }> = {
  '01': { symbol: 'AU9999', name: '账户黄金 Au99.99', label: '账户金', basis: 'realtime' },
  '02': { symbol: 'AU9995', name: '账户黄金 Au99.95', label: '账户金95', basis: 'realtime' },
  // 官方页面 getGoldStore() 注明「23 = 当日积存价」：该页读的 gjshjjc01.xml 已冻结在 2026-07-27，
  // 而 zhgjs_new.xml 里的 23 仍每日 10:30 更新，所以从这里取。注意买入价 10:30 固定、赎回价盘中仍变，
  // 且 Tms 固定为 10:30，spread 是混合口径，不能当对称买卖点差。
  '23': { symbol: 'JJC', name: '黄金积存（当日定价）', label: '建行日价', basis: 'dailyFix' },
};

const BLOCK = /<ReferencePriceSettlement\b[\s\S]*?<\/ReferencePriceSettlement>/g;

function field(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : '';
}

function parseBeijingTime(raw: string): number {
  const normalized = raw.includes('.') ? raw : `${raw}.000`;
  return Date.parse(`${normalized.replace(' ', 'T')}+08:00`);
}

export function parseAccountGoldXml(xml: string, fetchedAt = Date.now()): Quote[] {
  const quotes: Quote[] = [];
  for (const block of xml.match(BLOCK) ?? []) {
    const code = field(block, 'PM_Txn_Vrty_Cd');
    const variety = VARIETIES[code];
    if (!variety) continue;

    const ccyCd = field(block, 'CcyCd');
    const buyPrice = Number(field(block, 'Cst_Buy_Prc'));
    const sellPrice = Number(field(block, 'Cst_Sell_Prc'));
    const midPrice = Number(field(block, 'MdlRate'));
    if (!Number.isFinite(buyPrice) || !Number.isFinite(sellPrice)) continue;

    quotes.push({
      sourceId: 'ccb',
      symbol: variety.symbol,
      name: variety.name,
      label: variety.label,
      currency: ccyCd === '840' ? 'USD' : 'CNY',
      unit: ccyCd === '840' ? 'OUNCE' : 'GRAM',
      buyPrice,
      sellPrice,
      midPrice,
      spread: Number((buyPrice - sellPrice).toFixed(4)),
      basis: variety.basis,
      quotedAt: parseBeijingTime(field(block, 'Tms')),
      fetchedAt,
    });
  }
  return quotes;
}

export const ccbSource: QuoteSource = {
  id: 'ccb',
  label: '建行账户贵金属 / 积存金',
  async fetchQuotes() {
    const res = await globalThis.fetch(FEED_URL, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
        referer: 'https://wealth.ccb.com/chn/home/gjs_sp/scxq/index.shtml',
      },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`ccb feed http ${res.status}`);
    return parseAccountGoldXml(await res.text());
  },
};
