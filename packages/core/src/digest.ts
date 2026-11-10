import type { Sample } from './store.ts';
import { tradingDayKey } from './market.ts';
import { formatPct, formatPrice } from './format.ts';
import { dailyPortfolio, formatGrams } from './calculator.ts';
import type { CalcRecord } from './calculator.ts';
import type { CalcFeeBook } from './fees.ts';

export interface DailyDigest {
  /** 交易日的键，如 2026-11-09（凌晨 02:30 前的夜盘算前一日） */
  day: string;
  title: string;
  body: string;
}

export interface DigestOptions {
  /** 面板/状态栏当前选中的银行，日报把它排在第一行 */
  primarySymbol?: string;
  /** 计算器记录：按每家银行自己的收盘卖出价追加模拟持仓与当日收益 */
  calcRecords?: ReadonlyArray<CalcRecord>;
  /** 计算器按银行配置的手续费，日报的市值与收益同样扣掉 */
  calcFees?: CalcFeeBook;
}

interface DayStat {
  open: number;
  openTs: number;
  high: number;
  low: number;
  last: number;
  lastTs: number;
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatPrice(value)}`;
}

/** 收盘卖出价只认有效正数，避免把上游的单边 0 当成市价 */
function lastSellPrice(
  samples: ReadonlyArray<Sample>,
  symbol: string,
  day: string,
): { close: number | undefined; prev: number | undefined } {
  let close: number | undefined;
  let closeTs = Number.NEGATIVE_INFINITY;
  let prev: number | undefined;
  let prevTs = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    if (sample.symbol !== symbol) continue;
    if (!Number.isFinite(sample.sellPrice) || sample.sellPrice <= 0) continue;
    const key = tradingDayKey(sample.ts);
    if (key === day) {
      if (sample.ts >= closeTs) {
        close = sample.sellPrice;
        closeTs = sample.ts;
      }
    } else if (key < day && sample.ts >= prevTs) {
      prev = sample.sellPrice;
      prevTs = sample.ts;
    }
  }
  return { close, prev };
}

function portfolioSection(
  samples: ReadonlyArray<Sample>,
  labels: Record<string, string>,
  primary: string | undefined,
  records: ReadonlyArray<CalcRecord> | undefined,
  day: string,
  fees: CalcFeeBook = {},
): string[] {
  if (!records?.length) return [];
  const held = [...new Set(records.map((record) => record.symbol).filter(Boolean))];
  if (!held.length) return [];

  // 主显银行排最前，其余按面板顺序，再补上面板里已经没有的旧品种
  const ordered: string[] = [];
  const push = (symbol: string) => {
    if (held.includes(symbol) && !ordered.includes(symbol)) ordered.push(symbol);
  };
  if (primary) push(primary);
  for (const symbol of Object.keys(labels)) push(symbol);
  for (const symbol of held) push(symbol);

  const details: string[] = [];
  const missing: string[] = [];
  let included = 0;
  let totalGrams = 0;
  let totalCost = 0;
  let totalValue = 0;
  let totalFloating = 0;
  let totalDay = 0;
  let totalRealized = 0;
  let dayKnown = true;

  for (const symbol of ordered) {
    const { close, prev } = lastSellPrice(samples, symbol, day);
    const portfolio = dailyPortfolio(records, symbol, day, close, prev, fees);
    const label = labels[symbol] ?? symbol;
    if (!portfolio) {
      missing.push(label);
      continue;
    }
    included += 1;

    const parts: string[] = [];
    if (portfolio.grams > 0) {
      const avg = portfolio.avgCost === null ? '—' : formatPrice(portfolio.avgCost);
      const pct = portfolio.floatingPct === null ? '' : `（${formatPct(portfolio.floatingPct)}）`;
      parts.push(
        formatGrams(portfolio.grams),
        `成本 ${avg}`,
        `市值 ¥${formatPrice(portfolio.closeValue)}`,
        `浮动 ${signed(portfolio.floating)}${pct}`,
      );
    } else {
      parts.push('已清仓');
    }
    if (portfolio.dayPnl !== null && (portfolio.grams > 0 || Math.abs(portfolio.dayPnl) > 0.005)) {
      const pct = portfolio.dayPnlPct === null ? '' : `（${formatPct(portfolio.dayPnlPct)}）`;
      parts.push(`当日 ${signed(portfolio.dayPnl)}${pct}`);
    }
    if (Math.abs(portfolio.realized) > 0.005) parts.push(`累计已实现 ${signed(portfolio.realized)}`);
    details.push(`${label} ${parts.join(' · ')}`);
    if (portfolio.invalid) details.push(`${label} 记录不一致：${portfolio.invalidNote}`);

    totalGrams += portfolio.grams;
    totalCost += portfolio.cost;
    totalValue += portfolio.closeValue;
    totalFloating += portfolio.floating;
    totalRealized += portfolio.realized;
    if (portfolio.dayPnl === null) dayKnown = false;
    else totalDay += portfolio.dayPnl;
  }

  if (!included) return [];
  const lines = ['模拟持仓（客户卖出价）', ...details];
  if (included > 1) {
    const parts: string[] = [];
    if (totalGrams > 0) {
      const pct = totalCost > 0 ? `（${formatPct((totalFloating / totalCost) * 100)}）` : '';
      parts.push(
        formatGrams(totalGrams),
        `市值 ¥${formatPrice(totalValue)}`,
        `浮动 ${signed(totalFloating)}${pct}`,
      );
    } else {
      parts.push('已清仓');
    }
    if (dayKnown && (totalGrams > 0 || Math.abs(totalDay) > 0.005)) parts.push(`当日 ${signed(totalDay)}`);
    if (Math.abs(totalRealized) > 0.005) parts.push(`累计已实现 ${signed(totalRealized)}`);
    lines.push(`合计 ${parts.join(' · ')}`);
  }
  if (missing.length) lines.push(`未计入：${missing.join('、')}（缺收盘价）`);
  return lines;
}

/**
 * 最近一个已结束交易日的简报。只汇总当前仍在监测的品种（labels 的键），
 * 没采样的品种自动跳过；没有历史数据时返回 null，外壳据此不发。
 */
export function buildDailyDigest(
  samples: ReadonlyArray<Sample>,
  labels: Record<string, string>,
  now = Date.now(),
  options: DigestOptions = {},
): DailyDigest | null {
  const today = tradingDayKey(now);
  const days = new Map<string, Map<string, DayStat>>();

  for (const sample of samples) {
    const label = labels[sample.symbol];
    if (!label) continue;
    if (!Number.isFinite(sample.ts) || !Number.isFinite(sample.buyPrice) || sample.buyPrice <= 0) continue;
    const day = tradingDayKey(sample.ts);
    if (day >= today) continue;

    let bySymbol = days.get(day);
    if (!bySymbol) {
      bySymbol = new Map();
      days.set(day, bySymbol);
    }
    const stat = bySymbol.get(sample.symbol);
    if (!stat) {
      bySymbol.set(sample.symbol, {
        open: sample.buyPrice,
        openTs: sample.ts,
        high: sample.buyPrice,
        low: sample.buyPrice,
        last: sample.buyPrice,
        lastTs: sample.ts,
      });
      continue;
    }
    if (sample.ts < stat.openTs) {
      stat.open = sample.buyPrice;
      stat.openTs = sample.ts;
    }
    if (sample.ts >= stat.lastTs) {
      stat.last = sample.buyPrice;
      stat.lastTs = sample.ts;
    }
    stat.high = Math.max(stat.high, sample.buyPrice);
    stat.low = Math.min(stat.low, sample.buyPrice);
  }

  if (!days.size) return null;
  const day = [...days.keys()].sort().at(-1);
  if (!day) return null;
  const stats = days.get(day);
  if (!stats) return null;

  // 选中的银行固定第一条，其余保持面板里的顺序
  const ordered = Object.entries(labels);
  const primary = options.primarySymbol;
  if (primary) {
    const index = ordered.findIndex(([symbol]) => symbol === primary);
    if (index > 0) ordered.unshift(...ordered.splice(index, 1));
  }

  const lines: string[] = [];
  for (const [symbol, label] of ordered) {
    const stat = stats.get(symbol);
    if (!stat) continue;
    const pct = ((stat.last - stat.open) / stat.open) * 100;
    lines.push(
      `${label} 开 ${formatPrice(stat.open)} 收 ${formatPrice(stat.last)} 高 ${formatPrice(stat.high)} 低 ${formatPrice(stat.low)}（${formatPct(pct)}）`,
    );
  }
  if (!lines.length) return null;

  lines.push(...portfolioSection(samples, labels, primary, options.calcRecords, day, options.calcFees));

  return { day, title: `积存金日报 · ${day}`, body: lines.join('\n') };
}
