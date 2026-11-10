import { beijingMinutes } from './clock.ts';

export interface QuietHours {
  enabled: boolean;
  /** HH:MM，北京时间 */
  start: string;
  /** HH:MM，允许跨午夜（start > end） */
  end: string;
}

/** 解析 HH:MM；不合法返回 null，宁可当作没设置也不乱弹/乱静音 */
export function parseHhmm(text: string | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((text ?? '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** 当前是否处于免打扰时段；start == end 视为未设置 */
export function inQuietHours(config: QuietHours | undefined, now = Date.now()): boolean {
  if (!config?.enabled) return false;
  const start = parseHhmm(config.start);
  const end = parseHhmm(config.end);
  if (start === null || end === null || start === end) return false;
  const minutes = beijingMinutes(now);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** 简报定时：当天的 HH:MM 是否已到 */
export function timeReached(time: string | undefined, now = Date.now()): boolean {
  const target = parseHhmm(time);
  if (target === null) return false;
  return beijingMinutes(now) >= target;
}
