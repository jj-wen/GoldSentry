/** 金额一律两位小数；缺失或非有限值显示 —，不编数字 */
export function formatPrice(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
}

/** 涨跌幅：带正负号的两位小数百分比 */
export function formatPct(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** 悬浮球透明度下限：再低就找不到球了 */
export const OPACITY_MIN = 0.3;
export const OPACITY_MAX = 1;

/** 面板滑杆与滚轮增量都经过这里，脏值退回默认而不是崩 */
export function clampOpacity(value: unknown, fallback = 0.9): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Math.round(num * 100) / 100));
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 记住的球位置在换分辨率或拔显示器后会落在屏幕外，
 * 这里夹回工作区；夹不动（球比工作区还大）时贴左上角，保证找得到。
 */
export function clampIntoWorkArea(rect: Rect, workArea: Rect): { x: number; y: number } {
  const x = Math.min(
    Math.max(rect.x, workArea.x),
    Math.max(workArea.x, workArea.x + workArea.width - rect.width),
  );
  const y = Math.min(
    Math.max(rect.y, workArea.y),
    Math.max(workArea.y, workArea.y + workArea.height - rect.height),
  );
  return { x, y };
}
