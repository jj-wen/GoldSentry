import { app, BrowserWindow, Notification, Tray, ipcMain, nativeImage, powerMonitor, screen } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
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
  clampBallScale,
  clampIntoWorkArea,
  clampOpacity,
  compileRules,
  coversTaskbar,
  DEFAULT_DISPLAY,
  DEFAULT_TREND_SETTINGS,
  detectTaskbar,
  displayFromArrowMode,
  formatPct,
  formatPrice,
  formatQuoteCells,
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
  TASKBAR_END_MARGIN,
  TREND_RANGE_ORDER,
  TREND_RANGE_TEXT,
  trendSparkline,
  type AlertRule,
  type ArrowMode,
  type BarkConfig,
  type DisplayToggles,
  type FiredAlert,
  type HealthReport,
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

app.name = 'GoldSentry';

/**
 * Windows 上 Chromium 会用 DWM 遮挡计算判断窗口是否可见；任务栏文字是
 * `focusable:false` 的置顶透明窗口，盖在任务栏上时容易被判成"全被遮挡"，
 * 于是停止绘制——窗口还在、DOM 也在更新，但文字整块看不见（拖动后尤其容易触发）。
 */
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

/** 面板可选的轮询间隔；1 秒档容易触发上游风控，默认仍用 30 秒 */
const ALLOWED_INTERVALS = [1, 2, 3, 5, 8, 10, 30, 60, 120, 300];

let rulesFile = '';
let storeFile = '';
let settingsFile = '';
let rules: AlertRule[] = [];
let store: QuoteStore;

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
  display: { name: true, up: true, down: true },
  arrowMode: 'both',
  arrowModes: ARROW_MODE_ORDER.map((mode) => ({ mode, text: ARROW_MODE_TEXT[mode] })),
  ballScale: { min: BALL_SCALE_MIN, max: BALL_SCALE_MAX },
  symbolOrder: [],
  cells: {},
  spreadCells: {},
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

/** 一个托盘图标不该有半条任务栏那么宽，超了说明拿到的不是图标位置 */
const TRAY_ICON_MAX_WIDTH = 64;

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
  // macOS 菜单栏在屏幕顶，Windows 托盘在任务栏（屏幕底），面板要往相反方向弹
  const inBottomHalf = anchor.y + anchor.height / 2 > workArea.y + workArea.height / 2;
  const rawY = Math.round(inBottomHalf ? anchor.y - height - 6 : anchor.y + anchor.height + 6);
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
function readout(): { label: string; price: string; arrow: string; tone: string; mark: string } {
  const picked = primaryQuote();
  const pct = picked?.dayChangePct;
  // 颜色永远按真实涨跌（持平才白色）；开关只决定箭头出不出现
  const tone = priceTone(pct);
  return {
    label: settings.display.name ? (picked?.label ?? '—') : '',
    price: picked ? formatPrice(picked.buyPrice) : '—',
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
  const win = taskbarWin;
  if (!win || win.isDestroyed()) return;
  if (!settings.taskbar.enabled) {
    if (win.isVisible()) win.hide();
    return;
  }
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
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin');
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

function updateTrayTitle(): void {
  if (!tray) return;
  const picked = primaryQuote();
  const mark = state.health.status === 'offline' ? '×' : state.health.status === 'degraded' ? '!' : '';
  const title = picked ? ` ${mark}${formatPrice(picked.buyPrice)}` : ` ${mark || '?'}--`;
  const changed = title !== lastTrayTitle;
  lastTrayTitle = title;
  tray.setTitle(title);
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
  tray.setToolTip(lines.join('\n'));
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
    rules = loadRules();
    settings = loadSettings();
    store = new QuoteStore(storeFile);

    // template 图是纯白剪影，只适配 macOS 菜单栏；Windows 任务栏是浅色底，要用彩色图标
    const icon =
      process.platform === 'darwin'
        ? (() => {
            const img = nativeImage.createFromPath(join(__dirname, 'assets', 'iconTemplate.png'));
            img.setTemplateImage(true);
            return img;
          })()
        : nativeImage
            .createFromPath(join(__dirname, 'assets', 'icon.png'))
            .resize({ width: 16, height: 16 });
    tray = new Tray(icon);
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

    powerMonitor.on('resume', () => void poll());
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
ipcMain.handle('gold:set-display', (_event, next: { name?: boolean; mode?: ArrowMode }) => {
  const patched = { ...settings.display };
  if (typeof next?.name === 'boolean') patched.name = next.name;
  if (next?.mode !== undefined) Object.assign(patched, displayFromArrowMode(settings.display, next.mode));
  settings.display = normalizeDisplay(patched);
  saveSettings();
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
ipcMain.on('gold:quit', () => app.quit());
ipcMain.on('gold:notify-test', () => sendTestNotification());

// 球的拖动/滚轮走单向通道，invoke 的往返会让拖动明显发涩
ipcMain.on('ball:move-by', (_event, dx: number, dy: number) => {
  if (!ball || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  // 页面被 zoomFactor 放大后，1 个 CSS 像素 = scale 个屏幕像素；
  // 不换算的话球会比鼠标快（scale 1.8 时拖 100px 跑 180px）
  const [x, y] = ball.getPosition();
  ball.setPosition(Math.round(x + dx * settings.ball.scale), Math.round(y + dy * settings.ball.scale));
  clampBall(ball);
});
ipcMain.on('ball:drag-end', () => saveBallPosition());
ipcMain.on('ball:click', () => showPanel('detail', 'ball'));
ipcMain.on('ball:right-click', () => showPanel('settings', 'ball'));
ipcMain.on('ball:opacity-delta', (_event, delta: number) => {
  if (!Number.isFinite(delta)) return;
  applyBallOpacity(settings.ball.opacity + delta);
});

ipcMain.on('taskbar:move-by', (_event, dx: number, dy: number) => {
  if (!taskbarWin || taskbarWin.isDestroyed()) return;
  const info = taskbarInfo();
  if (!info) return;
  const vertical = info.edge === 'left' || info.edge === 'right';
  const delta = vertical ? dy : dx;
  if (!Number.isFinite(delta)) return;
  const bounds = taskbarWin.getBounds();
  settings.taskbar.offset = Math.round((vertical ? bounds.y : bounds.x) + delta);
  layoutTaskbar();
});
ipcMain.on('taskbar:drag-end', () => saveTaskbarOffset());
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
