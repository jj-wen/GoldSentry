import { feeCell } from './fees.ts';
import { bankSessionAt } from './market.ts';

/** 金额一律两位小数；缺失或非有限值显示 —，不编数字 */
export function formatPrice(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
}

/** 涨跌幅：带正负号的两位小数百分比 */
export function formatPct(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** 面板金额单元格：外壳拿到的是成品字符串，不允许自己 toFixed */
export interface QuoteCells {
  buy: string;
  sell: string;
  pct: string;
  tone: PriceTone;
  update: string;
  /** 只有开市期间的陈旧才标黄；休市时报价不动是预期行为 */
  updateStale: boolean;
}

/** 「更新」列的文案；休市与否由 core 的交易时段判定，外壳不自己算 */
export function updateAgeText(quotedAt: number | undefined, basis: string | undefined, now = Date.now()): string {
  if (typeof quotedAt !== 'number' || !Number.isFinite(quotedAt)) return '未知';
  const minutes = Math.max(0, Math.round((now - quotedAt) / 60000));
  if (basis === 'dailyFix') return minutes >= 60 ? `${Math.round(minutes / 60)} 小时前` : '今日已定价';
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.round(minutes / 60)} 小时前`;
}

export function formatQuoteCells(
  quote: {
    symbol?: string;
    buyPrice?: number;
    sellPrice?: number;
    dayChangePct?: number;
    quotedAt?: number;
    basis?: string;
  },
  now = Date.now(),
): QuoteCells {
  const pct = quote.dayChangePct;
  // 按这家银行自己的时段判断：收盘的银行报价不动是预期，不能跟着并集市场一起标黄
  const stale =
    bankSessionAt(quote.symbol ?? '', now).open &&
    quote.basis === 'realtime' &&
    typeof quote.quotedAt === 'number' &&
    now - quote.quotedAt > 30 * 60000;
  return {
    buy: formatPrice(quote.buyPrice),
    sell: formatPrice(quote.sellPrice),
    pct: formatPct(pct),
    tone: priceTone(pct),
    update: updateAgeText(quote.quotedAt, quote.basis, now),
    updateStale: stale,
  };
}

/** 合并后的「点差」列：说清这格到底是点差还是费率，面板只负责贴出来 */
export interface SpreadCell {
  text: string;
  basis: 'spread' | 'fee';
  note: string;
  /** 退回费率口径且核实日期已过期，面板据此标黄 */
  stale: boolean;
}

/**
 * 买入卖一等同时点差是 0，这种没有成本信息，退回服务费口径；
 * 两边都给不出数字时显示 —，不编。
 */
export function spreadCell(spread: number | undefined, symbol: string, now = Date.now()): SpreadCell {
  if (typeof spread === 'number' && Number.isFinite(spread) && spread > 0) {
    return {
      text: formatPrice(spread),
      basis: 'spread',
      note: `点差 ${formatPrice(spread)} 元/克（买入减卖出）`,
      stale: false,
    };
  }
  const fee = feeCell(symbol, now);
  return { text: fee.text, basis: 'fee', note: fee.note, stale: fee.stale };
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

/** 悬浮球基准边长（100% 缩放时），窗口与 zoomFactor 都按它算 */
export const BALL_BASE_SIZE = 104;
/** 太小点不到、太大挡屏幕，缩放只允许这个区间 */
export const BALL_SCALE_MIN = 0.4;
export const BALL_SCALE_MAX = 1.8;

export function clampBallScale(value: unknown, fallback = 1): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(BALL_SCALE_MAX, Math.max(BALL_SCALE_MIN, Math.round(num * 100) / 100));
}

export function ballSizeFor(scale: number, base = BALL_BASE_SIZE): number {
  return Math.round(base * clampBallScale(scale));
}

/** 改大小要围绕球心缩放，否则球每调一档就往右下角挪一点 */
export function scaledSquare(rect: Rect, nextSize: number): { x: number; y: number; size: number } {
  const size = Math.max(1, Math.round(nextSize));
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { x: Math.round(cx - size / 2), y: Math.round(cy - size / 2), size };
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
  /** 状态栏是否显示涨跌幅百分比 */
  pct: boolean;
}

export const DEFAULT_DISPLAY: DisplayToggles = { name: true, up: true, down: true, pct: false };

export function normalizeDisplay(raw: unknown): DisplayToggles {
  const input = (raw ?? {}) as Partial<DisplayToggles>;
  return {
    name: typeof input.name === 'boolean' ? input.name : DEFAULT_DISPLAY.name,
    up: typeof input.up === 'boolean' ? input.up : DEFAULT_DISPLAY.up,
    down: typeof input.down === 'boolean' ? input.down : DEFAULT_DISPLAY.down,
    pct: typeof input.pct === 'boolean' ? input.pct : DEFAULT_DISPLAY.pct,
  };
}

/**
 * 涨跌方向决定颜色：涨红、跌绿，**持平与未知都是 flat（白）**。
 * 颜色只看真实方向，不受显示开关影响。
 */
export type PriceTone = 'up' | 'down' | 'flat';

export function priceTone(pct: number | undefined): PriceTone {
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct === 0) return 'flat';
  return pct < 0 ? 'down' : 'up';
}

/**
 * 箭头要不要出现：关掉对应方向就不显示，持平也没有箭头
 * （否则会出现"白色价格配 ▲"这种自相矛盾的展示）。
 */
export function showArrow(pct: number | undefined, display: DisplayToggles): boolean {
  const tone = priceTone(pct);
  if (tone === 'flat') return false;
  return tone === 'up' ? display.up : display.down;
}

/** 面板把上涨/下跌两个勾选合成一个下拉框；落盘仍是两个布尔，老配置不用迁移 */
export type ArrowMode = 'both' | 'up' | 'down' | 'none';

export const ARROW_MODE_ORDER: ArrowMode[] = ['both', 'up', 'down', 'none'];

export const ARROW_MODE_TEXT: Record<ArrowMode, string> = {
  both: '涨跌都显示',
  up: '只显示上涨',
  down: '只显示下跌',
  none: '不显示箭头',
};

export function arrowModeOf(display: DisplayToggles): ArrowMode {
  if (display.up && display.down) return 'both';
  if (display.up) return 'up';
  if (display.down) return 'down';
  return 'none';
}

/** 只改箭头模式，品种名与涨跌百分比开关原样保留 */
export function displayFromArrowMode(display: DisplayToggles, mode: ArrowMode): DisplayToggles {
  return {
    name: display.name,
    up: mode === 'both' || mode === 'up',
    down: mode === 'both' || mode === 'down',
    pct: display.pct,
  };
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

/** 面板拖拽出来的品种顺序：只收合法字符串并去重，脏数据一律丢掉 */
export function normalizeSymbolOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

/** 按用户顺序排；没排过的品种保持原顺序追加在末尾，新银行不会因为没进列表而消失 */
export function applySymbolOrder<T extends { symbol: string }>(items: T[], order: string[]): T[] {
  if (!order.length) return [...items];
  const out: T[] = [];
  for (const symbol of order) {
    const found = items.find((item) => item.symbol === symbol);
    if (found && !out.includes(found)) out.push(found);
  }
  for (const item of items) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}
