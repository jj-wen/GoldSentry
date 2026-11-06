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

/** 展示内容开关：三个形态共用，避免各端自己决定显示什么 */
export interface DisplayToggles {
  name: boolean;
  up: boolean;
  down: boolean;
}

export const DEFAULT_DISPLAY: DisplayToggles = { name: true, up: true, down: true };

export function normalizeDisplay(raw: unknown): DisplayToggles {
  const input = (raw ?? {}) as Partial<DisplayToggles>;
  return {
    name: typeof input.name === 'boolean' ? input.name : DEFAULT_DISPLAY.name,
    up: typeof input.up === 'boolean' ? input.up : DEFAULT_DISPLAY.up,
    down: typeof input.down === 'boolean' ? input.down : DEFAULT_DISPLAY.down,
  };
}

/**
 * 涨跌要不要显示。平盘（0）归到"涨"这一侧，因为 formatPct(0) 输出的是 `+0.00%`，
 * 显示形态与上涨一致。
 */
export function showPct(pct: number | undefined, display: DisplayToggles): boolean {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return false;
  return pct < 0 ? display.down : display.up;
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
