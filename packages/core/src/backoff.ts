/** 偶发一次失败不该拖慢刷新，连续全部失效达到这个次数才开始降频 */
export const BACKOFF_AFTER_FAILURES = 3;
/** 再失效也不能无限拉长，否则恢复后要等很久才看到价格 */
export const BACKOFF_MAX_SECONDS = 300;
/** 翻倍次数上限，避免 base 很小时算出天文数字 */
const MAX_DOUBLINGS = 5;

/**
 * 全部失效时按 2 的幂拉长间隔，一旦恢复（failures 归零）立刻回到用户设定值。
 * 部分异常不降频：还有源在出数，慢下来反而丢行情。
 */
export function backoffSeconds(baseSeconds: number, failures: number): number {
  const base = Number.isFinite(baseSeconds) && baseSeconds > 0 ? baseSeconds : 30;
  if (!Number.isFinite(failures) || failures < BACKOFF_AFTER_FAILURES) return base;
  const doublings = Math.min(failures - BACKOFF_AFTER_FAILURES + 1, MAX_DOUBLINGS);
  // 用户已经选了比上限更长的间隔（如 10 分钟）时不能被"降频"反而调快
  return Math.max(base, Math.min(BACKOFF_MAX_SECONDS, Math.round(base * 2 ** doublings)));
}