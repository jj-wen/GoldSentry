const Module = require('module');
const path = require('path');

class MarkdownString {
  value = '';
  appendMarkdown(s) { this.value += s; return this; }
}

const statusItem = { text: '', tooltip: '', command: '', shown: false, show() { this.shown = true; } };
const messages = [];
const commands = new Map();
let rules = [];

const vscode = {
  StatusBarAlignment: { Right: 2 },
  ConfigurationTarget: { Global: 1 },
  MarkdownString,
  Uri: { joinPath: (base, name) => ({ fsPath: path.join(base.fsPath, name) }) },
  window: {
    createStatusBarItem: () => statusItem,
    showInformationMessage: (msg) => { messages.push(msg); return Promise.resolve(undefined); },
    showWarningMessage: (msg) => { messages.push(`warn: ${msg}`); return Promise.resolve(undefined); },
    setStatusBarMessage: (msg) => { messages.push(msg); return { dispose() {} }; },
  },
  workspace: {
    getConfiguration: () => ({
      get: (key, def) => (key === 'symbol' ? 'ZS' : def),
      update: () => Promise.resolve(),
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  process.exit(0);
})();
