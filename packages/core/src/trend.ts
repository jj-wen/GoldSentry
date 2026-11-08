import { beijingDateKey, beijingDayStart, beijingHhmm } from './clock.ts';
import { formatPct, formatPrice, priceTone, type PriceTone } from './format.ts';

export interface TrendSampleLike {
  symbol: string;
  ts: number;
  buyPrice: number;
}

/** 分时图可选的时间跨度；day 是自然日 00:00–24:00，其余从区间末端往回截 */
export type TrendRange = '1h' | '12h' | 'day';

export const TREND_RANGE_ORDER: TrendRange[] = ['1h', '12h', 'day'];

export const TREND_RANGE_TEXT: Record<TrendRange, string> = {
  '1h': '1 小时',
  '12h': '半天',
  day: '全天',
};

export const DEFAULT_TREND_SETTINGS: TrendSettings = { enabled: true, range: 'day' };

export interface TrendSettings {
  enabled: boolean;
  range: TrendRange;
}

export function normalizeTrendRange(raw: unknown): TrendRange {
  return raw === '1h' || raw === '12h' || raw === 'day' ? raw : DEFAULT_TREND_SETTINGS.range;
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

  const day = pickDay(byDay, todayKey, options.preferPreviousDay === true);
  const raw = [...(byDay.get(day) ?? [])].sort((a, b) => a.ts - b.ts);

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
  if (range !== 'day') {
    const anchor = isToday ? now : (lastTs ?? dayEnd);
    windowEnd = Math.min(Math.max(anchor, dayStart), dayEnd);
  }
  const span = range === '1h' ? 3_600_000 : range === '12h' ? 43_200_000 : 86_400_000;
  const windowStart = range === 'day' ? dayStart : Math.max(dayStart, windowEnd - span);

  const inWindow = unique.filter((sample) => sample.ts >= windowStart && sample.ts <= windowEnd);
  const points: TrendPoint[] = [];
  const sampled = downsample(inWindow, maxPoints);
  for (let i = 0; i < sampled.length; i += 1) {
    const sample = sampled[i];
    points.push({
      ts: sample.ts,
      price: sample.buyPrice,
      text: formatPrice(sample.buyPrice),
      timeText: beijingHhmm(sample.ts),
      gap: i > 0 && sample.ts - sampled[i - 1].ts > TREND_GAP_MS,
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
    windowText: `${isToday ? '今日' : day.slice(5)} · ${TREND_RANGE_TEXT[range]}`,
    axisLabels: range === 'day' ? ['00:00', '12:00', '24:00'] : [beijingHhmm(windowStart), beijingHhmm(mid), beijingHhmm(windowEnd)],
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
