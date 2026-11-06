export type PriceBasis = 'realtime' | 'dailyFix';

export interface Quote {
  sourceId: string;
  symbol: string;
  /** 完整品种名 */
  name: string;
  /** 中文短名，供状态栏/面板直接显示，避免各端自己维护映射表 */
  label: string;
  currency: 'CNY' | 'USD';
  unit: 'GRAM' | 'OUNCE';
  /** 客户买入价：你买每克付多少 */
  buyPrice: number;
  /** 客户卖出价：你卖每克收多少 */
  sellPrice: number;
  midPrice: number;
  /** 点差 = buyPrice - sellPrice */
  spread: number;
  basis: PriceBasis;
  /** 数据源自带的相对昨收涨跌幅（%）；缺省时由本地当日首笔推算 */
  dayChangePct?: number;
  /** 银行侧报价时间 */
  quotedAt: number;
  /** 本地抓取时间 */
  fetchedAt: number;
}

export interface QuoteSource {
  id: string;
  label: string;
  fetchQuotes(): Promise<Quote[]>;
}
