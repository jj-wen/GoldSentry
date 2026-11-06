import type { Quote, QuoteSource } from '../types.ts';

const FEED_URL = 'https://wealth.ccb.com/cn/home/news/zhgjs_new.xml';

const VARIETIES: Record<string, { symbol: string; name: string; label: string; basis: Quote['basis'] }> = {
  '01': { symbol: 'AU9999', name: '账户黄金 Au99.99', label: '账户金', basis: 'realtime' },
  '02': { symbol: 'AU9995', name: '账户黄金 Au99.95', label: '账户金95', basis: 'realtime' },
  // 建行把积存金当日价一并塞在账户金 feed 里，每天 10:30 定一次，页面上的 SEC_COD_MAP 不含 23 所以不展示
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
