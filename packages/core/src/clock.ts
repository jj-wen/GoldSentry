/** 北京时间的自然日，行情和定价都按这个口径切日 */
export function beijingDateKey(ts: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

/** 北京时间的 00:00 对应的毫秒时间戳（北京时间固定 UTC+8，没有夏令时） */
export function beijingDayStart(dayKey: string): number {
  const [year, month, day] = dayKey.split('-').map(Number);
  return Date.UTC(year, month - 1, day) - 8 * 3_600_000;
}

const HHMM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 分时图刻度与悬停提示统一用这个，避免各端自己拼时间 */
export function beijingHhmm(ts: number): string {
  return HHMM.format(new Date(ts));
}
