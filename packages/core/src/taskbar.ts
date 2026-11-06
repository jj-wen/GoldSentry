import type { Rect } from './format.ts';

export type TaskbarEdge = 'top' | 'bottom' | 'left' | 'right';

export interface TaskbarInfo {
  edge: TaskbarEdge;
  /** 任务栏整条所占的矩形 */
  rect: Rect;
  thickness: number;
}

/** Windows 自动隐藏时 workArea 与 bounds 只剩 0～2px 的差，别当成任务栏 */
const MIN_THICKNESS = 4;

/**
 * Electron 没有读取系统任务栏窗口的接口，只能用显示器 bounds（含任务栏）
 * 与 workArea（不含任务栏）的差来推断任务栏在哪条边、有多厚。
 * 其它停靠工具栏也会压缩 workArea，取差值最大的那条边；自动隐藏时返回 null。
 */
export function detectTaskbar(bounds: Rect, workArea: Rect): TaskbarInfo | null {
  const edges: Array<{ edge: TaskbarEdge; value: number; rect: Rect }> = [
    {
      edge: 'top',
      value: workArea.y - bounds.y,
      rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: workArea.y - bounds.y },
    },
    {
      edge: 'bottom',
      value: bounds.y + bounds.height - (workArea.y + workArea.height),
      rect: {
        x: bounds.x,
        y: workArea.y + workArea.height,
        width: bounds.width,
        height: bounds.y + bounds.height - (workArea.y + workArea.height),
      },
    },
    {
      edge: 'left',
      value: workArea.x - bounds.x,
      rect: { x: bounds.x, y: bounds.y, width: workArea.x - bounds.x, height: bounds.height },
    },
    {
      edge: 'right',
      value: bounds.x + bounds.width - (workArea.x + workArea.width),
      rect: {
        x: workArea.x + workArea.width,
        y: bounds.y,
        width: bounds.x + bounds.width - (workArea.x + workArea.width),
        height: bounds.height,
      },
    },
  ];

  let best: (typeof edges)[number] | null = null;
  for (const candidate of edges) {
    if (candidate.value < MIN_THICKNESS) continue;
    if (!best || candidate.value > best.value) best = candidate;
  }
  return best ? { edge: best.edge, rect: best.rect, thickness: best.value } : null;
}

/** 默认离任务栏末端（托盘/时钟一侧）留出的距离，避免压住系统托盘 */
export const TASKBAR_END_MARGIN = 300;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * 把一条文字贴到任务栏上：横边填满任务栏厚度、沿 x 排；
 * 竖边填满厚度、沿 y 排。savedOffset 为沿任务栏方向记住的绝对坐标，
 * 为空时按「末端留 TASKBAR_END_MARGIN」落位。
 */
export function placeOnTaskbar(
  content: { width: number; height: number },
  info: TaskbarInfo,
  savedOffset: number | null,
  endMargin = TASKBAR_END_MARGIN,
): Rect {
  const vertical = info.edge === 'left' || info.edge === 'right';
  if (vertical) {
    const height = clamp(Math.round(content.height), 1, info.rect.height);
    const fallback = info.rect.y + info.rect.height - endMargin - height;
    const y = Math.round(clamp(savedOffset ?? fallback, info.rect.y, info.rect.y + info.rect.height - height));
    return { x: info.rect.x, y, width: info.rect.width, height };
  }
  const width = clamp(Math.round(content.width), 1, info.rect.width);
  const fallback = info.rect.x + info.rect.width - endMargin - width;
  const x = Math.round(clamp(savedOffset ?? fallback, info.rect.x, info.rect.x + info.rect.width - width));
  return { x, y: info.rect.y, width, height: info.rect.height };
}
