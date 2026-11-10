import * as vscode from 'vscode';
import { QuoteStore, backoffSeconds, bankSessionAt, BOT_TYPE_ORDER, BOT_TYPE_TEXT, feeCell, formatPct, formatPrice, inQuietHours, JD_SYMBOLS, normalizeBotType, parseHhmm, pollOnce, priceTone, sendAlertsToBark, sendAlertsToBot, sendAlertsToMail, sendAlertsToWebhook, showArrow, sources, timeReached, tradingHoursOf, type AlertRule, type BotConfig, type DisplayToggles, type MailConfig, type Quote } from '@goldsentry/core';

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
    pct: config.get<boolean>('showPct', false),
  };
}

/** 邮件配置三项齐了才发，缺一项就当没启用，避免每次都报同一串错误 */
function mailConfig(): MailConfig | null {
  const config = vscode.workspace.getConfiguration('goldsentry');
  if (!config.get<boolean>('emailEnabled', false)) return null;
  const host = config.get<string>('emailHost', '').trim();
  const to = config.get<string>('emailTo', '').trim();
  if (!host || !to) return null;
  return {
    host,
    port: config.get<number>('emailPort', 465),
    secure: config.get<boolean>('emailSecure', true),
    user: config.get<string>('emailUser', '').trim(),
    pass: config.get<string>('emailPass', ''),
    from: config.get<string>('emailFrom', '').trim(),
    to,
  };
}

async function sendMailAlerts(alerts: { title: string; body: string }[]): Promise<void> {
  const mail = mailConfig();
  if (!mail || !alerts.length) return;
  const errors = await sendAlertsToMail(mail, alerts.map((alert, index) => ({ ruleId: `mail-${index}`, symbol: '-', ...alert })));
  for (const error of errors) void vscode.window.showWarningMessage(`GoldSentry 邮件：${error}`);
}

function botConfig(): BotConfig | null {
  const config = vscode.workspace.getConfiguration('goldsentry');
  if (!config.get<boolean>('botEnabled', false)) return null;
  const type = normalizeBotType(config.get<string>('botType', 'feishu'));
  const url = config.get<string>('botUrl', '').trim();
  const token = config.get<string>('botToken', '').trim();
  const chatId = config.get<string>('botChatId', '').trim();
  if (type === 'telegram' ? !token || !chatId : !url) return null;
  return {
    type,
    url,
    secret: config.get<string>('botSecret', ''),
    token,
    chatId,
  };
}

async function sendBotAlerts(alerts: { title: string; body: string }[]): Promise<void> {
  const bot = botConfig();
  if (!bot || !alerts.length) return;
  const errors = await sendAlertsToBot(bot, alerts.map((alert, index) => ({ ruleId: `bot-${index}`, symbol: '-', ...alert })));
  for (const error of errors) void vscode.window.showWarningMessage(`GoldSentry 机器人：${error}`);
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
  const pct =
    display.pct && typeof picked.dayChangePct === 'number' && Number.isFinite(picked.dayChangePct)
      ? ` ${formatPct(picked.dayChangePct)}`
      : '';
  statusItem.text = `$(pulse) ${name}${formatPrice(picked.buyPrice)}${arrow}${pct}`;
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

  const config = vscode.workspace.getConfiguration('goldsentry');
  const quiet = inQuietHours({
    enabled: config.get<boolean>('quietEnabled', false),
    start: config.get<string>('quietStart', '23:00'),
    end: config.get<string>('quietEnd', '08:00'),
  });
  if (!quiet) {
    for (const alert of result.alerts) {
      void vscode.window.showInformationMessage(`${alert.title}｜${alert.body}`, '查看行情').then((pick) => {
        if (pick) void vscode.commands.executeCommand('goldsentry.refresh');
      });
    }

    const barkKey = config.get<string>('barkKey', '');
    if (barkKey && result.alerts.length) {
      const errors = await sendAlertsToBark(
        {
          server: config.get<string>('barkServer', 'https://api.day.app'),
          deviceKey: barkKey,
          group: 'GoldSentry',
          level: 'timeSensitive',
        },
        result.alerts,
      );
      for (const error of errors) void vscode.window.showWarningMessage(`GoldSentry Bark：${error}`);
    }

    const webhookUrl = config.get<string>('webhookUrl', '').trim();
    if (webhookUrl && result.alerts.length) {
      const errors = await sendAlertsToWebhook({ url: webhookUrl }, result.alerts);
      for (const error of errors) void vscode.window.showWarningMessage(`GoldSentry Webhook：${error}`);
    }

    await sendMailAlerts(result.alerts);
    await sendBotAlerts(result.alerts);
  }

  await maybeSendDigest();
}

let lastDigestCheckAt = 0;

/** 每天到点推一次最近一个已结束交易日的简报；首次启用只记基线 */
async function maybeSendDigest(): Promise<void> {
  const config = vscode.workspace.getConfiguration('goldsentry');
  if (!config.get<boolean>('digestEnabled', true)) return;
  if (!timeReached(config.get<string>('digestTime', '08:30'))) return;
  const now = Date.now();
  if (now - lastDigestCheckAt < 60_000) return;
  lastDigestCheckAt = now;
  if (!quotes.length) return;

  const labels: Record<string, string> = {};
  for (const quote of quotes) labels[quote.symbol] = quote.label;
  // 选中的品种排第一，和面板行为一致
  const digest = store.digest(now, labels, { primarySymbol: symbolSetting() });
  if (!digest || store.lastDigestDay() === digest.day) return;
  store.setLastDigestDay(digest.day);

  const quiet = inQuietHours(
    {
      enabled: config.get<boolean>('quietEnabled', false),
      start: config.get<string>('quietStart', '23:00'),
      end: config.get<string>('quietEnd', '08:00'),
    },
    now,
  );
  if (quiet) return;

  void vscode.window.showInformationMessage(`${digest.title}｜${digest.body}`);
  const alert = [{ ruleId: 'digest', symbol: '-', title: digest.title, body: digest.body }];
  const barkKey = config.get<string>('barkKey', '');
  if (barkKey) {
    const errors = await sendAlertsToBark(
      {
        server: config.get<string>('barkServer', 'https://api.day.app'),
        deviceKey: barkKey,
        group: 'GoldSentry',
        level: 'passive',
      },
      alert,
    );
    for (const error of errors) void vscode.window.showWarningMessage(`GoldSentry Bark：${error}`);
  }
  const webhookUrl = config.get<string>('webhookUrl', '').trim();
  if (webhookUrl) {
    const errors = await sendAlertsToWebhook({ url: webhookUrl }, alert);
    for (const error of errors) void vscode.window.showWarningMessage(`GoldSentry Webhook：${error}`);
  }
  await sendMailAlerts(alert);
  await sendBotAlerts(alert);
}

function buildTooltip(errors: string[]): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**积存金实时价** · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · ${lastMillis}ms\n\n`);
  // 一家银行一段，别用宽表格：VS Code hover 太窄时表格会挤成一团
  for (const q of quotes) {
    const hours = tradingHoursOf(q.symbol);
    const session = bankSessionAt(q.symbol);
    const update = new Date(q.quotedAt).toLocaleTimeString('zh-CN', { hour12: false });
    md.appendMarkdown(`**${q.name}**（${q.symbol}）  \n`);
    md.appendMarkdown(
      `买入 ${formatPrice(q.buyPrice)} · 卖出 ${formatPrice(q.sellPrice)} · 点差 ${formatPrice(q.spread)}  \n`,
    );
    md.appendMarkdown(`涨跌 ${formatPct(q.dayChangePct)} · 费用 ${feeCell(q.symbol).text} · 更新 ${update}  \n`);
    if (hours) {
      const reason = session.reason ? `（${session.reason}）` : '';
      md.appendMarkdown(`交易 ${hours.text} · ${session.text}${reason}  \n`);
    }
    md.appendMarkdown('\n');
  }
  md.appendMarkdown(
    '_交易规则：交易日一般 09:00 开市；工商 22:30 收盘，浙商次日 02:30，民生/广发/兴业/中信次日 02:00。周末与法定节假日休市，节前最后一个交易日晚上停夜盘。_\n',
  );
  md.appendMarkdown('_费用为人工核实的公开费率，非实时；点差 0 多为上游只给单边价；带 ⚠ 表示核实已超过 90 天，请以银行 App 为准_\n');
  md.appendMarkdown('_涨跌幅口径以各行 App 为准，不同银行“昨收”定义不同，勿横向比较_\n');
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
    { label: '显示涨跌百分比', detail: display.pct ? '开' : '关', key: 'showPct' },
    { label: '显示上涨（红）', detail: display.up ? '开' : '关', key: 'showUp' },
    { label: '显示下跌（绿）', detail: display.down ? '开' : '关', key: 'showDown' },
    { label: '刷新间隔', detail: `${config.get<number>('intervalSeconds', 10)} 秒`, key: 'interval' },
    { label: '主显品种', detail: symbolSetting(), key: 'symbol' },
    { label: '到价提醒', detail: `${rulesFromMemento(memento).length} 条`, key: 'alert' },
    { label: 'Bark device key', detail: config.get<string>('barkKey', '') ? '已配置' : '未配置', key: 'bark' },
    {
      label: '免打扰时段',
      detail: config.get<boolean>('quietEnabled', false)
        ? `${config.get<string>('quietStart', '23:00')}–${config.get<string>('quietEnd', '08:00')}`
        : '关',
      key: 'quiet',
    },
    {
      label: '每日简报',
      detail: config.get<boolean>('digestEnabled', true) ? config.get<string>('digestTime', '08:30') : '关',
      key: 'digest',
    },
    { label: 'Webhook 推送', detail: config.get<string>('webhookUrl', '') ? '已配置' : '未配置', key: 'webhook' },
    {
      label: '邮件推送',
      detail:
        config.get<boolean>('emailEnabled', false) && config.get<string>('emailHost', '')
          ? config.get<string>('emailHost', '')
          : '未配置',
      key: 'email',
    },
    {
      label: '机器人推送',
      detail: config.get<boolean>('botEnabled', false)
        ? BOT_TYPE_TEXT[normalizeBotType(config.get<string>('botType', 'feishu'))]
        : '未配置',
      key: 'bot',
    },
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
    case 'showPct': {
      await config.update('showPct', !config.get<boolean>('showPct', false), vscode.ConfigurationTarget.Global);
      renderStatus(quotes.find((q) => q.symbol === symbolSetting()) ?? quotes[0], []);
      break;
    }
    case 'interval': {
      const raw = await vscode.window.showInputBox({
        prompt: '刷新间隔（秒），可选 5/10/30/60/120/300/600',
        value: String(config.get<number>('intervalSeconds', 10)),
        validateInput: (v) => ([5, 10, 30, 60, 120, 300, 600].includes(Number(v)) ? null : '可选 5/10/30/60/120/300/600 秒'),
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
    case 'quiet': {
      const start = await vscode.window.showInputBox({
        prompt: '免打扰开始（HH:MM，留空关闭）',
        value: config.get<string>('quietStart', '23:00'),
        validateInput: (v) => (!v.trim() || parseHhmm(v) !== null ? null : '格式应为 HH:MM'),
      });
      if (start === undefined) break;
      if (!start.trim()) {
        await config.update('quietEnabled', false, vscode.ConfigurationTarget.Global);
        break;
      }
      const end = await vscode.window.showInputBox({
        prompt: '免打扰结束（HH:MM）',
        value: config.get<string>('quietEnd', '08:00'),
        validateInput: (v) => (parseHhmm(v) !== null ? null : '格式应为 HH:MM'),
      });
      if (end === undefined || parseHhmm(end) === null) break;
      await config.update('quietStart', start.trim(), vscode.ConfigurationTarget.Global);
      await config.update('quietEnd', end.trim(), vscode.ConfigurationTarget.Global);
      await config.update('quietEnabled', true, vscode.ConfigurationTarget.Global);
      break;
    }
    case 'digest': {
      const time = await vscode.window.showInputBox({
        prompt: '每日简报时间（HH:MM，留空关闭）',
        value: config.get<string>('digestTime', '08:30'),
        validateInput: (v) => (!v.trim() || parseHhmm(v) !== null ? null : '格式应为 HH:MM'),
      });
      if (time === undefined) break;
      if (!time.trim()) {
        await config.update('digestEnabled', false, vscode.ConfigurationTarget.Global);
        break;
      }
      await config.update('digestTime', time.trim(), vscode.ConfigurationTarget.Global);
      await config.update('digestEnabled', true, vscode.ConfigurationTarget.Global);
      break;
    }
    case 'webhook': {
      const url = await vscode.window.showInputBox({
        prompt: 'Webhook 地址（留空关闭），POST JSON：title/body/source/ts',
        value: config.get<string>('webhookUrl', ''),
        ignoreFocusOut: true,
        validateInput: (v) => (!v.trim() || /^https?:\/\//.test(v.trim()) ? null : '必须以 http(s):// 开头'),
      });
      if (url !== undefined) await config.update('webhookUrl', url.trim(), vscode.ConfigurationTarget.Global);
      break;
    }
    case 'email': {
      const host = await vscode.window.showInputBox({
        prompt: 'SMTP 服务器（留空关闭邮件推送），如 smtp.qq.com',
        value: config.get<string>('emailHost', ''),
        validateInput: (v) => (!v.trim() || /^[^\s/:]+$/.test(v.trim()) ? null : '只填主机名，不要带协议或斜杠'),
      });
      if (host === undefined) break;
      if (!host.trim()) {
        await config.update('emailEnabled', false, vscode.ConfigurationTarget.Global);
        break;
      }
      const port = await vscode.window.showInputBox({
        prompt: 'SMTP 端口（465/587）',
        value: String(config.get<number>('emailPort', 465)),
        validateInput: (v) => (/^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 65535 ? null : '端口应为 1–65535'),
      });
      if (port === undefined) break;
      const ssl = await vscode.window.showQuickPick(
        [
          { label: 'SSL（465）', value: true },
          { label: 'STARTTLS / 明文（587/25）', value: false },
        ],
        { placeHolder: '连接方式' },
      );
      if (!ssl) break;
      const user = await vscode.window.showInputBox({
        prompt: 'SMTP 账号邮箱（留空表示不认证）',
        value: config.get<string>('emailUser', ''),
        ignoreFocusOut: true,
      });
      if (user === undefined) break;
      const pass = await vscode.window.showInputBox({
        prompt: 'SMTP 密码或授权码（存在 VS Code 设置里）',
        password: true,
        ignoreFocusOut: true,
        value: config.get<string>('emailPass', ''),
      });
      if (pass === undefined) break;
      const from = await vscode.window.showInputBox({
        prompt: '发件人邮箱（留空同账号）',
        value: config.get<string>('emailFrom', '') || user.trim(),
      });
      if (from === undefined) break;
      const to = await vscode.window.showInputBox({
        prompt: '收件人邮箱，多个用逗号分隔',
        value: config.get<string>('emailTo', ''),
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? null : '至少一个收件人'),
      });
      if (to === undefined || !to.trim()) break;
      await config.update('emailHost', host.trim(), vscode.ConfigurationTarget.Global);
      await config.update('emailPort', Number(port), vscode.ConfigurationTarget.Global);
      await config.update('emailSecure', ssl.value, vscode.ConfigurationTarget.Global);
      await config.update('emailUser', user.trim(), vscode.ConfigurationTarget.Global);
      await config.update('emailPass', pass, vscode.ConfigurationTarget.Global);
      await config.update('emailFrom', from.trim(), vscode.ConfigurationTarget.Global);
      await config.update('emailTo', to.trim(), vscode.ConfigurationTarget.Global);
      await config.update('emailEnabled', true, vscode.ConfigurationTarget.Global);
      void vscode.window.setStatusBarMessage('GoldSentry：邮件推送已保存', 4000);
      break;
    }
    case 'bot': {
      const picked = await vscode.window.showQuickPick(
        BOT_TYPE_ORDER.map((type) => ({ label: BOT_TYPE_TEXT[type], type })),
        { placeHolder: '机器人平台（Esc 取消，清空地址可关闭）' },
      );
      if (!picked) break;
      if (picked.type === 'telegram') {
        const token = await vscode.window.showInputBox({
          prompt: 'Telegram bot token',
          password: true,
          ignoreFocusOut: true,
          value: config.get<string>('botToken', ''),
        });
        if (token === undefined) break;
        const chatId = await vscode.window.showInputBox({
          prompt: 'Telegram chat id',
          value: config.get<string>('botChatId', ''),
          validateInput: (v) => (v.trim() ? null : 'chat id 不能为空'),
        });
        if (chatId === undefined || !chatId.trim()) break;
        await config.update('botToken', token.trim(), vscode.ConfigurationTarget.Global);
        await config.update('botChatId', chatId.trim(), vscode.ConfigurationTarget.Global);
      } else {
        const url = await vscode.window.showInputBox({
          prompt: `${BOT_TYPE_TEXT[picked.type]}机器人 Webhook（留空关闭）`,
          value: config.get<string>('botUrl', ''),
          ignoreFocusOut: true,
          validateInput: (v) => (!v.trim() || /^https?:\/\//.test(v.trim()) ? null : '必须以 http(s):// 开头'),
        });
        if (url === undefined) break;
        if (!url.trim()) {
          await config.update('botEnabled', false, vscode.ConfigurationTarget.Global);
          break;
        }
        await config.update('botUrl', url.trim(), vscode.ConfigurationTarget.Global);
        if (picked.type === 'dingtalk') {
          const secret = await vscode.window.showInputBox({
            prompt: '钉钉加签密钥（没开加签就留空）',
            password: true,
            ignoreFocusOut: true,
            value: config.get<string>('botSecret', ''),
          });
          if (secret === undefined) break;
          await config.update('botSecret', secret.trim(), vscode.ConfigurationTarget.Global);
        }
      }
      await config.update('botType', picked.type, vscode.ConfigurationTarget.Global);
      await config.update('botEnabled', true, vscode.ConfigurationTarget.Global);
      void vscode.window.setStatusBarMessage(`GoldSentry：${BOT_TYPE_TEXT[picked.type]}推送已保存`, 4000);
      break;
    }
    case 'pause':
      await vscode.commands.executeCommand('goldsentry.pause');
      break;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  store = new QuoteStore(vscode.Uri.joinPath(context.globalStorageUri, 'quotes.json').fsPath);
  store.retainSymbols(JD_SYMBOLS);
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
  store?.flush();
}
