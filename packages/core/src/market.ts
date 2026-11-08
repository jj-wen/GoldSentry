/**
 * 积存金交易时段（北京时间）。银行积存金是连续盘：日盘 9:00–15:30 直接接夜盘到次日凌晨，
 * 各家收盘点不同（实测 2026-11-07 收盘时间戳：工商 22:30、广发/兴业/中信/民生 02:00、浙商 02:30），
 * 这里取并集 09:00 → 次日 02:30。并集内只要还有一家开着，源级"全量陈旧"判定就不会误报。
 * 节假日本身无法从星期推出来，只能维护公告表：来源与核对日期见 docs/DATA-SOURCES.md，每年更新一次。
 */

/** 最近一次核对休市公告的日期；跨年之前必须重新核对 */
export const MARKET_SCHEDULE_AS_OF = '2026-11-08';

/** 节假日整段休市；区间里的周末本来就休市，写全是为了和公告原文逐字对得上 */
const HOLIDAY_RANGES: Array<[string, string, string]> = [
  ['2026-01-01', '2026-01-03', '元旦'],
  ['2026-02-15', '2026-02-23', '春节'],
  ['2026-04-04', '2026-04-06', '清明'],
  ['2026-05-01', '2026-05-05', '劳动节'],
  ['2026-06-19', '2026-06-21', '端午'],
  ['2026-09-25', '2026-09-27', '中秋'],
  ['2026-10-01', '2026-10-07', '国庆'],
];

/** 节假日前最后一个交易日晚上不进行夜盘交易（公告原文逐条列出） */
const NO_NIGHT_EVENINGS = new Set([
  '2025-12-31',
  '2026-02-13',
  '2026-04-03',
  '2026-04-30',
  '2026-06-18',
  '2026-09-24',
  '2026-09-30',
]);

const DAY_OPEN = 9 * 60;
const DAY_CLOSE = 15 * 60 + 30;
/** 夜盘最晚收盘点（浙商 02:30），凌晨这段属于前一日夜盘 */
const NIGHT_END = 2 * 60 + 30;

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function beijingParts(now: number): { dateKey: string; weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(new Date(now));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: WEEKDAY_NAMES.indexOf(get('weekday')),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function holidayOf(dateKey: string): string | undefined {
  return HOLIDAY_RANGES.find(([from, to]) => dateKey >= from && dateKey <= to)?.[2];
}

function prevDateKey(dateKey: string): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

function closedReason(dateKey: string, weekday: number, noNight: boolean): string {
  const holiday = holidayOf(dateKey);
  if (holiday) return `${holiday}休市`;
  if (weekday === 0 || weekday === 6) return '周末休市';
  if (noNight) return '节前夜盘暂停';
  return '开市前（09:00 开市）';
}

export interface MarketSession {
  open: boolean;
  /** 休市原因，开市时为空串 */
  reason: string;
}

export function marketSessionAt(now = Date.now()): MarketSession {
  const { dateKey, weekday, minutes } = beijingParts(now);
  if (minutes < NIGHT_END) {
    const prev = prevDateKey(dateKey);
    const prevWeekday = (weekday + 6) % 7;
    const prevIsWorkday = prevWeekday >= 1 && prevWeekday <= 5;
    if (prevIsWorkday && !holidayOf(prev) && !NO_NIGHT_EVENINGS.has(prev)) return { open: true, reason: '' };
    return { open: false, reason: closedReason(prev, prevWeekday, NO_NIGHT_EVENINGS.has(prev)) };
  }
  if (minutes < DAY_OPEN) return { open: false, reason: closedReason(dateKey, weekday, false) };
  if (holidayOf(dateKey)) return { open: false, reason: `${holidayOf(dateKey)}休市` };
  // 调休补班的周末对办公室是工作日，对市场仍是休市，周末规则已经覆盖
  if (weekday === 0 || weekday === 6) return { open: false, reason: '周末休市' };
  if (minutes < DAY_CLOSE) return { open: true, reason: '' };
  if (NO_NIGHT_EVENINGS.has(dateKey)) return { open: false, reason: '节前夜盘暂停' };
  return { open: true, reason: '' };
}