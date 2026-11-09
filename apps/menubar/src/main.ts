import {
  app,
  BrowserWindow,
  nativeTheme,
  Notification,
  Tray,
  ipcMain,
  nativeImage,
  powerMonitor,
  screen,
} from 'electron';
import type { NativeImage } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  applySymbolOrder,
  arrowModeOf,
  ARROW_MODE_ORDER,
  ARROW_MODE_TEXT,
  BALL_BASE_SIZE,
  BALL_SCALE_MAX,
  BALL_SCALE_MIN,
  backoffSeconds,
  ballSizeFor,
  bankSessionAt,
  calcAmount,
  calcDeleteError,
  calcEstimate,
  calcEstimateText,
  calcLedger,
  calcSelection,
  clampBallScale,
  clampIntoWorkArea,
  clampOpacity,
  compileRules,
  coversTaskbar,
  DEFAULT_DISPLAY,
  DEFAULT_TREND_SETTINGS,
  detectTaskbar,
  displayFromArrowMode,
  feeCell,
  formatGrams,
  formatPct,
  formatPrice,
  formatQuoteCells,
  isCalcDate,
  normalizeCalcRecords,
  normalizeDisplay,
  normalizeSymbolOrder,
  normalizeTrendSettings,
  OPACITY_MAX,
  OPACITY_MIN,
  placeOnTaskbar,
  priceTone,
  QuoteStore,
  pollOnce,
  ruleKindOf,
  RULE_KIND_ORDER,
  RULE_KIND_TEXT,
  RULE_KIND_UNIT,
  scaledSquare,
  sendAlertsToBark,
  sendBark,
  showArrow,
  sources,
  spreadCell,
  tradingHoursOf,
  TASKBAR_END_MARGIN,
  TREND_RANGE_ORDER,
  TREND_RANGE_TEXT,
  trendSparkline,
  type AlertRule,
  type ArrowMode,
  type BarkConfig,
  type CalcRecord,
  type CalcSide,
  type DisplayToggles,
  type FiredAlert,
  type HealthReport,
  type PriceTone,
  type Quote,
  type QuoteCells,
  type Rect,
  type RuleKind,
  type SpreadCell,
  type TaskbarInfo,
  type TrendRange,
  type TrendSeries,
  type TrendSettings,
  type TrendSparkline,
} from '@goldsentry/core';
import { watchFullscreen } from './fullscreen.ts';
import { renderStatusStrip } from './status-renderer.ts';
import type { StatusStripInput } from './status-renderer.ts';

app.name = 'GoldSentry';

/**
 * Windows 上 Chromium 会用 DWM 遮挡计算判断窗口是否可见；任务栏文字是
 * `focusable:false` 的置顶透明窗口，盖在任务栏上时容易被判成"全被遮挡"，
 * 于是停止绘制——窗口还在、DOM 也在更新，但文字整块看不见（拖动后尤其容易触发）。
 */
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

/** 面板可选的轮询间隔；最密的 5 秒档仍偏快，默认用 30 秒 */
const ALLOWED_INTERVALS = [5, 10, 30, 60, 120, 300, 600];

let rulesFile = '';
let storeFile = '';
let settingsFile = '';
let calcFile = '';
let rules: AlertRule[] = [];
let calcRecords: CalcRecord[] = [];
let store: QuoteStore;

/** 鼠标悬浮详情行时要展示的银行信息，全部在 core 里算好，面板只贴 */
interface BankDetail {
  name: string;
  source: string;
  basis: string;
  hours: string;
  hoursNote: string;
  session: string;
  sessionOpen: boolean;
  sessionReason: string;
  spreadText: string;
  spreadNote: string;
  fee: string;
  feeNote: string;
  quoteTime: string;
}

interface State {
  quotes: Quote[];
  rules: AlertRule[];
  errors: string[];
  lastPollAt: number;
  primarySymbol: string;
  pollSeconds: number;
  /** 实际生效的间隔：数据源连续失效时会被 core 的退避拉长 */
  effectivePollSeconds: number;
  failureStreak: number;
  launchAtLogin: boolean;
  display: DisplayToggles;
  arrowMode: ArrowMode;
  arrowModes: Array<{ mode: ArrowMode; text: string }>;
  ballScale: { min: number; max: number };
  symbolOrder: string[];
  cells: Record<string, QuoteCells>;
  spreadCells: Record<string, SpreadCell>;
  details: Record<string, BankDetail>;
  ruleKinds: Array<{ kind: RuleKind; text: string; unit: string }>;
  ruleRows: Array<{ symbol: string; kind: RuleKind; value: number | undefined; enabled: boolean }>;
  bark: Settings['bark'];
  ball: Settings['ball'];
  taskbar: Settings['taskbar'];
  health: HealthReport;
  /** 主显品种的分时序列；关闭分时图或首轮取数前为 null */
  trend: TrendSeries | null;
  /** 任务栏迷你走势；面板关闭分时图时仍可单独显示 */
  spark: TrendSparkline | null;
  trendSettings: TrendSettings;
  trendRanges: Array<{ range: TrendRange; text: string }>;
}

let state: State = {
  quotes: [],
  rules: [],
  errors: [],
  lastPollAt: 0,
  primarySymbol: 'ZS',
  pollSeconds: 30,
  effectivePollSeconds: 30,
  failureStreak: 0,
  launchAtLogin: false,
  display: { name: true, up: true, down: true, pct: false },
  arrowMode: 'both',
  arrowModes: ARROW_MODE_ORDER.map((mode) => ({ mode, text: ARROW_MODE_TEXT[mode] })),
  ballScale: { min: BALL_SCALE_MIN, max: BALL_SCALE_MAX },
  symbolOrder: [],
  cells: {},
  spreadCells: {},
  details: {},
  ruleKinds: RULE_KIND_ORDER.map((kind) => ({ kind, text: RULE_KIND_TEXT[kind], unit: RULE_KIND_UNIT[kind] })),
  ruleRows: [],
  bark: { enabled: false, server: 'https://api.day.app', deviceKey: '' },
  ball: { enabled: true, opacity: 0.9, scale: 1, x: null, y: null },
  taskbar: { enabled: true, offset: null, trend: false },
  health: { status: 'ok', reasons: [], marketClosed: false, closedReason: '' },
  trend: null,
  spark: null,
  trendSettings: { enabled: true, range: 'day' },
  trendRanges: [
    { range: '1h', text: '1 小时' },
    { range: '12h', text: '半天' },
    { range: 'day', text: '全天' },
  ],
};

/** 下拉框选项与滑杆区间都来自 core，面板不自己写死 */
function buildUiModels(): Pick<
  State,
  'arrowMode' | 'arrowModes' | 'ballScale' | 'trendSettings' | 'trendRanges'
> {
  return {
    arrowMode: arrowModeOf(settings.display),
    arrowModes: ARROW_MODE_ORDER.map((mode) => ({ mode, text: ARROW_MODE_TEXT[mode] })),
    ballScale: { min: BALL_SCALE_MIN, max: BALL_SCALE_MAX },
    trendSettings: settings.trend,
    trendRanges: TREND_RANGE_ORDER.map((range) => ({ range, text: TREND_RANGE_TEXT[range] })),
  };
}

/** 提醒行的下拉选项与回填值都由 core 算，面板只渲染 */
function buildRuleModels(): Pick<State, 'ruleKinds' | 'ruleRows'> {
  return {
    ruleKinds: RULE_KIND_ORDER.map((kind) => ({ kind, text: RULE_KIND_TEXT[kind], unit: RULE_KIND_UNIT[kind] })),
    ruleRows: rules.map((rule) => {
      const kind = ruleKindOf(rule);
      const value = kind === 'swing' ? rule.absDayChangePct : kind === 'above' ? rule.above : rule.below;
      return { symbol: rule.symbol, kind, value, enabled: rule.enabled };
    }),
  };
}

/** 展示用的字符串全部在 core 里生成，面板只贴文本，不再自己算金额 */
function buildCells(quotes: Quote[]): { cells: Record<string, QuoteCells>; spreadCells: Record<string, SpreadCell> } {
  const cells: Record<string, QuoteCells> = {};
  const spreadCells: Record<string, SpreadCell> = {};
  for (const quote of quotes) {
    cells[quote.symbol] = formatQuoteCells(quote);
    spreadCells[quote.symbol] = spreadCell(quote.spread, quote.symbol);
  }
  return { cells, spreadCells };
}

function buildBankDetails(quotes: Quote[]): { details: Record<string, BankDetail> } {
  const details: Record<string, BankDetail> = {};
  const now = Date.now();
  for (const quote of quotes) {
    const hours = tradingHoursOf(quote.symbol);
    const session = bankSessionAt(quote.symbol, now);
    const fee = feeCell(quote.symbol);
    details[quote.symbol] = {
      name: quote.name,
      source: quote.sourceId === 'jd' ? '京东金融代销' : quote.sourceId === 'ccb' ? '建设银行公开行情' : quote.sourceId,
      basis:
        quote.basis === 'realtime'
          ? '实时报价'
          : quote.basis === 'dailyFix'
            ? '每日 10:30 定价'
            : quote.basis,
      hours: hours?.text ?? '—',
      hoursNote: hours?.note ?? '',
      session: session.text,
      sessionOpen: session.open,
      sessionReason: session.reason,
      spreadText: Number.isFinite(quote.spread) ? formatPrice(quote.spread) : '—',
      spreadNote:
        quote.spread > 0
          ? '点差 = 买入价 − 卖出价'
          : '上游只给单边价，点差恒为 0，不代表免费；请看服务费',
      fee: fee.text,
      feeNote: fee.note,
      quoteTime: new Date(quote.quotedAt).toLocaleTimeString('zh-CN', { hour12: false }),
    };
  }
  return { details };
}

function loadRules(): AlertRule[] {
  try {
    const raw = JSON.parse(readFileSync(rulesFile, 'utf8'));
    if (Array.isArray(raw) && raw.length) return raw as AlertRule[];
  } catch {
    /* 没有文件时用默认阈值落盘，方便用户直接改 */
  }
  const seeded: AlertRule[] = [
    { id: 'JJC-below', symbol: 'JJC', enabled: false, below: 880, cooldownMinutes: 120 },
    { id: 'JJC-above', symbol: 'JJC', enabled: false, above: 900, cooldownMinutes: 120 },
    { id: 'AU9999-swing', symbol: 'AU9999', enabled: false, absDayChangePct: 1, cooldownMinutes: 60 },
  ];
  writeFileSync(rulesFile, JSON.stringify(seeded, null, 2));
  return seeded;
}

function saveRules(): void {
  writeFileSync(rulesFile, JSON.stringify(rules, null, 2));
}

interface Settings {
  primarySymbol: string;
  pollSeconds: number;
  launchAtLogin: boolean;
  display: DisplayToggles;
  symbolOrder: string[];
  bark: { enabled: boolean; server: string; deviceKey: string };
  ball: { enabled: boolean; opacity: number; scale: number; x: number | null; y: number | null };
  taskbar: { enabled: boolean; offset: number | null; trend: boolean };
  trend: TrendSettings;
}

const DEFAULT_SETTINGS: Settings = {
  primarySymbol: 'ZS',
  pollSeconds: 30,
  launchAtLogin: false,
  display: DEFAULT_DISPLAY,
  symbolOrder: [],
  bark: { enabled: false, server: 'https://api.day.app', deviceKey: '' },
  ball: { enabled: true, opacity: 0.9, scale: 1, x: null, y: null },
  taskbar: { enabled: true, offset: null, trend: false },
  trend: DEFAULT_TREND_SETTINGS,
};

let settings: Settings = {
  ...DEFAULT_SETTINGS,
  display: { ...DEFAULT_DISPLAY },
  symbolOrder: [],
  bark: { ...DEFAULT_SETTINGS.bark },
  ball: { ...DEFAULT_SETTINGS.ball },
  taskbar: { ...DEFAULT_SETTINGS.taskbar },
  trend: { ...DEFAULT_TREND_SETTINGS },
};

/** deviceKey 明文落在 userData/settings.json（不在仓库里），面板输入框用 password 遮罩 */
function loadSettings(): Settings {
  const point = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  try {
    const raw = JSON.parse(readFileSync(settingsFile, 'utf8'));
    const seconds = Number(raw.pollSeconds);
    return {
      primarySymbol: String(raw.primarySymbol ?? DEFAULT_SETTINGS.primarySymbol),
      pollSeconds: ALLOWED_INTERVALS.includes(seconds) ? seconds : DEFAULT_SETTINGS.pollSeconds,
      launchAtLogin: raw.launchAtLogin === true,
      display: normalizeDisplay(raw.display),
      symbolOrder: normalizeSymbolOrder(raw.symbolOrder),
      bark: { ...DEFAULT_SETTINGS.bark, ...(raw.bark ?? {}) },
      ball: {
        enabled: raw.ball?.enabled !== false,
        opacity: clampOpacity(raw.ball?.opacity, DEFAULT_SETTINGS.ball.opacity),
        scale: clampBallScale(raw.ball?.scale, DEFAULT_SETTINGS.ball.scale),
        x: point(raw.ball?.x),
        y: point(raw.ball?.y),
      },
      taskbar: {
        enabled: raw.taskbar?.enabled !== false,
        offset: point(raw.taskbar?.offset),
        trend: raw.taskbar?.trend === true,
      },
      trend: normalizeTrendSettings(raw.trend),
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      display: { ...DEFAULT_DISPLAY },
      bark: { ...DEFAULT_SETTINGS.bark },
      ball: { ...DEFAULT_SETTINGS.ball },
      taskbar: { ...DEFAULT_SETTINGS.taskbar },
      trend: { ...DEFAULT_TREND_SETTINGS },
    };
  }
}

function saveSettings(): void {
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

/* ---------- 均价计算器 ---------- */

interface CalcRowView {
  id: string;
  side: CalcSide;
  date: string;
  gramsText: string;
  priceText: string;
  amountText: string;
}

interface CalcBaseView {
  rows: CalcRowView[];
  symbols: Array<{ symbol: string; label: string }>;
  defaultSymbol: string;
  counts: { total: number; buys: number; sells: number };
}

interface CalcStatsView {
  selected: { gramsText: string; countText: string; costText: string; avgText: string };
  ledger: {
    gramsText: string;
    costText: string;
    avgCostText: string;
    realizedText: string;
    realizedTone: PriceTone;
    invalidNote: string;
  };
  quote: { symbol: string; label: string; buyText: string; sellText: string } | null;
  estimate: { valueText: string; pnlText: string; pnlPctText: string; tone: PriceTone } | null;
}

function loadCalcRecords(): CalcRecord[] {
  try {
    const raw = JSON.parse(readFileSync(calcFile, 'utf8'));
    return normalizeCalcRecords(Array.isArray(raw) ? raw : raw?.records);
  } catch {
    return [];
  }
}

function saveCalcRecords(): void {
  writeFileSync(calcFile, JSON.stringify({ records: calcRecords }, null, 2));
}

function normalizeCalcIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item || out.includes(item)) continue;
    out.push(item);
  }
  return out;
}

function calcSymbols(): Array<{ symbol: string; label: string }> {
  return applySymbolOrder(state.quotes, settings.symbolOrder).map((quote) => ({
    symbol: quote.symbol,
    label: quote.label,
  }));
}

function buildCalcBase(): CalcBaseView {
  const sorted = [...calcRecords].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt || a.id.localeCompare(b.id),
  );
  return {
    rows: sorted.map((record) => ({
      id: record.id,
      side: record.side,
      date: record.date,
      gramsText: formatGrams(record.grams),
      priceText: formatPrice(record.price),
      amountText: `¥${formatPrice(calcAmount(record))}`,
    })),
    symbols: calcSymbols(),
    defaultSymbol: settings.primarySymbol,
    counts: {
      total: calcRecords.length,
      buys: calcRecords.filter((record) => record.side === 'buy').length,
      sells: calcRecords.filter((record) => record.side === 'sell').length,
    },
  };
}

function buildCalcStats(symbol: string, ids: string[]): CalcStatsView {
  const quotes = applySymbolOrder(state.quotes, settings.symbolOrder);
  const chosen =
    quotes.find((quote) => quote.symbol === symbol) ??
    quotes.find((quote) => quote.symbol === settings.primarySymbol) ??
    quotes[0];
  const selection = calcSelection(calcRecords, ids);
  const picked = new Set(ids);
  const selectedBuys = calcRecords.filter((record) => record.side === 'buy' && picked.has(record.id)).length;
  const totalBuys = calcRecords.filter((record) => record.side === 'buy').length;
  const ledger = calcLedger(calcRecords);
  const estimate = calcEstimate(ledger, chosen?.sellPrice);
  const estimateText = calcEstimateText(estimate);
  return {
    selected: {
      gramsText: formatGrams(selection.grams),
      countText: `${selectedBuys}/${totalBuys} 条`,
      costText: `¥${formatPrice(selection.cost)}`,
      avgText: selection.avgPrice === null ? '—' : formatPrice(selection.avgPrice),
    },
    ledger: {
      gramsText: formatGrams(ledger.grams),
      costText: `¥${formatPrice(ledger.cost)}`,
      avgCostText: ledger.avgCost === null ? '—' : formatPrice(ledger.avgCost),
      realizedText: `${ledger.realized >= 0 ? '+' : ''}${formatPrice(ledger.realized)}`,
      realizedTone: priceTone(ledger.realized),
      invalidNote: ledger.invalidNote,
    },
    quote: chosen
      ? {
          symbol: chosen.symbol,
          label: chosen.label,
          buyText: formatPrice(chosen.buyPrice),
          sellText: formatPrice(chosen.sellPrice),
        }
      : null,
    estimate: estimate
      ? {
          valueText: `¥${formatPrice(estimate.value)}`,
          pnlText: estimateText.pnl,
          pnlPctText: estimateText.pct,
          tone: estimate.tone,
        }
      : null,
  };
}

function calcView(symbol: unknown, ids: unknown): { ok: true; base: CalcBaseView; stats: CalcStatsView } {
  return {
    ok: true,
    base: buildCalcBase(),
    stats: buildCalcStats(typeof symbol === 'string' ? symbol : '', normalizeCalcIds(ids)),
  };
}

function barkConfig(): BarkConfig {
  return {
    server: settings.bark.server,
    deviceKey: settings.bark.deviceKey,
    group: 'GoldSentry',
    level: 'timeSensitive',
  };
}

function applyPrimarySymbol(symbol: string): void {
  settings.primarySymbol = symbol;
  saveSettings();
  updateTrayTitle();
  pushState();
}

let tray: Tray | null = null;
let trayLogo: NativeImage | null = null;
/** 菜单栏图标当前表达的方向：logo=单色品牌图，up/down=彩色三角形 */
let trayTone: 'logo' | 'up' | 'down' = 'logo';
let panel: BrowserWindow | null = null;
let lastTrayTitle = '';
/** 面板刚创建时页面还没加载完，这时发 panel:mode 会被丢掉，右键首次打开会停在详情页 */
let panelReady = false;
let pendingMode: PanelMode | null = null;

function flushPanelMode(win: BrowserWindow): void {
  if (!panelReady) {
    pendingMode = panelMode;
    return;
  }
  win.webContents.send('panel:mode', panelMode);
  win.webContents.send('gold:update', state);
}

function createPanel(): BrowserWindow {
  const win = new BrowserWindow({
    width: 440,
    height: 660,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, 'panel.html'));
  win.webContents.once('did-finish-load', () => {
    panelReady = true;
    win.webContents.send('gold:update', state);
    if (pendingMode) {
      win.webContents.send('panel:mode', pendingMode);
      pendingMode = null;
    }
  });
  win.on('blur', () => win.hide());
  win.on('closed', () => {
    panelReady = false;
    if (panel === win) panel = null;
  });
  return win;
}

type PanelAnchor = 'tray' | 'ball' | 'taskbar';

/**
 * macOS 状态项带标题或图片后 getBounds 返回的是整块宽度（实测文字 66~109px、
 * 图片 121px），不能按图标尺寸卡；Windows 托盘图标才是 16px 方块，
 * 超过半条任务栏说明拿到的不是图标位置。
 */
const TRAY_ICON_MAX_WIDTH = process.platform === 'darwin' ? 360 : 64;

function iconRect(): Rect | null {
  const bounds = tray?.getBounds();
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
  if (bounds.width > TRAY_ICON_MAX_WIDTH) return null;
  const { workArea } = screen.getDisplayMatching(bounds);
  if (bounds.x + bounds.width < workArea.x || bounds.x > workArea.x + workArea.width) return null;
  return bounds;
}

function ballRect(): Rect | null {
  if (!ball || ball.isDestroyed() || !ball.isVisible()) return null;
  return ball.getBounds();
}

function taskbarRect(): Rect | null {
  if (!taskbarWin || taskbarWin.isDestroyed() || !taskbarWin.isVisible()) return null;
  return taskbarWin.getBounds();
}

/** 面板要弹在真正点开它的那个入口旁边；入口自己拿不到位置时，退到另外两个入口 */
function anchorRect(source: PanelAnchor): Rect | null {
  const chain =
    source === 'taskbar'
      ? [taskbarRect(), ballRect(), iconRect()]
      : source === 'ball'
        ? [ballRect(), taskbarRect(), iconRect()]
        : [iconRect(), taskbarRect(), ballRect()];
  return chain.find((rect) => rect !== null) ?? null;
}

function positionPanel(source: PanelAnchor): void {
  if (!panel) return;
  const { width, height } = panel.getBounds();
  const anchor = anchorRect(source);
  if (!anchor) {
    const { workArea } = screen.getPrimaryDisplay();
    const pos = clampIntoWorkArea(
      { x: workArea.x + workArea.width - width - 8, y: workArea.y + workArea.height - height - 8, width, height },
      workArea,
    );
    panel.setPosition(pos.x, pos.y);
    console.log('[panel] 没有可用锚点，退回工作区右下角');
    return;
  }
  const { workArea } = screen.getDisplayMatching(anchor);
  const rawX = Math.round(anchor.x + anchor.width / 2 - width / 2);
  // macOS 菜单栏在屏幕顶，Windows 托盘在任务栏（屏幕底），面板要往相反方向弹。
  // 顶部的贴住菜单栏下沿（锚点底边就是 workArea 顶边），底部留 6px 不压任务栏。
  const inBottomHalf = anchor.y + anchor.height / 2 > workArea.y + workArea.height / 2;
  const rawY = Math.round(inBottomHalf ? anchor.y - height - 6 : anchor.y + anchor.height);
  const pos = clampIntoWorkArea({ x: rawX, y: rawY, width, height }, workArea);
  panel.setPosition(pos.x, pos.y);
  console.log(
    `[panel] anchor=${source} rect=${Math.round(anchor.x)},${Math.round(anchor.y)} ${Math.round(anchor.width)}x${Math.round(anchor.height)} -> ${pos.x},${pos.y}`,
  );
}

function pushState(): void {
  const quotes = applySymbolOrder(state.quotes, settings.symbolOrder);
  const marketClosed = state.health.status === 'ok' && state.health.marketClosed;
  const wantSeries = settings.trend.enabled || (supportsTaskbar() && settings.taskbar.trend);
  const series = wantSeries
    ? store.trend(settings.primarySymbol, Date.now(), {
        preferPreviousDay: marketClosed,
        range: settings.trend.range,
      })
    : null;
  state = {
    ...state,
    quotes,
    ...buildCells(quotes),
    ...buildBankDetails(quotes),
    ...buildRuleModels(),
    ...buildUiModels(),
    trend: settings.trend.enabled ? series : null,
    // 面板图表关闭时任务栏仍可单独显示走势
    spark: supportsTaskbar() && settings.taskbar.trend && series ? trendSparkline(series) : null,
    rules,
    primarySymbol: settings.primarySymbol,
    pollSeconds: settings.pollSeconds,
    effectivePollSeconds: effectiveSeconds,
    display: settings.display,
    symbolOrder: settings.symbolOrder,
    bark: settings.bark,
    ball: settings.ball,
    taskbar: settings.taskbar,
  };
  panel?.webContents.send('gold:update', state);
  pushBall();
  pushTaskbar();
}

let ball: BrowserWindow | null = null;

/** 悬浮球是 Windows 上"菜单栏文字"的替身；macOS 有真菜单栏，不做第二个入口 */
function supportsBall(): boolean {
  return process.platform === 'win32';
}

function workAreaOf(win: BrowserWindow): { x: number; y: number; width: number; height: number } {
  const { workArea } = screen.getDisplayMatching(win.getBounds());
  return workArea;
}

/** 拖动与换分辨率都可能把球推出屏幕，这里夹回工作区 */
function clampBall(win: BrowserWindow): void {
  const bounds = win.getBounds();
  const work = workAreaOf(win);
  const next = clampIntoWorkArea(bounds, work);
  if (next.x !== bounds.x || next.y !== bounds.y) win.setPosition(next.x, next.y);
}

function createBall(): BrowserWindow {
  const size = ballSizeFor(settings.ball.scale);
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    // 拖动自己实现（pointer 事件 + setPosition），用系统 movable 会吞掉滚轮事件
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, 'ball-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  const saved =
    settings.ball.x !== null && settings.ball.y !== null
      ? { x: settings.ball.x, y: settings.ball.y }
      : (() => {
          const { workArea } = screen.getPrimaryDisplay();
          return {
            x: workArea.x + workArea.width - size - 24,
            y: workArea.y + workArea.height - size - 24,
          };
        })();
  win.setPosition(saved.x, saved.y);
  clampBall(win);
  win.loadFile(join(__dirname, 'ball.html'));
  // 缩放靠 zoomFactor：字号、圆角、边框一起等比例变，不用改 CSS
  win.webContents.setZoomFactor(settings.ball.scale);
  // 必须等首帧：早于 ready-to-show 发过去，渲染进程还没挂上监听，球会空到下一次轮询
  win.once('ready-to-show', () => {
    win.webContents.setZoomFactor(settings.ball.scale);
    win.showInactive();
    pushBall();
  });
  win.on('closed', () => {
    if (ball === win) ball = null;
  });
  return win;
}

/** 等比例缩放：窗口尺寸与 zoomFactor 一起改，且围绕球心，否则每调一档球就往右下挪 */
function applyBallScale(value: unknown): void {
  const next = clampBallScale(value, settings.ball.scale);
  if (next === settings.ball.scale) return;
  settings.ball.scale = next;
  saveSettings();
  if (ball && !ball.isDestroyed()) {
    const bounds = ball.getBounds();
    const placed = scaledSquare(bounds, ballSizeFor(next));
    ball.setBounds({ x: placed.x, y: placed.y, width: placed.size, height: placed.size });
    ball.webContents.setZoomFactor(next);
    clampBall(ball);
  }
  pushState();
}

function setBallVisible(visible: boolean): void {
  if (!supportsBall()) return;
  if (visible) {
    if (!ball || ball.isDestroyed()) ball = createBall();
    else ball.showInactive();
    ball.setOpacity(settings.ball.opacity);
    pushBall();
  } else {
    stopBallDrag(false);
    ball?.hide();
  }
  settings.ball.enabled = visible;
  saveSettings();
  pushState();
}

function applyBallOpacity(value: unknown): void {
  settings.ball.opacity = clampOpacity(value, settings.ball.opacity);
  ball?.setOpacity(settings.ball.opacity);
  saveSettings();
  // 球上滚轮改的要同步回面板滑杆
  panel?.webContents.send('gold:update', { ...state, ball: settings.ball });
}

function saveBallPosition(): void {
  if (!ball) return;
  const [x, y] = ball.getPosition();
  settings.ball.x = x;
  settings.ball.y = y;
  saveSettings();
}

/** 悬浮球与任务栏文字共用同一条"瞟一眼"数据；显示哪些片段由 settings.display 决定 */
function readout(): { label: string; price: string; pct: string; arrow: string; tone: PriceTone; mark: string } {
  const picked = primaryQuote();
  const pct = picked?.dayChangePct;
  // 颜色永远按真实涨跌（持平才白色）；开关只决定箭头出不出现
  const tone = priceTone(pct);
  return {
    label: settings.display.name ? (picked?.label ?? '—') : '',
    price: picked ? formatPrice(picked.buyPrice) : '—',
    pct:
      settings.display.pct && typeof pct === 'number' && Number.isFinite(pct)
        ? formatPct(pct)
        : '',
    arrow: showArrow(pct, settings.display) ? (tone === 'down' ? '▼' : '▲') : '',
    tone,
    mark: state.health.status === 'offline' ? '×' : state.health.status === 'degraded' ? '!' : '',
  };
}

function pushBall(): void {
  if (!ball || ball.isDestroyed() || !ball.isVisible()) return;
  ball.webContents.send('ball:update', readout());
}

const TASKBAR_DEFAULT_WIDTH = 120;
const TASKBAR_MAX_SIZE = 400;
let taskbarWin: BrowserWindow | null = null;
let taskbarContent = { width: TASKBAR_DEFAULT_WIDTH, height: 22 };
let taskbarEdge: string | null = null;
let stopFullscreenWatch: (() => void) | null = null;
let fullscreenMonitors: Rect[] = [];

/** 全屏视频/游戏时任务栏被盖住，workArea 却还保留任务栏的保留区；只能枚举前台窗口问系统 */
function syncFullscreenWatch(): void {
  if (!supportsTaskbar()) return;
  if (!settings.taskbar.enabled) {
    stopFullscreenWatch?.();
    stopFullscreenWatch = null;
    fullscreenMonitors = [];
    return;
  }
  if (stopFullscreenWatch) return;
  const watch = watchFullscreen((rects) => {
    fullscreenMonitors = rects;
    console.log(`[fullscreen] ${rects.length ? `全屏覆盖 ${rects.length} 块显示器` : '全屏结束'}`);
    layoutTaskbar();
  });
  stopFullscreenWatch = () => watch.stop();
}

app.on('will-quit', () => {
  stopFullscreenWatch?.();
  stopFullscreenWatch = null;
  stopBallDrag(false);
  stopTaskbarDrag(false);
});

/** TrafficMonitor 式贴附：Electron 嵌不进 Shell_TrayWnd，就用置顶透明窗口盖在任务栏上 */
function supportsTaskbar(): boolean {
  return process.platform === 'win32';
}

/** 主屏没有任务栏保留区时再找副屏，任务栏允许被拖到任一显示器 */
function taskbarInfo(): TaskbarInfo | null {
  const primary = screen.getPrimaryDisplay();
  const displays = [primary, ...screen.getAllDisplays().filter((display) => display.id !== primary.id)];
  for (const display of displays) {
    const info = detectTaskbar(display.bounds, display.workArea);
    if (info) return info;
  }
  return null;
}

function layoutTaskbar(): void {
  if (!settings.taskbar.enabled) {
    if (taskbarWin && !taskbarWin.isDestroyed() && taskbarWin.isVisible()) taskbarWin.hide();
    return;
  }
  // 渲染进程崩溃或被系统关掉后，这里自愈重建，不让文字永久消失
  if (!taskbarWin || taskbarWin.isDestroyed()) {
    taskbarWin = createTaskbar();
    return;
  }
  const win = taskbarWin;
  const info = taskbarInfo();
  if (!info) {
    // 任务栏自动隐藏时贴附窗口会悬在半空，跟着藏起来；每轮轮询会再试
    if (win.isVisible()) win.hide();
    return;
  }
  if (fullscreenMonitors.some((monitor) => coversTaskbar(monitor, info.rect))) {
    if (win.isVisible()) win.hide();
    return;
  }
  const rect = placeOnTaskbar(taskbarContent, info, settings.taskbar.offset, TASKBAR_END_MARGIN);
  const current = win.getBounds();
  if (
    current.x !== rect.x ||
    current.y !== rect.y ||
    current.width !== rect.width ||
    current.height !== rect.height
  ) {
    win.setBounds(rect);
  }
  if (!win.isVisible()) win.showInactive();
  if (taskbarEdge !== info.edge) {
    taskbarEdge = info.edge;
    win.webContents.send('taskbar:layout', {
      edge: info.edge,
      vertical: info.edge === 'left' || info.edge === 'right',
    });
  }
}

function createTaskbar(): BrowserWindow {
  taskbarEdge = null;
  const win = new BrowserWindow({
    width: TASKBAR_DEFAULT_WIDTH,
    height: 24,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    // 位置自己按任务栏算，系统拖动会和贴边逻辑打架
    movable: false,
    // 贴纸不该抢当前窗口焦点
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, 'taskbar-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setSkipTaskbar(true);
  win.loadFile(join(__dirname, 'taskbar.html'));
  win.once('ready-to-show', () => {
    // 创建时 layout 可能早于页面加载，layout 消息会被丢掉；这里补发一次
    taskbarEdge = null;
    layoutTaskbar();
    pushTaskbar();
  });
  win.on('closed', () => {
    stopTaskbarDrag(false);
    if (taskbarWin === win) taskbarWin = null;
  });
  return win;
}

function setTaskbarVisible(visible: boolean): void {
  if (!supportsTaskbar()) return;
  settings.taskbar.enabled = visible;
  saveSettings();
  syncFullscreenWatch();
  if (visible) {
    if (!taskbarWin || taskbarWin.isDestroyed()) taskbarWin = createTaskbar();
    layoutTaskbar();
    pushTaskbar();
  } else {
    stopTaskbarDrag(false);
    taskbarWin?.hide();
  }
  pushState();
}

function saveTaskbarOffset(): void {
  if (!taskbarWin || taskbarWin.isDestroyed()) return;
  const bounds = taskbarWin.getBounds();
  settings.taskbar.offset = taskbarEdge === 'left' || taskbarEdge === 'right' ? bounds.y : bounds.x;
  saveSettings();
}

function pushTaskbar(): void {
  if (!taskbarWin || taskbarWin.isDestroyed() || !taskbarWin.isVisible()) return;
  // 走势只给任务栏，悬浮球保持原来的文字信息
  taskbarWin.webContents.send('taskbar:update', { ...readout(), spark: state.spark });
}

function notifyNative(alerts: FiredAlert[]): void {
  for (const alert of alerts) {
    new Notification({ title: alert.title, body: alert.body, silent: false }).show();
  }
}

async function dispatch(alerts: FiredAlert[]): Promise<void> {
  notifyNative(alerts);
  if (!settings.bark.enabled) return;
  const errors = await sendAlertsToBark(barkConfig(), alerts);
  if (errors.length) {
    state = { ...state, errors: [...state.errors, ...errors] };
    pushState();
    console.log(`[bark] ${errors.join('; ')}`);
  }
}

let pollTimer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
let effectiveSeconds = 30;
let launchAtLogin = false;

/** 未打包时注册进系统的是 Electron 本体而不是 GoldSentry，开发态不提供这个开关 */
function supportsLoginItem(): boolean {
  if (!app.isPackaged) return false;
  if (process.platform === 'darwin') return !app.getPath('exe').startsWith('/Volumes/');
  return process.platform === 'win32';
}

/** 开关不能用时把原因带回面板，别让用户以为点了没反应 */
function loginItemReason(): string {
  if (!app.isPackaged) return '开发模式不写入系统登录项，打包安装后可用';
  if (process.platform === 'darwin' && app.getPath('exe').startsWith('/Volumes/')) {
    return '请先把 GoldSentry 拖到「应用程序」文件夹，再开启开机自启';
  }
  return '';
}

function syncLoginItem(): void {
  if (!supportsLoginItem()) {
    launchAtLogin = false;
    return;
  }
  // portable 每次运行都解压到新的临时目录，注册 execPath 下次就指向不存在的地方；
  // electron-builder 会把原始 portable exe 路径放进这个环境变量
  const path = process.platform === 'win32' ? process.env.PORTABLE_EXECUTABLE_FILE || process.execPath : undefined;
  app.setLoginItemSettings(path ? { openAtLogin: settings.launchAtLogin, path } : { openAtLogin: settings.launchAtLogin });
  // 回读系统真实值：用户可能在任务管理器/系统设置里自己关掉了
  launchAtLogin = app.getLoginItemSettings(path ? { path } : {}).openAtLogin;
}

function scheduleNext(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void poll(), effectiveSeconds * 1000);
}

async function poll(): Promise<void> {
  // 手动刷新可能撞上定时器；撞上了就丢掉这次，否则会并行出两条 setTimeout 链
  if (polling) return;
  polling = true;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = undefined;
  }
  try {
    const result = await pollOnce(sources, store, rules);
    const quotes = applySymbolOrder(result.quotes, settings.symbolOrder);
    effectiveSeconds = backoffSeconds(settings.pollSeconds, result.failureStreak);
    state = {
      quotes,
      ...buildCells(quotes),
      ...buildBankDetails(quotes),
      ...buildRuleModels(),
      ...buildUiModels(),
      rules,
      errors: result.errors,
      lastPollAt: Date.now(),
      primarySymbol: settings.primarySymbol,
      pollSeconds: settings.pollSeconds,
      effectivePollSeconds: effectiveSeconds,
      failureStreak: result.failureStreak,
      launchAtLogin,
      display: settings.display,
      symbolOrder: settings.symbolOrder,
      bark: settings.bark,
      ball: settings.ball,
      taskbar: settings.taskbar,
      health: result.health,
      trend: state.trend,
      spark: state.spark,
    };
    updateTrayTitle();
    layoutTaskbar();
    pushState();
    if (result.alerts.length) await dispatch(result.alerts);
  } finally {
    polling = false;
    scheduleNext();
  }
}

function restartTimer(): void {
  effectiveSeconds = settings.pollSeconds;
  scheduleNext();
}

/** 主显品种优先；取不到就退到最新的一条实时价，避免显示滞后的日定价 */
function primaryQuote(): Quote | undefined {
  const primary = state.quotes.find((q) => q.symbol === settings.primarySymbol);
  return (
    primary ??
    state.quotes
      .filter((q) => q.basis === 'realtime')
      .sort((a, b) => b.quotedAt - a.quotedAt)[0]
  );
}

/**
 * 方向与红绿只放在图标上：macOS 上涨红 ▲、下跌绿 ▼，文字保持系统白/黑；
 * 关掉对应方向或持平时退回品牌图标。Windows 方向仍在文字里用 ▲▼ 表达。
 */
function applyTrayTone(picked: Quote | undefined): void {
  if (!tray || !trayLogo) return;
  const pct = picked?.dayChangePct;
  const tone = showArrow(pct, settings.display) ? priceTone(pct) : 'flat';
  const want = process.platform === 'darwin' && tone !== 'flat' ? tone : 'logo';
  if (want === trayTone) return;
  trayTone = want;
  const image =
    want === 'logo' ? trayLogo : nativeImage.createFromPath(join(__dirname, 'assets', `tray-${want}.png`));
  tray.setImage(image);
  console.log(`[tray] icon=${want} ${image.getSize().width}x${image.getSize().height} empty=${image.isEmpty()}`);
}

function updateTrayTooltip(picked: Quote | undefined): void {
  const priceLine = picked
    ? `${picked.name} 买入 ${formatPrice(picked.buyPrice)} · 卖出 ${formatPrice(picked.sellPrice)}${
        picked.dayChangePct !== undefined && Number.isFinite(picked.dayChangePct)
          ? ` · ${formatPct(picked.dayChangePct)}`
          : ''
      }`
    : 'GoldSentry 等待首次取数';
  // 休市与故障分开说：故障优先，正常休市只解释报价为什么不动
  const lines = [priceLine];
  if (state.health.reasons.length) lines.push(`数据源异常：${state.health.reasons.join('；')}`);
  else if (state.health.marketClosed) lines.push(`休市：${state.health.closedReason}`);
  tray?.setToolTip(lines.join('\n'));
}

let stripSignature = '';
let stripJob: { signature: string; input: StatusStripInput } | null = null;
let stripRendering = false;
let stripFailed = false;

/**
 * 菜单栏标题只能由系统画成单色，Electron 也没法把托盘图标放到标题后面。
 * 要「白字 + 末尾一个彩色三角」只能把整条内容画成图片当图标。
 * 渲染失败时退回系统标题 + 左侧彩色三角，功能不受影响。
 */
function queueStatusStrip(input: StatusStripInput): void {
  if (!tray || stripFailed) return;
  const signature = JSON.stringify(input);
  if (signature === stripSignature) return;
  stripJob = { signature, input };
  if (stripRendering) return;
  stripRendering = true;
  void pumpStatusStrip();
}

async function pumpStatusStrip(): Promise<void> {
  try {
    while (stripJob && tray) {
      const job = stripJob;
      stripJob = null;
      const image = await renderStatusStrip(job.input);
      if (!image) {
        stripFailed = true;
        stripJob = null;
        if (trayLogo) tray.setImage(trayLogo);
        updateTrayTitle();
        return;
      }
      stripSignature = job.signature;
      tray.setImage(image);
      tray.setTitle('');
      console.log(`[tray] strip=${image.getSize().width}x${image.getSize().height} ${JSON.stringify(job.input)}`);
    }
  } finally {
    stripRendering = false;
  }
}

function updateTrayTitle(): void {
  if (!tray) return;
  const picked = primaryQuote();
  const view = readout();
  updateTrayTooltip(picked);
  if (process.platform === 'darwin' && !stripFailed) {
    queueStatusStrip({
      label: picked ? view.label : '',
      price: picked ? view.price : '--',
      pct: view.pct,
      arrow: view.arrow,
      mark: view.mark,
      tone: view.tone,
      dark: nativeTheme.shouldUseDarkColors,
    });
    return;
  }
  applyTrayTone(picked);
  // 渲染失败/Windows：系统标题 + 左侧图标兜底，顺序是「名称 价格 ▲ 百分比」
  const title = picked
    ? ` ${view.mark}${[view.label, view.price, view.arrow, view.pct].filter(Boolean).join(' ')}`
    : ` ${view.mark || '?'}--`;
  const changed = title !== lastTrayTitle;
  lastTrayTitle = title;
  tray.setTitle(title);
  if (changed) console.log(`[tray] title="${title}" ${Notification.isSupported() ? '通知可用' : '通知不可用'}`);
}

type PanelMode = 'detail' | 'settings';
let panelMode: PanelMode = 'detail';

/** 所有形态统一：左键看详情，右键进设置；再次点同一侧则收起 */
function showPanel(mode: PanelMode, source: PanelAnchor = 'tray'): void {
  if (!panel) panel = createPanel();
  if (panel.isVisible() && panelMode === mode) {
    panel.hide();
    return;
  }
  panelMode = mode;
  positionPanel(source);
  panel.show();
  flushPanelMode(panel);
}

function sendTestNotification(): void {
  new Notification({
    title: 'GoldSentry 通知测试',
    body: '看到这条说明提醒链路是通的',
  }).show();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.dock?.hide();

  void app.whenReady().then(() => {
    rulesFile = join(app.getPath('userData'), 'rules.json');
    storeFile = join(app.getPath('userData'), 'quotes.json');
    settingsFile = join(app.getPath('userData'), 'settings.json');
    calcFile = join(app.getPath('userData'), 'calculator.json');
    rules = loadRules();
    settings = loadSettings();
    calcRecords = loadCalcRecords();
    store = new QuoteStore(storeFile);

    // template 图是纯黑剪影，只适配 macOS 菜单栏；Windows 任务栏是浅色底，要用彩色图标
    trayLogo =
      process.platform === 'darwin'
        ? (() => {
            const img = nativeImage.createEmpty();
            for (const [scaleFactor, file] of [
              [1, 'iconTemplate.png'],
              [2, 'iconTemplate@2x.png'],
            ] as const) {
              img.addRepresentation({
                scaleFactor,
                buffer: readFileSync(join(__dirname, 'assets', file)),
              });
            }
            img.setTemplateImage(true);
            return img;
          })()
        : nativeImage.createFromPath(join(__dirname, 'assets', 'tray-glyph.png'));
    tray = new Tray(trayLogo);
    tray.on('click', () => showPanel('detail'));
    tray.on('right-click', () => showPanel('settings'));

    // 拔显示器 / 改分辨率后球可能整个跑到屏幕外，任务栏贴附也要重排
    const relayout = () => {
      if (ball && ball.isVisible()) clampBall(ball);
      layoutTaskbar();
    };
    screen.on('display-metrics-changed', relayout);
    screen.on('display-removed', relayout);
    screen.on('display-added', relayout);
    // 菜单栏文字是画出来的，系统深浅色切换后要按新底色重画
    nativeTheme.on('updated', () => updateTrayTitle());

    // 休眠期间探针可能被杀，醒来先按"全屏结束"恢复文字，等探针重新上报
    powerMonitor.on('resume', () => {
      fullscreenMonitors = [];
      layoutTaskbar();
      void poll();
    });
    syncLoginItem();
    void poll();
    restartTimer();
    if (settings.ball.enabled) setBallVisible(true);
    if (settings.taskbar.enabled) setTaskbarVisible(true);
    if (process.env.GOLDSENTRY_TEST_NOTIFY === '1') sendTestNotification();
  });
}

ipcMain.handle('gold:state', () => state);
// 面板 .then(applyState)，返回 void 会让渲染层拿到 undefined 后抛异常
ipcMain.handle('gold:refresh', async () => {
  await poll();
  return state;
});
ipcMain.handle('gold:save-rules', (_event, rows: unknown) => {
  rules = compileRules(rows);
  saveRules();
  pushState();
  // 面板 .then(applyState)，必须拿到完整 state 才不会被局部字段打断渲染
  return state;
});
ipcMain.handle('gold:set-primary', (_event, symbol: string) => {
  applyPrimarySymbol(symbol);
  return state;
});
ipcMain.handle('gold:set-interval', (_event, seconds: number) => {
  if (!ALLOWED_INTERVALS.includes(Number(seconds))) return { ok: false, error: '非法间隔' };
  settings.pollSeconds = Number(seconds);
  saveSettings();
  restartTimer();
  pushState();
  return { ok: true, pollSeconds: settings.pollSeconds };
});
ipcMain.handle('gold:save-bark', (_event, bark: Settings['bark']) => {
  settings.bark = { enabled: !!bark.enabled, server: bark.server.trim(), deviceKey: bark.deviceKey.trim() };
  saveSettings();
  pushState();
  return { enabled: settings.bark.enabled, server: settings.bark.server, hasKey: !!settings.bark.deviceKey };
});
ipcMain.handle('gold:bark-test', () => sendBark(barkConfig(), {
  title: 'GoldSentry 推送通道测试',
  body: '收到说明 Bark 已打通',
}));
ipcMain.handle('gold:capabilities', () => ({
  ball: supportsBall(),
  taskbar: supportsTaskbar(),
  loginItem: supportsLoginItem(),
  loginItemPlatform: process.platform === 'win32' || process.platform === 'darwin',
  loginItemReason: loginItemReason(),
}));
ipcMain.handle('gold:set-launch-at-login', (_event, enabled: unknown) => {
  settings.launchAtLogin = enabled === true;
  saveSettings();
  syncLoginItem();
  state = { ...state, launchAtLogin };
  pushState();
  return state;
});
ipcMain.handle('gold:set-ball', (_event, next: { enabled?: boolean; opacity?: number; scale?: number }) => {
  // 先缩放再决定显隐：新建球时 createBall 要按新尺寸落位
  if (next.scale !== undefined) applyBallScale(next.scale);
  if (typeof next.opacity === 'number') applyBallOpacity(next.opacity);
  if (typeof next.enabled === 'boolean') setBallVisible(next.enabled);
  return { ...settings.ball, supported: supportsBall() };
});
ipcMain.handle('gold:set-taskbar', (_event, next: { enabled?: boolean; trend?: boolean }) => {
  if (typeof next?.enabled === 'boolean') setTaskbarVisible(next.enabled);
  if (typeof next?.trend === 'boolean') {
    settings.taskbar.trend = next.trend;
    saveSettings();
  }
  pushState();
  return state;
});
/** 面板长按拖拽出来的品种顺序；只影响面板列表，球与任务栏文字仍只看主显品种 */
ipcMain.handle('gold:set-order', (_event, symbols: unknown) => {
  settings.symbolOrder = normalizeSymbolOrder(symbols);
  saveSettings();
  pushState();
  // 面板拿到 state 直接重渲染，返回顺序数组会把渲染打断
  return state;
});
ipcMain.handle('gold:set-display', (_event, next: { name?: boolean; pct?: boolean; mode?: ArrowMode }) => {
  const patched = { ...settings.display };
  if (typeof next?.name === 'boolean') patched.name = next.name;
  if (typeof next?.pct === 'boolean') patched.pct = next.pct;
  if (next?.mode !== undefined) Object.assign(patched, displayFromArrowMode(settings.display, next.mode));
  settings.display = normalizeDisplay(patched);
  saveSettings();
  updateTrayTitle();
  pushBall();
  pushTaskbar();
  pushState();
  return { display: settings.display, arrowMode: arrowModeOf(settings.display) };
});
ipcMain.handle('gold:set-trend', (_event, next: { enabled?: boolean; range?: TrendRange }) => {
  const patched = { ...settings.trend };
  if (typeof next?.enabled === 'boolean') patched.enabled = next.enabled;
  if (next?.range !== undefined) patched.range = next.range;
  settings.trend = normalizeTrendSettings(patched);
  saveSettings();
  pushState();
  return state;
});

ipcMain.handle('calc:load', (_event, args: { symbol?: string; ids?: unknown }) => calcView(args?.symbol, args?.ids));
ipcMain.handle('calc:summary', (_event, args: { symbol?: string; ids?: unknown }) => ({
  ok: true,
  stats: buildCalcStats(typeof args?.symbol === 'string' ? args.symbol : '', normalizeCalcIds(args?.ids)),
}));
ipcMain.handle(
  'calc:add',
  (_event, args: { side?: unknown; date?: unknown; grams?: unknown; price?: unknown; symbol?: string; ids?: unknown }) => {
    const side: CalcSide | null = args?.side === 'buy' ? 'buy' : args?.side === 'sell' ? 'sell' : null;
    const date = typeof args?.date === 'string' ? args.date : '';
    const grams = Number(args?.grams);
    const price = Number(args?.price);
    if (!side) return { ok: false, error: '请选择买入或卖出' };
    if (!isCalcDate(date)) return { ok: false, error: '日期不合法' };
    if (!Number.isFinite(grams) || grams <= 0) return { ok: false, error: '克数要大于 0' };
    if (!Number.isFinite(price) || price <= 0) return { ok: false, error: '单价要大于 0' };
    if (side === 'sell') {
      const ledger = calcLedger(calcRecords);
      if (grams > ledger.grams + 1e-6) {
        return { ok: false, error: `卖出克数超过当前持仓 ${formatGrams(ledger.grams)}` };
      }
    }
    const record: CalcRecord = {
      id: randomUUID(),
      side,
      date,
      grams: Math.round(grams * 1000) / 1000,
      price: Math.round(price * 100) / 100,
      createdAt: Date.now(),
    };
    calcRecords.push(record);
    saveCalcRecords();
    return { ...calcView(args?.symbol, args?.ids), addedId: record.id };
  },
);
ipcMain.handle('calc:remove', (_event, args: { ids?: unknown; symbol?: string }) => {
  const ids = normalizeCalcIds(args?.ids);
  if (ids.length) {
    const error = calcDeleteError(calcRecords, ids);
    if (error) return { ok: false, error };
    const picked = new Set(ids);
    calcRecords = calcRecords.filter((record) => !picked.has(record.id));
    saveCalcRecords();
  }
  return calcView(args?.symbol, ids);
});
ipcMain.on('gold:quit', () => app.quit());
ipcMain.on('gold:notify-test', () => sendTestNotification());

// 拖动按屏幕光标点驱动，不消费 pointermove 的 movementX/Y：
// 部分 Windows/DPI 组合下窗口跟着光标走时增量会失真（球往左上角跑），
// 高回报率鼠标还会把每秒上千个 pointermove 灌进主进程造成卡顿。
let ballDragTimer: ReturnType<typeof setInterval> | null = null;
let ballDragMoved = false;

function stopBallDrag(save: boolean): void {
  if (ballDragTimer) clearInterval(ballDragTimer);
  ballDragTimer = null;
  if (save) saveBallPosition();
}

ipcMain.on('ball:drag-start', () => {
  if (!ball || ball.isDestroyed() || ballDragTimer) return;
  ballDragMoved = false;
  const cursor = screen.getCursorScreenPoint();
  const [x, y] = ball.getPosition();
  const offsetX = cursor.x - x;
  const offsetY = cursor.y - y;
  let lastX = x;
  let lastY = y;
  const startedAt = Date.now();
  ballDragTimer = setInterval(() => {
    if (!ball || ball.isDestroyed()) {
      stopBallDrag(false);
      return;
    }
    // pointerup 丢失时别让球永远粘在光标上
    if (Date.now() - startedAt > 60000) {
      stopBallDrag(ballDragMoved);
      return;
    }
    const point = screen.getCursorScreenPoint();
    const bounds = ball.getBounds();
    // 按光标所在显示器夹取，否则跨屏拖动会被旧屏边界卡住
    const work = screen.getDisplayNearestPoint(point).workArea;
    const placed = clampIntoWorkArea(
      { x: Math.round(point.x - offsetX), y: Math.round(point.y - offsetY), width: bounds.width, height: bounds.height },
      work,
    );
    if (placed.x === lastX && placed.y === lastY) return;
    lastX = placed.x;
    lastY = placed.y;
    ballDragMoved = true;
    ball.setPosition(placed.x, placed.y);
  }, 16);
});
ipcMain.on('ball:drag-end', () => stopBallDrag(ballDragMoved));
ipcMain.on('ball:click', () => showPanel('detail', 'ball'));
ipcMain.on('ball:right-click', () => showPanel('settings', 'ball'));
ipcMain.on('ball:opacity-delta', (_event, delta: number) => {
  if (!Number.isFinite(delta)) return;
  applyBallOpacity(settings.ball.opacity + delta);
});

let taskbarDragTimer: ReturnType<typeof setInterval> | null = null;
let taskbarDragMoved = false;

function stopTaskbarDrag(save: boolean): void {
  if (taskbarDragTimer) clearInterval(taskbarDragTimer);
  taskbarDragTimer = null;
  if (save) saveTaskbarOffset();
}

ipcMain.on('taskbar:drag-start', () => {
  if (!taskbarWin || taskbarWin.isDestroyed() || taskbarDragTimer) return;
  taskbarDragMoved = false;
  const info = taskbarInfo();
  if (!info) return;
  const vertical = info.edge === 'left' || info.edge === 'right';
  taskbarEdge = info.edge;
  const bounds = taskbarWin.getBounds();
  const startOffset = vertical ? bounds.y : bounds.x;
  settings.taskbar.offset = startOffset;
  const start = screen.getCursorScreenPoint();
  const startedAt = Date.now();
  let last = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  taskbarDragTimer = setInterval(() => {
    const win = taskbarWin;
    if (!win || win.isDestroyed()) {
      stopTaskbarDrag(false);
      return;
    }
    if (Date.now() - startedAt > 60000) {
      stopTaskbarDrag(taskbarDragMoved);
      return;
    }
    const point = screen.getCursorScreenPoint();
    const delta = vertical ? point.y - start.y : point.x - start.x;
    // 拖动期间只按缓存的几何重算目标位置，不再每帧做完整 layout
    const rect = placeOnTaskbar(taskbarContent, info, startOffset + delta, TASKBAR_END_MARGIN);
    settings.taskbar.offset = vertical ? rect.y : rect.x;
    if (rect.x === last.x && rect.y === last.y && rect.width === last.width && rect.height === last.height) return;
    last = rect;
    taskbarDragMoved = true;
    win.setBounds(rect);
  }, 16);
});
ipcMain.on('taskbar:drag-end', () => {
  stopTaskbarDrag(taskbarDragMoved);
  layoutTaskbar();
});
ipcMain.on('taskbar:click', () => showPanel('detail', 'taskbar'));
ipcMain.on('taskbar:right-click', () => showPanel('settings', 'taskbar'));
ipcMain.on('taskbar:size', (_event, size: { width: number; height: number }) => {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return;
  const width = Math.max(1, Math.min(TASKBAR_MAX_SIZE, Math.round(size.width)));
  const height = Math.max(1, Math.min(TASKBAR_MAX_SIZE, Math.round(size.height)));
  if (width === taskbarContent.width && height === taskbarContent.height) return;
  console.log(`[taskbar] size ${width}x${height}`);
  taskbarContent = { width, height };
  layoutTaskbar();
});
