import { beijingDateKey, beijingDayStart, beijingHhmm } from './clock.ts';
import { formatPct, formatPrice, priceTone, type PriceTone } from './format.ts';

export interface TrendSampleLike {
  symbol: string;
  ts: number;
  buyPrice: number;
}

/** 分时图可选的时间跨度；day 是自然日 00:00–24:00，7d/10d 从当前时刻往回截 */
export type TrendRange = '30m' | '1h' | '2h' | '4h' | '6h' | '12h' | 'day' | '7d' | '10d';

export const TREND_RANGE_ORDER: TrendRange[] = ['30m', '1h', '2h', '4h', '6h', '12h', 'day', '7d', '10d'];

export const TREND_RANGE_TEXT: Record<TrendRange, string> = {
  '30m': '30 分钟',
  '1h': '1 小时',
  '2h': '2 小时',
  '4h': '4 小时',
  '6h': '6 小时',
  '12h': '半天',
  day: '全天',
  '7d': '7 天',
  '10d': '10 天',
};

const TREND_RANGE_MS: Record<TrendRange, number> = {
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  day: 86_400_000,
  '7d': 7 * 86_400_000,
  '10d': 10 * 86_400_000,
};

export const DEFAULT_TREND_SETTINGS: TrendSettings = { enabled: true, range: 'day' };

export interface TrendSettings {
  enabled: boolean;
  range: TrendRange;
}

export function normalizeTrendRange(raw: unknown): TrendRange {
  return typeof raw === 'string' && raw in TREND_RANGE_TEXT ? (raw as TrendRange) : DEFAULT_TREND_SETTINGS.range;
}

export function normalizeTrendSettings(raw: unknown): TrendSettings {
  const input = (raw ?? {}) as Partial<Record<keyof TrendSettings, unknown>>;
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_TREND_SETTINGS.enabled,
    range: normalizeTrendRange(input.range),
  };
}

export interface TrendPoint {
  ts: number;
  price: number;
  /** core 格式化好的金额，面板不再自己 toFixed */
  text: string;
  /** 北京时间 HH:mm，悬停提示直接贴 */
  timeText: string;
  /** 与上一点相隔超过 TREND_GAP_MS：午休/收盘造成断线，不要连成一条斜线 */
  gap: boolean;
}

export interface TrendSeries {
  symbol: string;
  day: string;
  dayStart: number;
  dayEnd: number;
  /** 实际绘制的窗口：day 模式等于自然日，其余是所选跨度（不会跨出自然日） */
  windowStart: number;
  windowEnd: number;
  range: TrendRange;
  rangeText: string;
  /** 标题用，如「今日 · 1 小时」 */
  windowText: string;
  /** 横轴三个刻度，避免面板自己拼时间 */
  axisLabels: [string, string, string];
  isToday: boolean;
  points: TrendPoint[];
  open: number | null;
  last: number | null;
  low: number | null;
  high: number | null;
  changePct: number | null;
  openText: string;
  lastText: string;
  lowText: string;
  highText: string;
  changeText: string;
  tone: PriceTone;
}

/** 超过 30 分钟没有采样就断线；正常轮询最长 5 分钟，不会被误判 */
export const TREND_GAP_MS = 30 * 60_000;

/** 1 秒档跑满一天约 2 万个点，画之前先抽到这个数量 */
export const TREND_MAX_POINTS = 240;

/** 闭市时回退最近一个有数据的自然日，至少要有两个点才画成线 */
const MIN_FALLBACK_POINTS = 2;

export interface TrendOptions {
  maxPoints?: number;
  /** 休市时优先展示最近一个有数据的交易日，而不是今天那几条横线 */
  preferPreviousDay?: boolean;
  /** 默认全天；1h/12h 从窗口末端往回截，末端不会跨出所选自然日 */
  range?: TrendRange;
}

function downsample<T>(items: T[], maxPoints: number): T[] {
  if (items.length <= maxPoints) return items;
  const step = (items.length - 1) / (maxPoints - 1);
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i += 1) out.push(items[Math.round(i * step)]);
  return out;
}

/** 选日期：开市看今天；休市且今天没像样的数据时，回退到最近一个有采样的自然日 */
function pickDay(
  byDay: Map<string, TrendSampleLike[]>,
  todayKey: string,
  preferPreviousDay: boolean,
): string {
  if (!preferPreviousDay) return todayKey;
  let best: string | null = null;
  for (const [day, items] of byDay) {
    if (day >= todayKey) continue;
    // 同一时间戳的重复采样（测试/手动刷新）画不成线，不能算"这一天有数据"
    if (new Set(items.map((item) => item.ts)).size < MIN_FALLBACK_POINTS) continue;
    if (!best || day > best) best = day;
  }
  return best ?? todayKey;
}

export function dayTrendSeries(
  samples: ReadonlyArray<TrendSampleLike>,
  symbol: string,
  now: number,
  options: TrendOptions = {},
): TrendSeries {
  const maxPoints = Math.max(2, options.maxPoints ?? TREND_MAX_POINTS);
  const range = normalizeTrendRange(options.range);
  const multiDay = range === '7d' || range === '10d';
  const todayKey = beijingDateKey(now);
  const byDay = new Map<string, TrendSampleLike[]>();

  for (const sample of samples) {
    if (sample.symbol !== symbol) continue;
    if (!Number.isFinite(sample.ts) || !Number.isFinite(sample.buyPrice) || sample.buyPrice <= 0) continue;
    const day = beijingDateKey(sample.ts);
    const list = byDay.get(day);
    if (list) list.push(sample);
    else byDay.set(day, [sample]);
  }

  const day = multiDay ? todayKey : pickDay(byDay, todayKey, options.preferPreviousDay === true);
  const raw = (
    multiDay ? [...byDay.values()].flat() : [...(byDay.get(day) ?? [])]
  ).sort((a, b) => a.ts - b.ts);

  // 同一时间戳（手动刷新撞上轮询）只保留最后一笔
  const unique: TrendSampleLike[] = [];
  for (const sample of raw) {
    const prev = unique[unique.length - 1];
    if (prev && prev.ts === sample.ts) unique[unique.length - 1] = sample;
    else unique.push(sample);
  }

  const dayStart = beijingDayStart(day);
  const dayEnd = dayStart + 86_400_000;
  const isToday = day === todayKey;
  // 今天的窗口截到现在；回退到历史日则截到当天最后一笔，避免右侧一大段空白
  const lastTs = unique.length ? unique[unique.length - 1].ts : null;
  let windowEnd = dayEnd;
  let windowStart: number;
  if (multiDay) {
    // 多日窗口从当前时刻往回截，休市时也保持一致的宽度
    windowEnd = now;
    windowStart = now - TREND_RANGE_MS[range];
  } else {
    if (range !== 'day') {
      const anchor = isToday ? now : (lastTs ?? dayEnd);
      windowEnd = Math.min(Math.max(anchor, dayStart), dayEnd);
    }
    const span = TREND_RANGE_MS[range];
    windowStart = range === 'day' ? dayStart : Math.max(dayStart, windowEnd - span);
  }

  const inWindow = unique.filter((sample) => sample.ts >= windowStart && sample.ts <= windowEnd);
  const points: TrendPoint[] = [];
  const sampled = downsample(inWindow, maxPoints);
  // 多日图降采样后点距本来就有 40–60 分钟，仍按 30 分钟断线会碎成一个个点
  const gapMs = multiDay
    ? Math.max(TREND_GAP_MS, ((windowEnd - windowStart) / Math.max(1, maxPoints - 1)) * 1.5)
    : TREND_GAP_MS;
  for (let i = 0; i < sampled.length; i += 1) {
    const sample = sampled[i];
    points.push({
      ts: sample.ts,
      price: sample.buyPrice,
      text: formatPrice(sample.buyPrice),
      timeText: multiDay
        ? `${beijingDateKey(sample.ts).slice(5)} ${beijingHhmm(sample.ts)}`
        : beijingHhmm(sample.ts),
      gap: i > 0 && sample.ts - sampled[i - 1].ts > gapMs,
    });
  }

  const open = inWindow.length ? inWindow[0].buyPrice : null;
  const last = inWindow.length ? inWindow[inWindow.length - 1].buyPrice : null;
  let low: number | null = null;
  let high: number | null = null;
  for (const sample of inWindow) {
    if (low === null || sample.buyPrice < low) low = sample.buyPrice;
    if (high === null || sample.buyPrice > high) high = sample.buyPrice;
  }
  const changePct = open && last !== null ? ((last - open) / open) * 100 : null;
  const mid = windowStart + (windowEnd - windowStart) / 2;

  return {
    symbol,
    day,
    dayStart,
    dayEnd,
    windowStart,
    windowEnd,
    range,
    rangeText: TREND_RANGE_TEXT[range],
    windowText: multiDay
      ? `近 ${TREND_RANGE_TEXT[range]}`
      : `${isToday ? '今日' : day.slice(5)} · ${TREND_RANGE_TEXT[range]}`,
    axisLabels: multiDay
      ? [
          beijingDateKey(windowStart).slice(5),
          beijingDateKey(mid).slice(5),
          beijingDateKey(windowEnd).slice(5),
        ]
      : range === 'day'
        ? ['00:00', '12:00', '24:00']
        : [beijingHhmm(windowStart), beijingHhmm(mid), beijingHhmm(windowEnd)],
    isToday,
    points,
    open,
    last,
    low,
    high,
    changePct,
    openText: formatPrice(open ?? undefined),
    lastText: formatPrice(last ?? undefined),
    lowText: formatPrice(low ?? undefined),
    highText: formatPrice(high ?? undefined),
    changeText: formatPct(changePct ?? undefined),
    tone: priceTone(changePct ?? undefined),
  };
}

export interface SparkPoint {
  /** 0–1，按分时窗口的时间比例 */
  x: number;
  /** 0–1，0 在顶部；外壳只按自己的像素尺寸缩放 */
  y: number;
  gap: boolean;
}

export interface TrendSparkline {
  points: SparkPoint[];
  tone: PriceTone;
  rangeText: string;
  changeText: string;
}

/** 任务栏迷你走势：把分时序列归一化成 0–1 坐标，避免各外壳自己算几何 */
export function trendSparkline(series: TrendSeries): TrendSparkline | null {
  if (series.points.length < 2) return null;
  const span = (series.high ?? 0) - (series.low ?? 0);
  const pad = span > 0 ? span * 0.12 : Math.max((series.high ?? 0) * 0.0004, 0.01);
  const min = (series.low ?? 0) - pad;
  const max = (series.high ?? 0) + pad;
  const width = series.windowEnd - series.windowStart || 1;
  return {
    points: series.points.map((point) => ({
      x: Math.min(1, Math.max(0, (point.ts - series.windowStart) / width)),
      y: Math.min(1, Math.max(0, 1 - (point.price - min) / (max - min))),
      gap: point.gap,
    })),
    tone: series.tone,
    rangeText: series.rangeText,
    changeText: series.changeText,
  };
}
