import * as vscode from 'vscode';
import { QuoteStore, feeShortText, pollOnce, sendAlertsToBark, sources, type AlertRule, type Quote } from '@goldsentry/core';

const COOLDOWN_MINUTES = 30;

let store: QuoteStore;
let statusItem: vscode.StatusBarItem;
let timer: NodeJS.Timeout | undefined;
let quotes: Quote[] = [];
let lastMillis = 0;
let paused = false;

function rulesFromMemento(memento: vscode.Memento): AlertRule[] {
  return memento.get<AlertRule[]>('rules', []);
}

function symbolSetting(): string {
  return vscode.workspace.getConfiguration('goldsentry').get<string>('symbol', 'ZS');
}

async function refresh(memento: vscode.Memento): Promise<void> {
  if (!store) return;
  const t0 = Date.now();
  const rules = rulesFromMemento(memento);
  const result = await pollOnce(sources, store, rules);
  lastMillis = Date.now() - t0;
  quotes = result.quotes;

  const picked = quotes.find((q) => q.symbol === symbolSetting()) ?? quotes[0];
  if (picked) {
    const pct = picked.dayChangePct;
    const arrow = pct === undefined || !Number.isFinite(pct) ? '' : pct >= 0 ? ' ▲' : ' ▼';
    statusItem.text = `$(pulse) ${picked.buyPrice.toFixed(2)}${arrow}`;
    statusItem.tooltip = buildTooltip(result.errors);
    statusItem.show();
  } else {
    statusItem.text = '$(pulse) --';
    statusItem.tooltip = `取数失败：${result.errors.join('; ')}`;
    statusItem.show();
  }

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
    const pct = q.dayChangePct;
    md.appendMarkdown(
      `| ${q.label} | ${q.buyPrice.toFixed(2)} | ${q.sellPrice.toFixed(2)} | ${q.spread.toFixed(2)} | ` +
        `${pct === undefined || !Number.isFinite(pct) ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`} | ` +
        `${feeShortText(q.symbol)} |\n`,
    );
  }
  md.appendMarkdown('\n_费用为人工核实的公开费率，非实时；点差 0 多为上游只给单边价_\n');
  if (errors.length) md.appendMarkdown(`\n⚠️ ${errors.join('; ')}`);
  md.appendMarkdown('\n\n_点击状态栏可切换显示品种_');
  return md;
}

async function pickSymbol(): Promise<void> {
  if (!quotes.length) {
    void vscode.window.showWarningMessage('GoldSentry：还没有取到行情，稍等或先执行「立即刷新」');
    return;
  }
  const items = quotes.map((q) => ({ label: q.symbol, description: q.name, detail: q.buyPrice.toFixed(2) }));
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

export function activate(context: vscode.ExtensionContext): void {
  store = new QuoteStore(vscode.Uri.joinPath(context.globalStorageUri, 'quotes.json').fsPath);
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'goldsentry.pick';

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand('goldsentry.refresh', () => refresh(context.globalState)),
    vscode.commands.registerCommand('goldsentry.pick', pickSymbol),
    vscode.commands.registerCommand('goldsentry.alert', () => setAlert(context.globalState)),
    vscode.commands.registerCommand('goldsentry.pause', () => {
      paused = !paused;
      if (paused && timer) clearInterval(timer);
      if (!paused) void refresh(context.globalState);
      void vscode.window.setStatusBarMessage(paused ? 'GoldSentry：已暂停轮询' : 'GoldSentry：已恢复轮询', 3000);
    }),
  );

  const intervalMs =
    Math.max(5, vscode.workspace.getConfiguration('goldsentry').get<number>('intervalSeconds', 10)) * 1000;
  timer = setInterval(() => {
    if (!paused) void refresh(context.globalState);
  }, intervalMs);
  context.subscriptions.push({ dispose: () => timer && clearInterval(timer) });

  void refresh(context.globalState);
}

export function deactivate(): void {
  if (timer) clearInterval(timer);
}
