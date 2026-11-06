import { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, powerMonitor } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  feeShortText,
  PRODUCT_FEES,
  QuoteStore,
  pollOnce,
  sendAlertsToBark,
  sendBark,
  sources,
  type AlertRule,
  type BarkConfig,
  type FiredAlert,
  type HealthReport,
  type Quote,
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
}

const DEFAULT_SETTINGS: Settings = {
  primarySymbol: 'ZS',
  pollSeconds: 30,
  bark: { enabled: false, server: 'https://api.day.app', deviceKey: '' },
};

let settings: Settings = { ...DEFAULT_SETTINGS, bark: { ...DEFAULT_SETTINGS.bark } };

/** deviceKey 明文落在 userData/settings.json（不在仓库里），面板输入框用 password 遮罩 */
function loadSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(settingsFile, 'utf8'));
    const seconds = Number(raw.pollSeconds);
    return {
      primarySymbol: String(raw.primarySymbol ?? DEFAULT_SETTINGS.primarySymbol),
      pollSeconds: ALLOWED_INTERVALS.includes(seconds) ? seconds : DEFAULT_SETTINGS.pollSeconds,
      bark: { ...DEFAULT_SETTINGS.bark, ...(raw.bark ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, bark: { ...DEFAULT_SETTINGS.bark } };
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
  const x = Math.round(Math.max(8, bounds.x + bounds.width / 2 - width / 2));
  panel.setPosition(x, bounds.y + bounds.height + 6);
}

function pushState(): void {
  state = {
    ...state,
    rules,
    primarySymbol: settings.primarySymbol,
    pollSeconds: settings.pollSeconds,
    bark: settings.bark,
  };
  panel?.webContents.send('gold:update', state);
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
    health: result.health,
  };
  updateTrayTitle();
  pushState();
  if (result.alerts.length) await dispatch(result.alerts);
}

let pollTimer: ReturnType<typeof setInterval> | undefined;

function restartTimer(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => void poll(), settings.pollSeconds * 1000);
}

function updateTrayTitle(): void {
  if (!tray) return;
  // 主显品种优先；取不到就退到最新的一条实时价，避免显示滞后的日定价
  const primary = state.quotes.find((q) => q.symbol === settings.primarySymbol);
  const picked =
    primary ??
    state.quotes
      .filter((q) => q.basis === 'realtime')
      .sort((a, b) => b.quotedAt - a.quotedAt)[0];
  const mark = state.health.status === 'offline' ? '×' : state.health.status === 'degraded' ? '!' : '';
  const title = picked ? ` ${mark}${picked.buyPrice.toFixed(1)}` : ` ${mark || '?'}--`;
  const changed = title !== lastTrayTitle;
  lastTrayTitle = title;
  tray.setTitle(title);
  const priceLine = picked
    ? `${picked.name} 买入 ${picked.buyPrice.toFixed(2)} · 卖出 ${picked.sellPrice.toFixed(2)}${
        picked.dayChangePct !== undefined && Number.isFinite(picked.dayChangePct)
          ? ` · ${picked.dayChangePct >= 0 ? '+' : ''}${picked.dayChangePct.toFixed(2)}%`
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

    const icon = nativeImage.createFromPath(join(__dirname, 'assets', 'iconTemplate.png'));
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.on('click', togglePanel);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '刷新行情', click: () => void poll() },
        { label: '测试通知', click: sendTestNotification },
        { type: 'separator' },
        { label: '退出 GoldSentry', role: 'quit' },
      ]),
    );

    powerMonitor.on('resume', () => void poll());
    void poll();
    restartTimer();
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
