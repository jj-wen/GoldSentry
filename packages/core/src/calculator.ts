import { formatPct, formatPrice, priceTone } from './format.ts';
import type { PriceTone } from './format.ts';

/** 一笔买入/卖出记录：成本、均价与盈亏只在这里算，外壳只负责展示 */
export type CalcSide = 'buy' | 'sell';

export interface CalcRecord {
  id: string;
  side: CalcSide;
  /** 记录所属银行（行情品种码） */
  symbol: string;
  /** YYYY-MM-DD，按本地自然日记账 */
  date: string;
  grams: number;
  /** 元/克 */
  price: number;
  createdAt: number;
}

export interface CalcSelection {
  grams: number;
  cost: number;
  avgPrice: number | null;
}

export interface CalcLedger {
  /** 当前持仓克数 */
  grams: number;
  /** 剩余持仓成本 */
  cost: number;
  avgCost: number | null;
  /** 已卖出部分的盈亏（移动加权平均口径） */
  realized: number;
  /** 卖出超过当时持仓：脏数据或删记录造成，展示时要提示 */
  invalid: boolean;
  invalidNote: string;
}

export interface CalcEstimate {
  value: number;
  pnl: number;
  pnlPct: number | null;
  tone: PriceTone;
}

const EPSILON = 1e-6;

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function validDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** 表单日期也走同一套校验，避免 2026-02-31 这种字符串混进来 */
export function isCalcDate(text: string): boolean {
  return validDate(text);
}

/** 克数最多三位小数；7.000 显示 7g，0.500 显示 0.5g */
export function formatGrams(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const text = round(value, 3)
    .toFixed(3)
    .replace(/\.?0+$/, '');
  return `${text || '0'}g`;
}

/** 落盘数据可能被手改：只收完整合法的记录，脏数据直接丢弃；旧记录用 fallbackSymbol 迁移 */
export function normalizeCalcRecords(raw: unknown, fallbackSymbol = ''): CalcRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: CalcRecord[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Partial<CalcRecord>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const side = record.side === 'buy' || record.side === 'sell' ? record.side : null;
    const date = typeof record.date === 'string' ? record.date.trim() : '';
    const symbol = typeof record.symbol === 'string' ? record.symbol.trim() : '';
    const grams = typeof record.grams === 'number' ? round(record.grams, 3) : NaN;
    const price = typeof record.price === 'number' ? round(record.price, 2) : NaN;
    if (!id || ids.has(id) || !side || !validDate(date)) continue;
    if (!Number.isFinite(grams) || grams <= 0) continue;
    if (!Number.isFinite(price) || price < 0) continue;
    ids.add(id);
    out.push({
      id,
      side,
      symbol: symbol || fallbackSymbol,
      date,
      grams,
      price,
      createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
    });
  }
  return out;
}

function groupBySymbol(records: ReadonlyArray<CalcRecord>): Map<string, CalcRecord[]> {
  const groups = new Map<string, CalcRecord[]>();
  for (const record of records) {
    const list = groups.get(record.symbol);
    if (list) list.push(record);
    else groups.set(record.symbol, [record]);
  }
  return groups;
}

export interface SymbolLedger {
  symbol: string;
  ledger: CalcLedger;
}

/** 按银行拆账本；顺序按首次出现，外壳可以再按面板顺序排 */
export function calcLedgersBySymbol(records: ReadonlyArray<CalcRecord>): SymbolLedger[] {
  return [...groupBySymbol(records)].map(([symbol, list]) => ({ symbol, ledger: calcLedger(list) }));
}

function chronological(records: CalcRecord[]): CalcRecord[] {
  return [...records].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}

/** 单笔成本/金额：买入是成本，卖出是回款 */
export function calcAmount(record: CalcRecord): number {
  return record.grams * record.price;
}

/** 选中记录的汇总只统计买入：均价是买入成本口径，卖出不参与 */
export function calcSelection(records: CalcRecord[], ids: string[]): CalcSelection {
  const picked = new Set(ids);
  let grams = 0;
  let cost = 0;
  for (const record of records) {
    if (record.side !== 'buy' || !picked.has(record.id)) continue;
    grams += record.grams;
    cost += record.grams * record.price;
  }
  return { grams, cost, avgPrice: grams > EPSILON ? cost / grams : null };
}

/**
 * 移动加权平均：买入抬成本，卖出按当时的均价扣减成本并结算已实现盈亏。
 * 卖出超过持仓属于不一致数据，这里按可卖部分计算并把问题记在 invalidNote 里。
 */
export function calcLedger(records: CalcRecord[]): CalcLedger {
  let grams = 0;
  let cost = 0;
  let realized = 0;
  let invalid = false;
  let invalidNote = '';

  for (const record of chronological(records)) {
    if (record.side === 'buy') {
      grams += record.grams;
      cost += record.grams * record.price;
      continue;
    }
    if (record.grams > grams + EPSILON && !invalid) {
      invalid = true;
      invalidNote = `${record.date} 卖出 ${formatGrams(record.grams)} 超过当时持仓 ${formatGrams(grams)}`;
    }
    const sold = Math.min(record.grams, grams);
    const avg = grams > EPSILON ? cost / grams : 0;
    realized += sold * record.price - sold * avg;
    cost -= sold * avg;
    grams -= sold;
    if (grams <= EPSILON) {
      grams = 0;
      cost = 0;
    }
  }

  return {
    grams,
    cost,
    avgCost: grams > EPSILON ? cost / grams : null,
    realized,
    invalid,
    invalidNote,
  };
}

/** 单个银行的实时估值 */
export interface PortfolioPosition {
  symbol: string;
  grams: number;
  cost: number;
  avgCost: number | null;
  sellPrice: number | null;
  value: number | null;
  pnl: number | null;
  pnlPct: number | null;
  realized: number;
  invalid: boolean;
  invalidNote: string;
}

export interface PortfolioSummary {
  positions: PortfolioPosition[];
  grams: number;
  cost: number;
  value: number;
  pnl: number;
  /** 只有所有持仓银行都拿到卖出价时才给出百分比 */
  pnlPct: number | null;
  realized: number;
  /** false 表示有持仓银行缺实时卖出价，合计只覆盖已定价部分 */
  complete: boolean;
  invalid: boolean;
  invalidNote: string;
}

/**
 * 组合持仓：按银行拆账本后，用各自实时卖出价估值。
 * 卖超持仓只影响对应银行，不会把别的银行算乱。
 */
export function portfolioSummary(
  records: ReadonlyArray<CalcRecord>,
  sellPrices: Record<string, number | undefined>,
): PortfolioSummary | null {
  if (!records.length) return null;
  const positions: PortfolioPosition[] = [];
  let grams = 0;
  let cost = 0;
  let value = 0;
  let pnl = 0;
  let realized = 0;
  let complete = true;
  let invalid = false;
  let invalidNote = '';

  for (const [symbol, list] of groupBySymbol(records)) {
    const ledger = calcLedger(list);
    const price = sellPrices[symbol];
    const hasPrice = typeof price === 'number' && Number.isFinite(price) && price > 0;
    const valueOf = ledger.grams > EPSILON ? (hasPrice ? ledger.grams * (price as number) : null) : 0;
    const pnlOf = valueOf === null ? null : valueOf - ledger.cost;

    positions.push({
      symbol,
      grams: ledger.grams,
      cost: ledger.cost,
      avgCost: ledger.avgCost,
      sellPrice: hasPrice ? (price as number) : null,
      value: valueOf,
      pnl: pnlOf,
      pnlPct: pnlOf !== null && ledger.cost > EPSILON ? (pnlOf / ledger.cost) * 100 : null,
      realized: ledger.realized,
      invalid: ledger.invalid,
      invalidNote: ledger.invalidNote,
    });

    grams += ledger.grams;
    cost += ledger.cost;
    realized += ledger.realized;
    if (valueOf === null) complete = false;
    else value += valueOf;
    if (pnlOf === null) complete = false;
    else pnl += pnlOf;
    if (ledger.invalid) {
      invalid = true;
      if (!invalidNote) invalidNote = `${symbol}：${ledger.invalidNote}`;
    }
  }

  return {
    positions,
    grams,
    cost,
    value,
    pnl,
    pnlPct: complete && cost > EPSILON ? (pnl / cost) * 100 : null,
    realized,
    complete,
    invalid,
    invalidNote,
  };
}

/** 某个已结束交易日的模拟持仓与盈亏；金额口径统一为客户卖出价 */
export interface DailyPortfolio {
  /** 当日收盘时的持仓克数 */
  grams: number;
  /** 当日收盘时的剩余成本 */
  cost: number;
  avgCost: number | null;
  /** 收盘市值 */
  closeValue: number;
  /** 相对剩余成本的浮动盈亏 */
  floating: number;
  floatingPct: number | null;
  /** 截至当日收盘的已实现盈亏 */
  realized: number;
  /** 当日盈亏：持仓过夜部分按前收变动，加上当日买卖与收盘价的差 */
  dayPnl: number | null;
  /** 当日盈亏相对前一日收盘持仓市值；没有隔夜持仓时为 null */
  dayPnlPct: number | null;
  invalid: boolean;
  invalidNote: string;
}

/**
 * 按交易日汇总某家银行的计算器记录。day 是交易日键（凌晨 02:30 前的夜盘算前一日），
 * 记录只有日期没有时刻，凌晨下的单会记在自然日上——这是既有记账口径，不在这里改写。
 */
export function dailyPortfolio(
  records: ReadonlyArray<CalcRecord>,
  symbol: string,
  day: string,
  closeSell: number | undefined,
  prevCloseSell: number | undefined,
): DailyPortfolio | null {
  const own = records.filter((record) => record.symbol === symbol);
  if (!own.length) return null;
  if (typeof closeSell !== 'number' || !Number.isFinite(closeSell) || closeSell <= 0) return null;

  const before = own.filter((record) => record.date < day);
  const today = own.filter((record) => record.date === day);
  const start = calcLedger(before);
  const end = calcLedger(own.filter((record) => record.date <= day));

  let buysCost = 0;
  let sellsProceeds = 0;
  for (const record of today) {
    if (record.side === 'buy') buysCost += calcAmount(record);
    else sellsProceeds += calcAmount(record);
  }

  // 没有隔夜持仓时不需要前收：当日盈亏就是当日买卖相对收盘价的差
  const startValue =
    start.grams > EPSILON
      ? typeof prevCloseSell === 'number' && Number.isFinite(prevCloseSell) && prevCloseSell > 0
        ? start.grams * prevCloseSell
        : null
      : 0;
  const dayPnl =
    startValue === null ? null : end.grams * closeSell - startValue - buysCost + sellsProceeds;
  const closeValue = end.grams * closeSell;
  const floating = closeValue - end.cost;

  return {
    grams: end.grams,
    cost: end.cost,
    avgCost: end.avgCost,
    closeValue,
    floating,
    floatingPct: end.cost > EPSILON ? (floating / end.cost) * 100 : null,
    realized: end.realized,
    dayPnl,
    dayPnlPct: dayPnl !== null && startValue !== null && startValue > EPSILON ? (dayPnl / startValue) * 100 : null,
    invalid: end.invalid,
    invalidNote: end.invalidNote,
  };
}

/** 按实时卖出价估算持仓市值与浮动盈亏；没有持仓或没有价格时返回 null */
export function calcEstimate(ledger: CalcLedger, sellPrice: number | undefined): CalcEstimate | null {
  if (ledger.grams <= EPSILON) return null;
  if (typeof sellPrice !== 'number' || !Number.isFinite(sellPrice)) return null;
  const value = ledger.grams * sellPrice;
  const pnl = value - ledger.cost;
  return {
    value,
    pnl,
    pnlPct: ledger.cost > EPSILON ? (pnl / ledger.cost) * 100 : null,
    tone: priceTone(pnl),
  };
}

/** 删除买入可能让后面的卖出超过持仓，先拦下来并说明是哪一笔（按银行分别校验） */
export function calcDeleteError(records: ReadonlyArray<CalcRecord>, ids: string[]): string | null {
  const picked = new Set(ids);
  if (!picked.size) return null;
  const next = records.filter((record) => !picked.has(record.id));
  for (const [symbol, list] of groupBySymbol(next)) {
    const ledger = calcLedger(list);
    if (ledger.invalid) {
      return `删除后记录不一致（${symbol}）：${ledger.invalidNote}；请先删除对应卖出记录`;
    }
  }
  return null;
}

/** 面板「模拟浮盈」的文案；没有持仓或没有价格时显示 — */
export function calcEstimateText(estimate: CalcEstimate | null): { pnl: string; pct: string } {
  if (!estimate) return { pnl: '—', pct: '' };
  const sign = estimate.pnl >= 0 ? '+' : '';
  return {
    pnl: `${sign}${formatPrice(estimate.pnl)}`,
    pct: estimate.pnlPct === null ? '' : formatPct(estimate.pnlPct),
  };
}
