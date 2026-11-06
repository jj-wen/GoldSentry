const Module = require('module');
const path = require('path');

class MarkdownString {
  value = '';
  appendMarkdown(s) { this.value += s; return this; }
}

const statusItems = [];
function newStatusItem() {
  const item = { text: '', tooltip: '', command: '', shown: false, show() { this.shown = true; } };
  statusItems.push(item);
  return item;
}
let statusItem = null;
const messages = [];
const commands = new Map();
const quickPicks = [];
const configUpdates = [];
let rules = [];
let quickPickResult;

const vscode = {
  StatusBarAlignment: { Right: 2 },
  ConfigurationTarget: { Global: 1 },
  MarkdownString,
  Uri: { joinPath: (base, name) => ({ fsPath: path.join(base.fsPath, name) }) },
  window: {
    createStatusBarItem: () => newStatusItem(),
    showInformationMessage: (msg) => { messages.push(msg); return Promise.resolve(undefined); },
    showWarningMessage: (msg) => { messages.push(`warn: ${msg}`); return Promise.resolve(undefined); },
    setStatusBarMessage: (msg) => { messages.push(msg); return { dispose() {} }; },
    showQuickPick: (items) => {
      quickPicks.push(items);
      return Promise.resolve(quickPickResult);
    },
  },
  workspace: {
    getConfiguration: () => ({
      get: (key, def) => (key === 'symbol' ? 'ZS' : def),
      update: (key, val) => {
        configUpdates.push([key, val]);
        return Promise.resolve();
      },
    }),
  },
  commands: {
    registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; },
    executeCommand: (id) => commands.get(id)?.(),
  },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return realLoad.call(this, request, parent, isMain);
};

const ext = require(path.resolve(__dirname, '../apps/vscode/dist/extension.cjs'));

const context = {
  globalStorageUri: { fsPath: '/tmp/goldsentry-vscode-storage' },
  globalState: {
    get(key, def) { return key === 'rules' ? rules : def; },
    update(key, val) { rules = val; return Promise.resolve(); },
  },
  subscriptions: [],
};

ext.activate(context);
statusItem = statusItems[0];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, condition, extra = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!condition) failures++;
}

(async () => {
  await sleep(4000);
  console.log('注册的命令    :', [...commands.keys()].join(', '));
  console.log('状态栏 text   :', JSON.stringify(statusItem.text));
  console.log('tooltip       :', statusItem.tooltip.value.split('\n').slice(0, 9).join('\n'));

  rules = [{ id: 'ZS-below', symbol: 'ZS', enabled: true, below: 1000, cooldownMinutes: 0 }];
  await commands.get('goldsentry.refresh')();
  await sleep(500);
  console.log('注入规则后    : 消息', messages.length ? messages.slice(-3) : '无（预热轮已把状态记为真，属预期）');

  rules = [{ id: 'ZS-below', symbol: 'ZS', enabled: true, below: 0, cooldownMinutes: 0 }];
  await commands.get('goldsentry.refresh')();
  await sleep(500);
  rules = [{ id: 'ZS-below', symbol: 'ZS', enabled: true, below: 1000, cooldownMinutes: 0 }];
  await commands.get('goldsentry.refresh')();
  await sleep(500);
  console.log('真实穿越后    :', messages.slice(-2));

  // --- 左键状态栏：应弹全量对比列表，回车即切换显示品种 ---
  check('左键绑到新命令 goldsentry.show', statusItem.command === 'goldsentry.show', statusItem.command);
  check('⚙ 第二项绑定 goldsentry.settings', statusItems[1]?.command === 'goldsentry.settings', String(statusItems[1]?.command));
  check('goldsentry.show 已注册', commands.has('goldsentry.show'));
  check('旧入口 goldsentry.pick 保留', commands.has('goldsentry.pick'));
  check(
    'tooltip 标注涨跌幅口径与建行日价',
    /涨跌幅口径/.test(statusItem.tooltip.value) &&
      /勿横向比较/.test(statusItem.tooltip.value) &&
      /建行日价/.test(statusItem.tooltip.value),
  );

  quickPicks.length = 0;
  quickPickResult = undefined;
  await commands.get('goldsentry.show')();
  const items = quickPicks[0] ?? [];
  check('点击后弹出 QuickPick', quickPicks.length === 1);
  check('列表覆盖全部品种（>=9）', items.length >= 9, `${items.length} 条`);
  const zs = items.find((i) => i.label.startsWith('浙商'));
  check(
    '每行含买价/卖出/点差/涨跌',
    !!zs && /^\S+\s+\d+\.\d{2}$/.test(zs.label) && /卖 \d+\.\d{2} · 点差 \d+\.\d{2} · 涨跌 /u.test(zs.description),
    zs && `${zs.label} | ${zs.description}`,
  );
  check('详情带费用与报价时间', !!zs && /费用/.test(zs.detail) && /报价 \d{2}:\d{2}/.test(zs.detail), zs?.detail);
  check('当前主显品种有标记', !!zs && zs.detail.includes('状态栏显示中'), zs?.detail);
  check('建行日价排最后（日定价不抢实时位）', items.at(-1)?.label.startsWith('建行'), items.at(-1)?.label);

  configUpdates.length = 0;
  quickPickResult = items.find((i) => i.label.startsWith('工商'));
  await commands.get('goldsentry.show')();
  check('回车选中即写入 symbol 配置', configUpdates.some(([k, v]) => k === 'symbol' && v === 'GS'), JSON.stringify(configUpdates));

  configUpdates.length = 0;
  quickPickResult = undefined;
  await commands.get('goldsentry.show')();
  check('Esc 关闭不改配置', configUpdates.length === 0);

  console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
  // 关掉扩展自己挂的轮询定时器，否则事件循环永不排空
  for (const d of context.subscriptions) d?.dispose?.();
  // 不主动 process.exit()：Windows + Node 24 会撞 libuv 断言，把全绿跑报成失败
  process.exitCode = failures ? 1 : 0;
})();
