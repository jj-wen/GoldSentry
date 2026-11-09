import { formatPct, formatPrice, priceTone } from './format.ts';
import type { PriceTone } from './format.ts';

/** 一笔买入/卖出记录：成本、均价与盈亏只在这里算，外壳只负责展示 */
export type CalcSide = 'buy' | 'sell';

export interface CalcRecord {
  id: string;
  side: CalcSide;
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

/** 落盘数据可能被手改：只收完整合法的记录，脏数据直接丢弃 */
export function normalizeCalcRecords(raw: unknown): CalcRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: CalcRecord[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Partial<CalcRecord>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const side = record.side === 'buy' || record.side === 'sell' ? record.side : null;
    const date = typeof record.date === 'string' ? record.date.trim() : '';
    const grams = typeof record.grams === 'number' ? round(record.grams, 3) : NaN;
    const price = typeof record.price === 'number' ? round(record.price, 2) : NaN;
    if (!id || ids.has(id) || !side || !validDate(date)) continue;
    if (!Number.isFinite(grams) || grams <= 0) continue;
    if (!Number.isFinite(price) || price < 0) continue;
    ids.add(id);
    out.push({
      id,
      side,
      date,
      grams,
      price,
      createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
    });
  }
  return out;
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

/** 删除买入可能让后面的卖出超过持仓，先拦下来并说明是哪一笔 */
export function calcDeleteError(records: CalcRecord[], ids: string[]): string | null {
  const picked = new Set(ids);
  if (!picked.size) return null;
  const next = records.filter((record) => !picked.has(record.id));
  const ledger = calcLedger(next);
  return ledger.invalid ? `删除后记录不一致：${ledger.invalidNote}；请先删除对应卖出记录` : null;
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
