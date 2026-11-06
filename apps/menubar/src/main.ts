import { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, powerMonitor, screen } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  clampIntoWorkArea,
  clampOpacity,
  detectTaskbar,
  feeShortText,
  formatPct,
  formatPrice,
  OPACITY_MAX,
  OPACITY_MIN,
  placeOnTaskbar,
  PRODUCT_FEES,
  QuoteStore,
  pollOnce,
  sendAlertsToBark,
  sendBark,
  sources,
  TASKBAR_END_MARGIN,
  type AlertRule,
  type BarkConfig,
  type FiredAlert,
  type HealthReport,
  type Quote,
  type TaskbarInfo,
} from '@goldsentry/core';

app.name = 'GoldSentry';

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
  bark: Settings['bark'];
  ball: Settings['ball'];
  taskbar: Settings['taskbar'];
  health: HealthReport;
}

let state: State = {
  quotes: [],
  rules: [],
  errors: [],
  lastPollAt: 0,
  primarySymbol: 'ZS',
  pollSeconds: 30,
  bark: { enabled: false, server: 'https://api.day.app', deviceKey: '' },
  ball: { enabled: true, opacity: 0.9, x: null, y: null },
  taskbar: { enabled: true, offset: null },
  health: { status: 'ok', reasons: [] },
};

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
  bark: { enabled: boolean; server: string; deviceKey: string };
  ball: { enabled: boolean; opacity: number; x: number | null; y: number | null };
  taskbar: { enabled: boolean; offset: number | null };
}

const DEFAULT_SETTINGS: Settings = {
  primarySymbol: 'ZS',
  pollSeconds: 30,
  bark: { enabled: false, server: 'https://api.day.app', deviceKey: '' },
  ball: { enabled: true, opacity: 0.9, x: null, y: null },
  taskbar: { enabled: true, offset: null },
};

let settings: Settings = {
  ...DEFAULT_SETTINGS,
  bark: { ...DEFAULT_SETTINGS.bark },
  ball: { ...DEFAULT_SETTINGS.ball },
  taskbar: { ...DEFAULT_SETTINGS.taskbar },
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
      bark: { ...DEFAULT_SETTINGS.bark, ...(raw.bark ?? {}) },
      ball: {
        enabled: raw.ball?.enabled !== false,
        opacity: clampOpacity(raw.ball?.opacity, DEFAULT_SETTINGS.ball.opacity),
        x: point(raw.ball?.x),
        y: point(raw.ball?.y),
      },
      taskbar: {
        enabled: raw.taskbar?.enabled !== false,
        offset: point(raw.taskbar?.offset),
      },
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      bark: { ...DEFAULT_SETTINGS.bark },
      ball: { ...DEFAULT_SETTINGS.ball },
      taskbar: { ...DEFAULT_SETTINGS.taskbar },
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

function createPanel(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
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
  win.on('blur', () => win.hide());
  return win;
}

function positionPanel(): void {
  if (!panel || !tray) return;
  const bounds = tray.getBounds();
  const { width, height } = panel.getBounds();
  const { workArea } = screen.getDisplayMatching(bounds);
  const x = Math.round(Math.max(8, bounds.x + bounds.width / 2 - width / 2));
  // macOS 菜单栏在屏幕顶，Windows 托盘在任务栏（屏幕底），面板要往相反方向弹
  const belowTaskbar = bounds.y > workArea.y + workArea.height / 2;
  const y = belowTaskbar ? bounds.y - height - 6 : bounds.y + bounds.height + 6;
  panel.setPosition(x, y);
}

function pushState(): void {
  state = {
    ...state,
    rules,
    primarySymbol: settings.primarySymbol,
    pollSeconds: settings.pollSeconds,
    bark: settings.bark,
    ball: settings.ball,
    taskbar: settings.taskbar,
  };
  panel?.webContents.send('gold:update', state);
  pushBall();
  pushTaskbar();
}

const BALL_SIZE = 104;
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
  const win = new BrowserWindow({
    width: BALL_SIZE,
    height: BALL_SIZE,
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
            x: workArea.x + workArea.width - BALL_SIZE - 24,
            y: workArea.y + workArea.height - BALL_SIZE - 24,
          };
        })();
  win.setPosition(saved.x, saved.y);
  clampBall(win);
  win.loadFile(join(__dirname, 'ball.html'));
  // 必须等首帧：早于 ready-to-show 发过去，渲染进程还没挂上监听，球会空到下一次轮询
  win.once('ready-to-show', () => {
    win.showInactive();
    pushBall();
  });
  win.on('closed', () => {
    if (ball === win) ball = null;
  });
  return win;
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
  refreshTrayMenu();
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

/** 悬浮球与任务栏文字共用同一条"瞟一眼"数据：品种短名 + 两位小数价格 + 涨跌箭头 */
function readout(): { label: string; price: string; arrow: string; tone: string; mark: string } {
  const picked = primaryQuote();
  const pct = picked?.dayChangePct;
  const known = pct !== undefined && Number.isFinite(pct);
  const direction = !known ? 0 : (pct as number) > 0 ? 1 : (pct as number) < 0 ? -1 : 0;
  return {
    label: picked?.label ?? '—',
    price: picked ? formatPrice(picked.buyPrice) : '—',
    arrow: direction > 0 ? '▲' : direction < 0 ? '▼' : '',
    tone: direction > 0 ? 'up' : direction < 0 ? 'down' : 'flat',
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
  if (visible) {
    if (!taskbarWin || taskbarWin.isDestroyed()) taskbarWin = createTaskbar();
    layoutTaskbar();
    pushTaskbar();
  } else {
    taskbarWin?.hide();
  }
  pushState();
  refreshTrayMenu();
}

function saveTaskbarOffset(): void {
  if (!taskbarWin || taskbarWin.isDestroyed()) return;
  const bounds = taskbarWin.getBounds();
  settings.taskbar.offset = taskbarEdge === 'left' || taskbarEdge === 'right' ? bounds.y : bounds.x;
  saveSettings();
}

function pushTaskbar(): void {
  if (!taskbarWin || taskbarWin.isDestroyed() || !taskbarWin.isVisible()) return;
  taskbarWin.webContents.send('taskbar:update', readout());
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

async function poll(): Promise<void> {
  const result = await pollOnce(sources, store, rules);
  state = {
    quotes: result.quotes,
    rules,
    errors: result.errors,
    lastPollAt: Date.now(),
    primarySymbol: settings.primarySymbol,
    pollSeconds: settings.pollSeconds,
    bark: settings.bark,
    ball: settings.ball,
    taskbar: settings.taskbar,
    health: result.health,
  };
  updateTrayTitle();
  layoutTaskbar();
  pushState();
  if (result.alerts.length) await dispatch(result.alerts);
}

let pollTimer: ReturnType<typeof setInterval> | undefined;

function restartTimer(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => void poll(), settings.pollSeconds * 1000);
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
  tray.setToolTip(
    state.health.reasons.length ? `${priceLine}\n数据源异常：${state.health.reasons.join('；')}` : priceLine,
  );
  if (changed) console.log(`[tray] title="${title}" ${Notification.isSupported() ? '通知可用' : '通知不可用'}`);
}

function togglePanel(): void {
  if (!panel) panel = createPanel();
  if (panel.isVisible()) {
    panel.hide();
    return;
  }
  positionPanel();
  panel.show();
  panel.webContents.send('gold:update', state);
}

function sendTestNotification(): void {
  new Notification({
    title: 'GoldSentry 通知测试',
    body: '看到这条说明提醒链路是通的',
  }).show();
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: '刷新行情', click: () => void poll() },
    { label: '测试通知', click: sendTestNotification },
    ...(supportsBall() || supportsTaskbar()
      ? [
          { type: 'separator' as const },
          ...(supportsTaskbar()
            ? [
                {
                  label: '任务栏显示',
                  type: 'checkbox' as const,
                  checked: settings.taskbar.enabled,
                  click: (item: { checked: boolean }) => setTaskbarVisible(item.checked),
                },
              ]
            : []),
          ...(supportsBall()
            ? [
                {
                  label: '显示悬浮球',
                  type: 'checkbox' as const,
                  checked: settings.ball.enabled,
                  click: (item: { checked: boolean }) => setBallVisible(item.checked),
                },
              ]
            : []),
        ]
      : []),
    { type: 'separator' },
    { label: '退出 GoldSentry', role: 'quit' },
  ]);
}

/** 面板里的开关也会改这两项，菜单要在每次变化后重建，勾选状态才不会过期 */
function refreshTrayMenu(): void {
  tray?.setContextMenu(buildTrayMenu());
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
    tray.on('click', togglePanel);
    tray.setContextMenu(buildTrayMenu());

    // 拔显示器 / 改分辨率后球可能整个跑到屏幕外，任务栏贴附也要重排
    const relayout = () => {
      if (ball && ball.isVisible()) clampBall(ball);
      layoutTaskbar();
    };
    screen.on('display-metrics-changed', relayout);
    screen.on('display-removed', relayout);
    screen.on('display-added', relayout);

    powerMonitor.on('resume', () => void poll());
    void poll();
    restartTimer();
    if (settings.ball.enabled) setBallVisible(true);
    if (settings.taskbar.enabled) setTaskbarVisible(true);
    if (process.env.GOLDSENTRY_TEST_NOTIFY === '1') sendTestNotification();
  });
}

ipcMain.handle('gold:state', () => state);
ipcMain.handle('gold:fees', () =>
  Object.fromEntries(
    Object.entries(PRODUCT_FEES).map(([symbol, fee]) => [
      symbol,
      { text: feeShortText(symbol), note: fee.note, asOf: fee.asOf },
    ]),
  ),
);
ipcMain.handle('gold:refresh', () => poll());
ipcMain.handle('gold:save-rules', (_event, next: AlertRule[]) => {
  rules = next;
  saveRules();
  pushState();
  return rules;
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
ipcMain.handle('gold:capabilities', () => ({ ball: supportsBall(), taskbar: supportsTaskbar() }));
ipcMain.handle('gold:set-ball', (_event, next: { enabled?: boolean; opacity?: number }) => {
  if (typeof next.opacity === 'number') applyBallOpacity(next.opacity);
  if (typeof next.enabled === 'boolean') setBallVisible(next.enabled);
  return { ...settings.ball, supported: supportsBall() };
});
ipcMain.handle('gold:set-taskbar', (_event, next: { enabled?: boolean }) => {
  if (typeof next?.enabled === 'boolean') setTaskbarVisible(next.enabled);
  return { ...settings.taskbar, supported: supportsTaskbar() };
});

// 球的拖动/滚轮走单向通道，invoke 的往返会让拖动明显发涩
ipcMain.on('ball:move-by', (_event, dx: number, dy: number) => {
  if (!ball || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const [x, y] = ball.getPosition();
  ball.setPosition(Math.round(x + dx), Math.round(y + dy));
  clampBall(ball);
});
ipcMain.on('ball:drag-end', () => saveBallPosition());
ipcMain.on('ball:click', () => togglePanel());
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
ipcMain.on('taskbar:click', () => togglePanel());
ipcMain.on('taskbar:size', (_event, size: { width: number; height: number }) => {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return;
  const width = Math.max(1, Math.min(TASKBAR_MAX_SIZE, Math.round(size.width)));
  const height = Math.max(1, Math.min(TASKBAR_MAX_SIZE, Math.round(size.height)));
  if (width === taskbarContent.width && height === taskbarContent.height) return;
  console.log(`[taskbar] size ${width}x${height}`);
  taskbarContent = { width, height };
  layoutTaskbar();
});
