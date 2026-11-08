import * as vscode from 'vscode';
import { QuoteStore, backoffSeconds, feeCell, formatPct, formatPrice, pollOnce, priceTone, sendAlertsToBark, showArrow, sources, type AlertRule, type DisplayToggles, type Quote } from '@goldsentry/core';

const COOLDOWN_MINUTES = 30;

let store: QuoteStore;
let statusItem: vscode.StatusBarItem;
let gearItem: vscode.StatusBarItem;
let timer: NodeJS.Timeout | undefined;
let quotes: Quote[] = [];
let lastMillis = 0;
let paused = false;
let failureStreak = 0;
let marketClosed = false;
let closedReason = '';

function rulesFromMemento(memento: vscode.Memento): AlertRule[] {
  return memento.get<AlertRule[]>('rules', []);
}

function symbolSetting(): string {
  return vscode.workspace.getConfiguration('goldsentry').get<string>('symbol', 'ZS');
}

function displaySetting(): DisplayToggles {
  const config = vscode.workspace.getConfiguration('goldsentry');
  return {
    name: config.get<boolean>('showName', true),
    up: config.get<boolean>('showUp', true),
    down: config.get<boolean>('showDown', true),
  };
}

function renderStatus(picked: Quote | undefined, errors: string[]): void {
  const display = displaySetting();
  if (!picked) {
    statusItem.text = '$(pulse) --';
    statusItem.tooltip = `取数失败：${errors.join('; ')}`;
    statusItem.show();
    return;
  }
  const name = display.name ? `${picked.label} ` : '';
  // 箭头只在真实涨/跌且该方向没被关掉时出现；持平不带箭头
  const arrow = showArrow(picked.dayChangePct, display) ? (priceTone(picked.dayChangePct) === 'down' ? ' ▼' : ' ▲') : '';
  statusItem.text = `$(pulse) ${name}${formatPrice(picked.buyPrice)}${arrow}`;
  statusItem.tooltip = buildTooltip(errors);
  statusItem.show();
}

async function refresh(memento: vscode.Memento): Promise<void> {
  if (!store) return;
  const t0 = Date.now();
  const rules = rulesFromMemento(memento);
  const result = await pollOnce(sources, store, rules);
  lastMillis = Date.now() - t0;
  quotes = result.quotes;
  failureStreak = result.failureStreak;
  marketClosed = result.health.marketClosed;
  closedReason = result.health.closedReason;

  renderStatus(quotes.find((q) => q.symbol === symbolSetting()) ?? quotes[0], result.errors);

  for (const alert of result.alerts) {
    void vscode.window.showInformationMessage(`${alert.title}｜${alert.body}`, '查看行情').then((pick) => {
      if (pick) void vscode.commands.executeCommand('goldsentry.refresh');
    });
  }

  const barkKey = vscode.workspace.getConfiguration('goldsentry').get<string>('barkKey', '');
  if (barkKey && result.alerts.length) {
    const errors = await sendAlertsToBark(
      {
        server: vscode.workspace.getConfiguration('goldsentry').get<string>('barkServer', 'https://api.day.app'),
        deviceKey: barkKey,
        group: 'GoldSentry',
        level: 'timeSensitive',
      },
      result.alerts,
    );
    for (const error of errors) void vscode.window.showWarningMessage(`GoldSentry Bark：${error}`);
  }
}

function buildTooltip(errors: string[]): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**积存金实时价** · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · ${lastMillis}ms\n\n`);
  md.appendMarkdown('| 品种 | 买入 | 卖出 | 点差 | 涨跌 | 费用 |\n|---|---:|---:|---:|---:|---:|---:|\n');
  for (const q of quotes) {
    md.appendMarkdown(
      `| ${q.label} | ${formatPrice(q.buyPrice)} | ${formatPrice(q.sellPrice)} | ${formatPrice(q.spread)} | ` +
        `${formatPct(q.dayChangePct)} | ` +
        `${feeCell(q.symbol).text} |\n`,
    );
  }
  md.appendMarkdown('\n_费用为人工核实的公开费率，非实时；点差 0 多为上游只给单边价；带 ⚠ 表示核实已超过 90 天，请以银行 App 为准_\n');
  md.appendMarkdown('_涨跌幅口径以各行 App 为准，不同银行“昨收”定义不同，勿横向比较；建行日价为 10:30 定价 + 盘中赎回价_\n');
  const base = Math.max(1, vscode.workspace.getConfiguration('goldsentry').get<number>('intervalSeconds', 10));
  const effective = backoffSeconds(base, failureStreak);
  if (effective > base) {
    md.appendMarkdown(`\n_数据源已连续失效 ${failureStreak} 次，暂时降频到 ${effective} 秒，恢复后自动回到 ${base} 秒_\n`);
  }
  if (marketClosed) md.appendMarkdown(`\n_休市（${closedReason}），报价不更新属正常，开市后自动恢复_\n`);
  if (errors.length) md.appendMarkdown(`\n⚠️ ${errors.join('; ')}`);
  md.appendMarkdown('\n\n_点击状态栏看完整对比，选中一行即切换显示品种_');
  return md;
}

/** 左键状态栏：把 tooltip 里的表变成可操作的列表，顺带承担切换品种的入口 */
async function showTable(): Promise<void> {
  if (!quotes.length) {
    void vscode.window.showWarningMessage('GoldSentry：还没有取到行情，稍等或先执行「立即刷新」');
    return;
  }
  const current = symbolSetting();
  const items = quotes.map((q) => ({
    label: `${q.label}  ${formatPrice(q.buyPrice)}`,
    description: `卖 ${formatPrice(q.sellPrice)} · 点差 ${formatPrice(q.spread)} · 涨跌 ${formatPct(q.dayChangePct)}`,
    detail:
      `${q.symbol === current ? '$(star-full) 状态栏显示中 · ' : ''}` +
      `费用 ${feeCell(q.symbol).text} · 报价 ${new Date(q.quotedAt).toLocaleTimeString('zh-CN', { hour12: false })} · ${q.basis}`,
    symbol: q.symbol,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: '全部积存金对比（涨跌幅口径以各行 App 为准；回车切换显示品种）',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (picked) {
    await vscode.workspace.getConfiguration('goldsentry').update('symbol', picked.symbol, vscode.ConfigurationTarget.Global);
  }
}

async function pickSymbol(): Promise<void> {
  if (!quotes.length) {
    void vscode.window.showWarningMessage('GoldSentry：还没有取到行情，稍等或先执行「立即刷新」');
    return;
  }
  const items = quotes.map((q) => ({ label: q.symbol, description: q.name, detail: formatPrice(q.buyPrice) }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: '状态栏显示哪个品种' });
  if (picked) {
    await vscode.workspace.getConfiguration('goldsentry').update('symbol', picked.label, vscode.ConfigurationTarget.Global);
  }
}

async function setAlert(memento: vscode.Memento): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    quotes.map((q) => ({ label: q.symbol, description: q.name })),
    { placeHolder: '给哪个品种设提醒' },
  );
  if (!picked) return;

  const direction = await vscode.window.showQuickPick(
    [{ label: '涨到 ≥', value: 'above' }, { label: '跌到 ≤', value: 'below' }],
    { placeHolder: '触发方向' },
  );
  if (!direction) return;

  const raw = await vscode.window.showInputBox({ prompt: '阈值（元/克）', validateInput: (v) => (Number(v) > 0 ? null : '请输入正数') });
  if (!raw) return;

  const rules = rulesFromMemento(memento).filter((r) => !(r.symbol === picked.label && r.id.endsWith(direction.value)));
  rules.push({
    id: `${picked.label}-${direction.value}`,
    symbol: picked.label,
    enabled: true,
    cooldownMinutes: COOLDOWN_MINUTES,
    [direction.value]: Number(raw),
  });
  await memento.update('rules', rules);
  void vscode.window.setStatusBarMessage(`GoldSentry：已设 ${picked.label} ${direction.value} ${raw}`, 4000);
}

/** 每轮结束后按当前失效次数重排下一次，连续全部失效时自动降频 */
function restartTimer(memento: vscode.Memento): void {
  if (timer) clearTimeout(timer);
  const base = Math.max(1, vscode.workspace.getConfiguration('goldsentry').get<number>('intervalSeconds', 10));
  timer = setTimeout(() => {
    if (paused) {
      restartTimer(memento);
      return;
    }
    void refresh(memento).finally(() => restartTimer(memento));
  }, backoffSeconds(base, failureStreak) * 1000);
}

/** 状态栏项点不到右键，所以设置走旁边那个 ⚙ 项 */
async function openSettings(memento: vscode.Memento): Promise<void> {
  const config = vscode.workspace.getConfiguration('goldsentry');
  const display = displaySetting();
  const items = [
    { label: '显示品种名称', detail: display.name ? '开' : '关', key: 'showName' },
    { label: '显示上涨（红）', detail: display.up ? '开' : '关', key: 'showUp' },
    { label: '显示下跌（绿）', detail: display.down ? '开' : '关', key: 'showDown' },
    { label: '刷新间隔', detail: `${config.get<number>('intervalSeconds', 10)} 秒`, key: 'interval' },
    { label: '主显品种', detail: symbolSetting(), key: 'symbol' },
    { label: '到价提醒', detail: `${rulesFromMemento(memento).length} 条`, key: 'alert' },
    { label: 'Bark device key', detail: config.get<string>('barkKey', '') ? '已配置' : '未配置', key: 'bark' },
    { label: paused ? '继续轮询' : '暂停轮询', detail: paused ? '已暂停' : '进行中', key: 'pause' },
  ] as const;

  const picked = await vscode.window.showQuickPick(
    items.map((item) => ({ ...item, description: item.detail })),
    { placeHolder: 'GoldSentry 设置' },
  );
  if (!picked) return;

  switch (picked.key) {
    case 'showName':
    case 'showUp':
    case 'showDown': {
      await config.update(picked.key, !config.get<boolean>(picked.key, true), vscode.ConfigurationTarget.Global);
      renderStatus(quotes.find((q) => q.symbol === symbolSetting()) ?? quotes[0], []);
      break;
    }
    case 'interval': {
      const raw = await vscode.window.showInputBox({
        prompt: '刷新间隔（秒），可选 1/2/3/5/8/10/30/60/120/300',
        value: String(config.get<number>('intervalSeconds', 10)),
        validateInput: (v) => (Number(v) >= 1 ? null : '至少 1 秒'),
      });
      if (raw) {
        await config.update('intervalSeconds', Number(raw), vscode.ConfigurationTarget.Global);
        restartTimer(memento);
      }
      break;
    }
    case 'symbol':
      await pickSymbol();
      break;
    case 'alert':
      await setAlert(memento);
      break;
    case 'bark': {
      const key = await vscode.window.showInputBox({
        prompt: 'Bark device key（留空则只用 VS Code 内置通知）',
        password: true,
        ignoreFocusOut: true,
        value: config.get<string>('barkKey', ''),
      });
      if (key !== undefined) await config.update('barkKey', key.trim(), vscode.ConfigurationTarget.Global);
      break;
    }
    case 'pause':
      await vscode.commands.executeCommand('goldsentry.pause');
      break;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  store = new QuoteStore(vscode.Uri.joinPath(context.globalStorageUri, 'quotes.json').fsPath);
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'goldsentry.show';
  gearItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  gearItem.text = '$(gear)';
  gearItem.tooltip = 'GoldSentry 设置';
  gearItem.command = 'goldsentry.settings';
  gearItem.show();

  context.subscriptions.push(
    statusItem,
    gearItem,
    vscode.commands.registerCommand('goldsentry.settings', () => openSettings(context.globalState)),
    vscode.commands.registerCommand('goldsentry.refresh', () => refresh(context.globalState)),
    vscode.commands.registerCommand('goldsentry.show', showTable),
    vscode.commands.registerCommand('goldsentry.pick', pickSymbol),
    vscode.commands.registerCommand('goldsentry.alert', () => setAlert(context.globalState)),
    vscode.commands.registerCommand('goldsentry.pause', () => {
      paused = !paused;
      // 定时器链保持活着，暂停只是跳过取数；清掉它会导致恢复后永远不再轮询
      if (!paused) void refresh(context.globalState);
      void vscode.window.setStatusBarMessage(paused ? 'GoldSentry：已暂停轮询' : 'GoldSentry：已恢复轮询', 3000);
    }),
  );

  restartTimer(context.globalState);
  context.subscriptions.push({ dispose: () => timer && clearTimeout(timer) });

  void refresh(context.globalState);
}

export function deactivate(): void {
  if (timer) clearTimeout(timer);
}
