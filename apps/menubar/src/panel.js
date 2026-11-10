const els = {
  stamp: document.getElementById('stamp'),
  health: document.getElementById('health'),
  errors: document.getElementById('errors'),
  body: document.querySelector('#quotes tbody'),
  ruleRows: document.getElementById('rule-rows'),
  save: document.getElementById('save'),
  refresh: document.getElementById('refresh'),
  interval: document.getElementById('interval'),
  intervalNote: document.getElementById('interval-note'),
  loginRow: document.getElementById('login-row'),
  loginOn: document.getElementById('login-on'),
  loginHint: document.getElementById('login-hint'),
  barkOn: document.getElementById('bark-on'),
  barkServer: document.getElementById('bark-server'),
  barkKey: document.getElementById('bark-key'),
  barkSave: document.getElementById('bark-save'),
  barkTest: document.getElementById('bark-test'),
  barkResult: document.getElementById('bark-result'),
  webhookOn: document.getElementById('webhook-on'),
  webhookUrl: document.getElementById('webhook-url'),
  webhookSave: document.getElementById('webhook-save'),
  webhookTest: document.getElementById('webhook-test'),
  webhookResult: document.getElementById('webhook-result'),
  mailOn: document.getElementById('mail-on'),
  mailHost: document.getElementById('mail-host'),
  mailPort: document.getElementById('mail-port'),
  mailSecure: document.getElementById('mail-secure'),
  mailUser: document.getElementById('mail-user'),
  mailPass: document.getElementById('mail-pass'),
  mailFrom: document.getElementById('mail-from'),
  mailTo: document.getElementById('mail-to'),
  mailSave: document.getElementById('mail-save'),
  mailTest: document.getElementById('mail-test'),
  mailResult: document.getElementById('mail-result'),
  botOn: document.getElementById('bot-on'),
  botType: document.getElementById('bot-type'),
  botUrl: document.getElementById('bot-url'),
  botSecret: document.getElementById('bot-secret'),
  botToken: document.getElementById('bot-token'),
  botChatId: document.getElementById('bot-chat-id'),
  botUrlRow: document.getElementById('bot-url-row'),
  botTgRow: document.getElementById('bot-tg-row'),
  botSave: document.getElementById('bot-save'),
  botTest: document.getElementById('bot-test'),
  botResult: document.getElementById('bot-result'),
  digestOn: document.getElementById('digest-on'),
  digestTime: document.getElementById('digest-time'),
  digestSave: document.getElementById('digest-save'),
  digestResult: document.getElementById('digest-result'),
  quietOn: document.getElementById('quiet-on'),
  quietStart: document.getElementById('quiet-start'),
  quietEnd: document.getElementById('quiet-end'),
  quietSave: document.getElementById('quiet-save'),
  quietResult: document.getElementById('quiet-result'),
  ballRow: document.getElementById('ball-row'),
  ballScaleRow: document.getElementById('ball-scale-row'),
  ballHint: document.getElementById('ball-hint'),
  ballOn: document.getElementById('ball-on'),
  ballOpacity: document.getElementById('ball-opacity'),
  ballVal: document.getElementById('ball-opacity-val'),
  ballScale: document.getElementById('ball-scale'),
  ballScaleVal: document.getElementById('ball-scale-val'),
  taskbarRow: document.getElementById('taskbar-row'),
  taskbarOn: document.getElementById('taskbar-on'),
  taskbarTrendRow: document.getElementById('taskbar-trend-row'),
  taskbarTrendOn: document.getElementById('taskbar-trend-on'),
  tabDetail: document.getElementById('tab-detail'),
  tabCalc: document.getElementById('tab-calc'),
  tabSettings: document.getElementById('tab-settings'),
  viewDetail: document.getElementById('view-detail'),
  viewCalc: document.getElementById('view-calc'),
  viewSettings: document.getElementById('view-settings'),
  trend: document.getElementById('trend'),
  trendTitle: document.getElementById('trend-title'),
  trendLast: document.getElementById('trend-last'),
  trendPct: document.getElementById('trend-pct'),
  trendRange: document.getElementById('trend-range'),
  trendSvg: document.getElementById('trend-svg'),
  trendTip: document.getElementById('trend-tip'),
  trendEmpty: document.getElementById('trend-empty'),
  trendAxis: document.getElementById('trend-axis'),
  dispName: document.getElementById('disp-name'),
  dispPct: document.getElementById('disp-pct'),
  dispArrow: document.getElementById('disp-arrow'),
  trendOn: document.getElementById('trend-on'),
  trendRangeSelect: document.getElementById('trend-range-select'),
  notifyTest: document.getElementById('notify-test'),
  quit: document.getElementById('quit'),
  quoteTip: document.getElementById('quote-tip'),
  calcGrams: document.getElementById('calc-grams'),
  calcCount: document.getElementById('calc-count'),
  calcCost: document.getElementById('calc-cost'),
  calcAvg: document.getElementById('calc-avg'),
  calcBuy: document.getElementById('calc-buy'),
  calcSell: document.getElementById('calc-sell'),
  calcDate: document.getElementById('calc-date'),
  calcGramsInput: document.getElementById('calc-grams-input'),
  calcPriceInput: document.getElementById('calc-price-input'),
  calcAdd: document.getElementById('calc-add'),
  calcError: document.getElementById('calc-error'),
  calcTotal: document.getElementById('calc-total'),
  calcAll: document.getElementById('calc-all'),
  calcDel: document.getElementById('calc-del'),
  calcRows: document.getElementById('calc-rows'),
  calcSymbolInput: document.getElementById('calc-symbol-input'),
  calcPositions: document.getElementById('calc-positions'),
  calcInvalid: document.getElementById('calc-invalid'),
};

const TONE_CLASS = { up: 'up', down: 'down', flat: '' };
/** 与 core 的 PORTFOLIO_SYMBOL 保持一致：组合盈亏规则不绑具体银行 */
const PORTFOLIO_SYMBOL = 'PORTFOLIO';

/** 标题属性来自银行接口与 core 常量，拼进 HTML 前一律转义 */
function escAttr(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

let quoteTipTimer = 0;
let quoteTipRow = null;
/** 轮询会重建表格，记住指针停在哪家，重建后还能把卡片接上 */
let hoveredSymbol = null;

function hideQuoteTip() {
  clearTimeout(quoteTipTimer);
  quoteTipTimer = 0;
  quoteTipRow = null;
  if (els.quoteTip) els.quoteTip.hidden = true;
}

function placeQuoteTip(row) {
  const tip = els.quoteTip;
  tip.hidden = false;
  const anchor = row.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8));
  let top = anchor.bottom + 6;
  if (top + box.height > window.innerHeight - 8) top = Math.max(8, anchor.top - box.height - 6);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function quoteTipHtml(quote, cell, detail) {
  const tone = TONE_CLASS[cell.tone] ?? '';
  const sessionClass = detail?.sessionOpen ? 'open' : 'closed';
  const sessionReason = detail?.sessionReason
    ? `<div class="qt-note">${escAttr(detail.sessionReason)}</div>`
    : '';
  return `<div class="qt-head"><span class="qt-name">${escAttr(detail?.name ?? quote.name)}</span><span class="qt-sym">${escAttr(quote.symbol)}</span></div>
    <div class="qt-grid">
      <span>买入</span><b>${cell.buy}</b>
      <span>卖出</span><b>${cell.sell}</b>
      <span>点差</span><b>${escAttr(detail?.spreadText ?? '—')}</b>
      <span>服务费</span><b>${escAttr(detail?.fee ?? '—')}</b>
      <span>涨跌</span><b class="${tone}">${cell.pct}</b>
      <span>更新</span><b>${cell.update}</b>
    </div>
    <div class="qt-line"><span>交易时段</span><b>${escAttr(detail?.hours ?? '—')}</b><em class="${sessionClass}">${escAttr(detail?.session ?? '—')}</em></div>
    ${sessionReason}
    <div class="qt-note">${escAttr(detail?.hoursNote ?? '')}</div>
    <div class="qt-note">点差：${escAttr(detail?.spreadNote ?? '')}</div>
    <div class="qt-note">服务费：${escAttr(detail?.feeNote ?? '')}</div>
    <div class="qt-note">${escAttr(detail?.source ?? '')} · ${escAttr(detail?.basis ?? '')} · 报价 ${escAttr(detail?.quoteTime ?? '—')}</div>`;
}

function scheduleQuoteTip(row, quote, cell, detail) {
  clearTimeout(quoteTipTimer);
  quoteTipRow = row;
  quoteTipTimer = setTimeout(() => {
    if (hold?.dragging || quoteTipRow !== row) return;
    els.quoteTip.innerHTML = quoteTipHtml(quote, cell, detail);
    placeQuoteTip(row);
  }, 120);
}

function renderQuotes(next) {
  const keepHover = hoveredSymbol;
  hideQuoteTip();
  els.body.innerHTML = '';
  const cells = next.cells ?? {};
  const spreadCells = next.spreadCells ?? {};
  for (const quote of next.quotes) {
    const row = document.createElement('tr');
    const primary = quote.symbol === next.primarySymbol;
    // 买/卖/涨跌/更新列与点差的文本都由 core 生成，这里只负责贴
    const cell = cells[quote.symbol] ?? { buy: '—', sell: '—', pct: '—', tone: 'flat', update: '—', updateStale: false };
    const spread = spreadCells[quote.symbol] ?? { text: '—', basis: 'fee', note: '点差与费率均未知', stale: false };
    row.dataset.symbol = quote.symbol;
    if (primary) row.classList.add('primary');
    row.innerHTML = `<td class="name">${primary ? '● ' : ''}${escAttr(quote.label)}</td>
      <td class="buy">${cell.buy}</td>
      <td>${cell.sell}</td>
      <td class="spread${spread.stale ? ' stale-fee' : ''}">${spread.text}</td>
      <td class="${TONE_CLASS[cell.tone] ?? ''}">${cell.pct}</td>
      <td class="${cell.updateStale ? 'stale' : ''}">${cell.update}</td>`;
    const detail = next.details?.[quote.symbol];
    row.addEventListener('mouseenter', () => {
      hoveredSymbol = quote.symbol;
      scheduleQuoteTip(row, quote, cell, detail);
    });
    row.addEventListener('mousemove', () => {
      if (quoteTipRow === row && !els.quoteTip.hidden) placeQuoteTip(row);
    });
    row.addEventListener('mouseleave', () => {
      hoveredSymbol = null;
      hideQuoteTip();
    });
    row.addEventListener('click', () => {
      // 拖拽结束也会补一次 click，手势不能同时改主显品种
      if (suppressClick) return;
      hideQuoteTip();
      window.gold.setPrimary(quote.symbol).then(applyState);
    });
    els.body.appendChild(row);
  }
  if (keepHover) {
    const row = [...els.body.children].find((node) => node.dataset.symbol === keepHover);
    const quote = next.quotes.find((item) => item.symbol === keepHover);
    if (row && quote) {
      const cell = cells[keepHover] ?? { buy: '—', sell: '—', pct: '—', tone: 'flat', update: '—', updateStale: false };
      scheduleQuoteTip(row, quote, cell, next.details?.[keepHover]);
    }
  }
}

/** 分时图：坐标与颜色都由 core 的 trend 数据决定，这里只画线 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const TREND_W = 416;
const TREND_H = 64;
const TREND_PAD = 6;
const TREND_TONE = { up: '#ef5350', down: '#26a269', flat: '#9a9ba1' };

let trendView = null;

function svgNode(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function trendX(ts) {
  return ((ts - trendView.windowStart) / (trendView.windowEnd - trendView.windowStart)) * TREND_W;
}

function trendY(price) {
  return TREND_H - TREND_PAD - ((price - trendView.min) / (trendView.max - trendView.min)) * (TREND_H - TREND_PAD * 2);
}

function hideTrendTip() {
  els.trendTip.hidden = true;
  if (!trendView) return;
  trendView.line.setAttribute('visibility', 'hidden');
  trendView.dot.setAttribute('visibility', 'hidden');
}

function renderTrend(trend, label) {
  trendView = null;
  els.trendTip.hidden = true;
  els.trendSvg.replaceChildren();
  if (!trend) {
    els.trend.hidden = true;
    return;
  }
  els.trend.hidden = false;
  const points = trend.points ?? [];
  const title = label || trend.symbol;
  els.trendTitle.textContent = `${title} · ${trend.windowText ?? (trend.isToday ? '今日分时' : `${trend.day.slice(5)} 分时`)}`;
  els.trendTitle.title = '来自本机轮询采样（应用启动后开始累积），涨跌相对所选区间首笔；休市时展示最近一个有数据的交易日。';
  els.trendLast.textContent = trend.lastText ?? '—';
  els.trendPct.textContent = trend.changeText ?? '—';
  els.trendPct.className = `trend-pct ${trend.tone ?? 'flat'}`;
  els.trendPct.title = '相对所选区间首笔采样';
  els.trendRange.textContent = points.length ? `低 ${trend.lowText} · 高 ${trend.highText}` : '';
  els.trendEmpty.hidden = points.length > 0;
  els.trendAxis.hidden = points.length === 0;
  const labels = trend.axisLabels ?? [];
  if (labels.length === 3) {
    [...els.trendAxis.children].forEach((node, index) => {
      node.textContent = labels[index];
    });
  }
  if (!points.length) return;

  const span = trend.high - trend.low;
  const pad = span > 0 ? span * 0.08 : Math.max(trend.high * 0.0004, 0.01);
  const color = TREND_TONE[trend.tone] ?? TREND_TONE.flat;
  trendView = {
    points,
    windowStart: trend.windowStart,
    windowEnd: trend.windowEnd,
    min: trend.low - pad,
    max: trend.high + pad,
    line: svgNode('line', { y1: 0, y2: TREND_H, stroke: '#6c6e75', 'stroke-width': 1, 'stroke-dasharray': '2 3', visibility: 'hidden' }),
    dot: svgNode('circle', { r: 2.4, fill: color, stroke: '#1c1e22', 'stroke-width': 1, visibility: 'hidden' }),
  };

  els.trendSvg.appendChild(
    svgNode('line', { x1: 0, y1: TREND_H / 2, x2: TREND_W, y2: TREND_H / 2, stroke: '#2e3138', 'stroke-width': 1, 'stroke-dasharray': '2 4' }),
  );

  // 午休/收盘的时间空档要断开，否则会连出一条不存在的斜线
  const base = TREND_H - 1;
  let segment = [];
  const flush = () => {
    if (!segment.length) return;
    if (segment.length === 1) {
      els.trendSvg.appendChild(svgNode('circle', { cx: trendX(segment[0].ts), cy: trendY(segment[0].price), r: 2, fill: color }));
    } else {
      const coords = segment.map((p) => `${trendX(p.ts).toFixed(2)},${trendY(p.price).toFixed(2)}`);
      const first = trendX(segment[0].ts).toFixed(2);
      const last = trendX(segment[segment.length - 1].ts).toFixed(2);
      const area = `M${first},${base} ${coords.map((c) => `L${c}`).join(' ')} L${last},${base} Z`;
      els.trendSvg.appendChild(svgNode('path', { d: area, fill: color, 'fill-opacity': 0.12 }));
      els.trendSvg.appendChild(
        svgNode('path', { d: `M${coords.join(' L')}`, fill: 'none', stroke: color, 'stroke-width': 1.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      );
    }
    segment = [];
  };
  for (const point of points) {
    if (point.gap) flush();
    segment.push(point);
  }
  flush();

  els.trendSvg.appendChild(trendView.line);
  els.trendSvg.appendChild(trendView.dot);
  els.trendSvg.appendChild(svgNode('rect', { x: 0, y: 0, width: TREND_W, height: TREND_H, fill: 'transparent' }));
}

els.trendSvg.addEventListener('pointermove', (event) => {
  if (!trendView) return;
  const box = els.trendSvg.getBoundingClientRect();
  const fraction = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
  const ts = trendView.windowStart + fraction * (trendView.windowEnd - trendView.windowStart);
  let nearest = trendView.points[0];
  for (const point of trendView.points) {
    if (Math.abs(point.ts - ts) < Math.abs(nearest.ts - ts)) nearest = point;
  }
  const x = trendX(nearest.ts);
  const y = trendY(nearest.price);
  trendView.line.setAttribute('x1', x);
  trendView.line.setAttribute('x2', x);
  trendView.line.setAttribute('visibility', 'visible');
  trendView.dot.setAttribute('cx', x);
  trendView.dot.setAttribute('cy', y);
  trendView.dot.setAttribute('visibility', 'visible');
  els.trendTip.textContent = `${nearest.timeText} · ${nearest.text}`;
  els.trendTip.hidden = false;
  els.trendTip.style.left = `${Math.min(Math.max((x / TREND_W) * 100, 14), 86)}%`;
  els.trendTip.style.top = `${y > 20 ? y - 20 : y + 4}px`;
});

els.trendSvg.addEventListener('pointerleave', hideTrendTip);

function symbolOptions(extra) {
  const list = (state?.quotes ?? []).map((q) => ({ value: q.symbol, text: q.label }));
  list.push({ value: PORTFOLIO_SYMBOL, text: '组合持仓（总盈亏）' });
  // 规则里可能有已经下线的品种，留着选项才不会把这条悄悄改掉
  if (extra && extra !== PORTFOLIO_SYMBOL && !list.some((o) => o.value === extra)) list.push({ value: extra, text: extra });
  return list;
}

function optionTags(items, selected) {
  return items
    .map((i) => `<option value="${escAttr(i.value)}"${i.value === selected ? ' selected' : ''}>${escAttr(i.text)}</option>`)
    .join('');
}

/** pending 行是末尾那条"选品种就新增"的空行，没有勾选和删除 */
function renderRuleRow(row, pending = false) {
  const kinds = state?.ruleKinds ?? [];
  const kind = row.kind ?? 'below';
  const portfolio = kinds.find((k) => k.kind === kind)?.portfolio === true;
  const unitOf = (value) => kinds.find((k) => k.kind === value)?.unit ?? '元/克';
  const el = document.createElement('div');
  el.className = pending ? 'rule-row pending' : 'rule-row';
  const selectedSymbol = portfolio ? PORTFOLIO_SYMBOL : (pending ? '' : row.symbol);
  el.innerHTML = `${pending ? '' : `<input type="checkbox" class="on" ${row.enabled ? 'checked' : ''} />`}
    <select class="sym"${portfolio ? ' disabled' : ''}>${pending && !portfolio ? '<option value="" selected>选择品种…</option>' : ''}${optionTags(symbolOptions(selectedSymbol), selectedSymbol)}</select>
    <select class="kind">${optionTags(kinds.map((k) => ({ value: k.kind, text: k.text })), kind)}</select>
    <input type="number" class="val" step="0.01" value="${pending ? '' : (row.value ?? '')}" placeholder="${escAttr(unitOf(kind))}" />
    ${pending ? '' : '<button class="del" type="button" title="删除这条提醒">×</button>'}`;
  el.querySelector('.kind').addEventListener('change', (event) => {
    const nextKind = event.currentTarget.value;
    const nextPortfolio = kinds.find((k) => k.kind === nextKind)?.portfolio === true;
    const sym = event.currentTarget.closest('.rule-row').querySelector('.sym');
    sym.disabled = nextPortfolio;
    if (nextPortfolio) sym.value = PORTFOLIO_SYMBOL;
    else if (sym.value === PORTFOLIO_SYMBOL) sym.value = state?.quotes?.[0]?.symbol ?? '';
    event.currentTarget.closest('.rule-row').querySelector('.val').placeholder = unitOf(nextKind);
  });
  // 选了"组合持仓"就自动切到组合盈亏规则，避免用价格方向保存出一条永远不触发的规则
  el.querySelector('.sym').addEventListener('change', (event) => {
    if (event.currentTarget.value !== PORTFOLIO_SYMBOL) return;
    const kindSel = el.querySelector('.kind');
    kindSel.value = 'pnlPctAbove';
    kindSel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  if (!pending) {
    el.querySelector('.del').addEventListener('click', (event) => event.currentTarget.closest('.rule-row').remove());
  }
  return el;
}

/** 只有落盘的规则真的变了才重建，否则轮询会把用户正在编辑的行冲掉 */
let rulesSignature = '';

function renderRules(next) {
  const rows = next.ruleRows ?? [];
  const signature = rows.map((r) => `${r.symbol}|${r.kind}|${r.value ?? ''}|${r.enabled ? 1 : 0}`).join('||');
  if (signature === rulesSignature) return;
  rulesSignature = signature;
  els.ruleRows.innerHTML = '';
  for (const row of rows) els.ruleRows.appendChild(renderRuleRow(row));
  els.ruleRows.appendChild(renderRuleRow({}, true));
}

function collectRules() {
  return [...els.ruleRows.querySelectorAll('.rule-row')].map((row) => {
    const kind = row.querySelector('.kind').value;
    const portfolio = (state?.ruleKinds ?? []).find((k) => k.kind === kind)?.portfolio === true;
    return {
      symbol: portfolio ? PORTFOLIO_SYMBOL : row.querySelector('.sym').value,
      kind,
      value: row.querySelector('.val').value.trim(),
      // 末尾的新增行没有勾选，默认就是启用
      enabled: row.querySelector('.on')?.checked ?? true,
    };
  });
}

let state = null;

/** 长按拖拽排序的手势状态 */
const HOLD_MS = 260;
const MOVE_SLOP = 5;
let hold = null;
let suppressClick = false;

function fillBark(bark) {
  if (!bark) return;
  // 正在输入时不覆盖，避免轮询刷新打断编辑
  if (document.activeElement === els.barkServer || document.activeElement === els.barkKey) return;
  els.barkOn.checked = !!bark.enabled;
  els.barkServer.value = bark.server ?? '';
  els.barkKey.value = bark.deviceKey ?? '';
}

function fillWebhook(webhook) {
  if (!webhook) return;
  if (document.activeElement === els.webhookUrl) return;
  els.webhookOn.checked = !!webhook.enabled;
  els.webhookUrl.value = webhook.url ?? '';
}

const MAIL_INPUTS = () => [els.mailHost, els.mailPort, els.mailUser, els.mailPass, els.mailFrom, els.mailTo];

function fillMail(mail) {
  if (!mail) return;
  // 正在输入的字段不覆盖；口令框按原值回填，避免轮询把已保存的授权码冲掉
  if (MAIL_INPUTS().includes(document.activeElement)) return;
  els.mailOn.checked = !!mail.enabled;
  els.mailHost.value = mail.host ?? '';
  els.mailPort.value = String(mail.port ?? 465);
  els.mailSecure.checked = mail.secure !== false;
  els.mailUser.value = mail.user ?? '';
  els.mailPass.value = mail.pass ?? '';
  els.mailFrom.value = mail.from ?? '';
  els.mailTo.value = mail.to ?? '';
}

const BOT_INPUTS = () => [els.botUrl, els.botSecret, els.botToken, els.botChatId];

function updateBotRows() {
  const telegram = els.botType.value === 'telegram';
  els.botUrlRow.hidden = telegram;
  els.botTgRow.hidden = !telegram;
}

function fillBot(bot) {
  if (!bot) return;
  const types = state?.botTypes ?? [];
  if (types.length && els.botType.options.length !== types.length) {
    els.botType.innerHTML = optionTags(types.map((item) => ({ value: item.type, text: item.text })), bot.type);
  }
  if (BOT_INPUTS().includes(document.activeElement)) return;
  els.botOn.checked = !!bot.enabled;
  els.botType.value = bot.type ?? 'feishu';
  els.botUrl.value = bot.url ?? '';
  els.botSecret.value = bot.secret ?? '';
  els.botToken.value = bot.token ?? '';
  els.botChatId.value = bot.chatId ?? '';
  updateBotRows();
}

function fillDigest(digest) {
  if (!digest) return;
  if (document.activeElement === els.digestTime) return;
  els.digestOn.checked = !!digest.enabled;
  els.digestTime.value = digest.time ?? '08:30';
}

function fillQuiet(quiet) {
  if (!quiet) return;
  if (document.activeElement === els.quietStart || document.activeElement === els.quietEnd) return;
  els.quietOn.checked = !!quiet.enabled;
  els.quietStart.value = quiet.start ?? '23:00';
  els.quietEnd.value = quiet.end ?? '08:00';
}

const HEALTH_TEXT = { ok: '正常', degraded: '部分异常', offline: '全部失效' };

function fillBall(ball) {
  if (!ball) return;
  // 球上滚轮也会改透明度，正在拖滑杆时不覆盖，避免来回打架
  if (document.activeElement === els.ballOpacity || document.activeElement === els.ballScale) return;
  els.ballOn.checked = !!ball.enabled;
  const percent = Math.round(ball.opacity * 100);
  els.ballOpacity.value = String(percent);
  els.ballVal.textContent = `${percent}%`;
  const scale = Math.round((ball.scale ?? 1) * 100);
  els.ballScale.value = String(scale);
  els.ballScaleVal.textContent = `${scale}%`;
}

function fillTaskbar(taskbar) {
  if (!taskbar) return;
  els.taskbarOn.checked = !!taskbar.enabled;
  if (document.activeElement !== els.taskbarTrendOn) els.taskbarTrendOn.checked = !!taskbar.trend;
  els.taskbarTrendOn.disabled = !taskbar.enabled;
}

function fillDisplay(display, arrowMode) {
  if (!display) return;
  els.dispName.checked = !!display.name;
  els.dispPct.checked = !!display.pct;
  const modes = state?.arrowModes ?? [];
  if (modes.length && els.dispArrow.options.length !== modes.length) {
    els.dispArrow.innerHTML = optionTags(modes.map((m) => ({ value: m.mode, text: m.text })), arrowMode);
  }
  if (arrowMode) els.dispArrow.value = arrowMode;
}

function fillTrendSettings(settings, ranges) {
  if (!settings) return;
  els.trendOn.checked = !!settings.enabled;
  if (ranges?.length && els.trendRangeSelect.options.length !== ranges.length) {
    els.trendRangeSelect.innerHTML = optionTags(ranges.map((r) => ({ value: r.range, text: r.text })), settings.range);
  }
  if (document.activeElement !== els.trendRangeSelect) els.trendRangeSelect.value = settings.range;
  // 任务栏走势共用这个范围，面板图表关掉时也不能禁用
}

function applyState(next) {
  state = next;
  els.stamp.textContent = next.lastPollAt
    ? `更新于 ${new Date(next.lastPollAt).toLocaleTimeString('zh-CN', { hour12: false })}`
    : '等待首次取数';
  const reasons = next.health?.reasons ?? [];
  els.errors.hidden = reasons.length === 0;
  els.errors.textContent = reasons.join('；');
  if (els.health) {
    const status = next.health?.status ?? 'ok';
    const closed = status === 'ok' && !!next.health?.marketClosed;
    els.health.textContent = closed ? '休市' : (HEALTH_TEXT[status] ?? '');
    els.health.dataset.status = closed ? 'closed' : status;
    els.health.title = closed ? (next.health?.closedReason ?? '') : '';
  }
  // 拖拽进行中不能重建表格，否则正在拖的那一行会被换掉
  if (!hold?.dragging) renderQuotes(next);
  const primary = (next.quotes ?? []).find((q) => q.symbol === next.primarySymbol);
  renderTrend(next.trend ?? null, primary?.label ?? '');
  renderRules(next);
  fillBark(next.bark);
  fillWebhook(next.webhook);
  fillMail(next.mail);
  fillBot(next.bot);
  fillDigest(next.digest);
  fillQuiet(next.quiet);
  fillBall(next.ball);
  fillTaskbar(next.taskbar);
  fillDisplay(next.display, next.arrowMode);
  fillTrendSettings(next.trendSettings, next.trendRanges);
  if (document.activeElement !== els.interval) els.interval.value = String(next.pollSeconds ?? 30);
  // 降频是 core 算的，面板只把"为什么变慢了"说清楚
  const base = next.pollSeconds ?? 30;
  const effective = next.effectivePollSeconds ?? base;
  const backingOff = effective > base;
  els.intervalNote.hidden = !backingOff;
  els.intervalNote.textContent = backingOff
    ? `数据源已连续失效 ${next.failureStreak ?? 0} 次，暂时降频到 ${effective} 秒；恢复后自动回到设定值。`
    : '';
  els.loginOn.checked = !!next.launchAtLogin;
}

els.interval.addEventListener('change', async () => {
  const result = await window.gold.setPollSeconds(Number(els.interval.value));
  if (!result.ok) els.interval.value = String(state?.pollSeconds ?? 30);
});

els.ballOn.addEventListener('change', async () => {
  const saved = await window.gold.setBall({ enabled: els.ballOn.checked });
  els.ballVal.textContent = `${Math.round(saved.opacity * 100)}%`;
  els.ballScaleVal.textContent = `${Math.round(saved.scale * 100)}%`;
});

els.taskbarOn.addEventListener('change', () => window.gold.setTaskbar({ enabled: els.taskbarOn.checked }).then(applyState));

els.taskbarTrendOn.addEventListener('change', () =>
  window.gold.setTaskbar({ trend: els.taskbarTrendOn.checked }).then(applyState),
);

els.loginOn.addEventListener('change', () => window.gold.setLaunchAtLogin(els.loginOn.checked).then(applyState));

// 透明度要即时反馈，用 input 而不是 change
els.ballOpacity.addEventListener('input', async () => {
  const percent = Number(els.ballOpacity.value);
  els.ballVal.textContent = `${percent}%`;
  await window.gold.setBall({ opacity: percent / 100 });
});

// 大小同样是滑杆即时生效，等比例缩放窗口与字号
els.ballScale.addEventListener('input', async () => {
  const percent = Number(els.ballScale.value);
  els.ballScaleVal.textContent = `${percent}%`;
  await window.gold.setBall({ scale: percent / 100 });
});

els.barkSave.addEventListener('click', async () => {
  const saved = await window.gold.saveBark({
    enabled: els.barkOn.checked,
    server: els.barkServer.value.trim() || 'https://api.day.app',
    deviceKey: els.barkKey.value.trim(),
  });
  els.barkResult.textContent = saved.hasKey
    ? `已保存：${saved.enabled ? '启用中' : '未启用'}，服务器 ${saved.server}`
    : '已保存，但 device key 为空，不会推送';
});

els.barkTest.addEventListener('click', async () => {
  els.barkResult.textContent = '正在推送…';
  const result = await window.gold.barkTest();
  els.barkResult.textContent = result.ok
    ? `推送成功（http ${result.status}），看手机`
    : `推送失败：${result.error ?? result.status}`;
});

els.webhookSave.addEventListener('click', async () => {
  const next = await window.gold.saveWebhook({
    enabled: els.webhookOn.checked,
    url: els.webhookUrl.value.trim(),
  });
  applyState(next);
  els.webhookResult.textContent = next.webhook?.enabled
    ? '已保存并启用'
    : '已保存，未启用';
});

els.webhookTest.addEventListener('click', async () => {
  els.webhookResult.textContent = '正在推送…';
  const result = await window.gold.webhookTest(els.webhookUrl.value.trim());
  els.webhookResult.textContent = result.ok
    ? `推送成功（http ${result.status}）`
    : `推送失败：${result.error ?? result.status}`;
});

function mailForm() {
  return {
    enabled: els.mailOn.checked,
    host: els.mailHost.value.trim(),
    port: Number(els.mailPort.value) || 465,
    secure: els.mailSecure.checked,
    user: els.mailUser.value.trim(),
    pass: els.mailPass.value,
    from: els.mailFrom.value.trim(),
    to: els.mailTo.value.trim(),
  };
}

els.mailSave.addEventListener('click', async () => {
  const next = await window.gold.saveMail(mailForm());
  applyState(next);
  const mail = next.mail;
  els.mailResult.textContent = !mail?.enabled
    ? '已保存，邮件推送未启用'
    : !mail.host || !mail.to
      ? '已保存，但服务器或收件人为空，不会发送'
      : `已保存并启用，收件人 ${mail.to}`;
});

els.mailTest.addEventListener('click', async () => {
  els.mailResult.textContent = '正在发送测试邮件…';
  const result = await window.gold.mailTest(mailForm());
  els.mailResult.textContent = result.ok
    ? `测试邮件已发出（SMTP ${result.status}），请查收`
    : `发送失败：${result.error ?? result.status}`;
});

function botForm() {
  return {
    enabled: els.botOn.checked,
    type: els.botType.value,
    url: els.botUrl.value.trim(),
    secret: els.botSecret.value.trim(),
    token: els.botToken.value.trim(),
    chatId: els.botChatId.value.trim(),
  };
}

els.botType.addEventListener('change', updateBotRows);

els.botSave.addEventListener('click', async () => {
  const next = await window.gold.saveBot(botForm());
  applyState(next);
  const bot = next.bot;
  const filled = bot?.type === 'telegram' ? bot.token && bot.chatId : bot.url;
  els.botResult.textContent = !bot?.enabled
    ? '已保存，机器人推送未启用'
    : filled
      ? '已保存并启用'
      : '已保存，但机器人地址/token 未填完整，不会发送';
});

els.botTest.addEventListener('click', async () => {
  els.botResult.textContent = '正在推送…';
  const result = await window.gold.botTest(botForm());
  els.botResult.textContent = result.ok
    ? `推送成功（http ${result.status}），到对应群或对话里看`
    : `推送失败：${result.error ?? result.status}`;
});

els.digestSave.addEventListener('click', async () => {
  const next = await window.gold.saveDigest({
    enabled: els.digestOn.checked,
    time: els.digestTime.value || '08:30',
  });
  applyState(next);
  els.digestResult.textContent = next.digest?.enabled
    ? `已保存，每天 ${next.digest.time} 发送`
    : '已保存，简报关闭';
});

els.quietSave.addEventListener('click', async () => {
  const next = await window.gold.saveQuiet({
    enabled: els.quietOn.checked,
    start: els.quietStart.value || '23:00',
    end: els.quietEnd.value || '08:00',
  });
  applyState(next);
  els.quietResult.textContent = next.quiet?.enabled
    ? `已保存：${next.quiet.start}–${next.quiet.end} 免打扰`
    : '已保存，免打扰关闭';
});

els.refresh.addEventListener('click', () => window.gold.refresh().then(applyState));
els.save.addEventListener('click', () => {
  window.gold.saveRules(collectRules()).then(applyState);
  els.save.textContent = '已保存';
  setTimeout(() => (els.save.textContent = '保存'), 1200);
});

const calcState = {
  loaded: false,
  rows: [],
  symbols: [],
  selected: new Set(),
  symbol: '',
  side: 'buy',
};

function selectTab(mode) {
  hoveredSymbol = null;
  hideQuoteTip();
  const isDetail = mode === 'detail';
  const isCalc = mode === 'calc';
  const isSettings = mode === 'settings';
  els.viewDetail.hidden = !isDetail;
  els.viewCalc.hidden = !isCalc;
  els.viewSettings.hidden = !isSettings;
  els.tabDetail.classList.toggle('active', isDetail);
  els.tabCalc.classList.toggle('active', isCalc);
  els.tabSettings.classList.toggle('active', isSettings);
  if (isCalc) {
    if (!calcState.loaded) loadCalc();
    else refreshCalcStats();
  }
}

els.tabDetail.addEventListener('click', () => selectTab('detail'));
els.tabCalc.addEventListener('click', () => selectTab('calc'));
els.tabSettings.addEventListener('click', () => selectTab('settings'));
window.gold.onMode(selectTab);

/* ---------- 计算页：均价 / 持仓 / 模拟盈亏 ---------- */

function localDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function calcToneClass(tone) {
  return tone === 'up' ? 'calc-tone-up' : tone === 'down' ? 'calc-tone-down' : 'calc-tone-flat';
}

function calcSelectedIds() {
  return [...calcState.selected];
}

function showCalcError(text) {
  els.calcError.textContent = text || '';
  els.calcError.hidden = !text;
}

function updateCalcAllLabel() {
  const all = calcState.rows.map((row) => row.id);
  const every = all.length > 0 && all.every((id) => calcState.selected.has(id));
  els.calcAll.textContent = every ? '取消全选' : '全选';
}

function renderCalcRows() {
  if (!calcState.rows.length) {
    els.calcRows.innerHTML = '<p class="calc-empty">还没有记录，先添加一笔买入</p>';
    return;
  }
  els.calcRows.innerHTML = calcState.rows
    .map(
      (row) => `<div class="calc-row" data-id="${escAttr(row.id)}">
        <input type="checkbox" ${calcState.selected.has(row.id) ? 'checked' : ''} aria-label="选择这条记录" />
        <span class="calc-side-tag ${row.side}">${row.side === 'buy' ? '买入' : '卖出'}</span>
        <span class="calc-bank">${escAttr(row.symbolText)}</span>
        <span>${escAttr(row.date)}</span>
        <span class="calc-mid"><span>克数 ${escAttr(row.gramsText)}</span><span>单价 ${escAttr(row.priceText)}</span></span>
        <span class="calc-amount"><span>${row.side === 'buy' ? '成本' : '金额'}</span><b>${escAttr(row.amountText)}</b></span>
      </div>`,
    )
    .join('');
}

function applyCalcBase(base) {
  calcState.rows = base.rows;
  calcState.symbols = base.symbols;
  if (!calcState.symbol || !base.symbols.some((item) => item.symbol === calcState.symbol)) {
    calcState.symbol = base.symbols.some((item) => item.symbol === base.defaultSymbol)
      ? base.defaultSymbol
      : (base.symbols[0]?.symbol ?? '');
  }
  els.calcSymbolInput.innerHTML = base.symbols
    .map((item) => `<option value="${escAttr(item.symbol)}">${escAttr(item.label)}</option>`)
    .join('');
  els.calcSymbolInput.value = calcState.symbol;
  els.calcTotal.textContent = `共 ${base.counts.total} 条 · 买入 ${base.counts.buys} / 卖出 ${base.counts.sells}`;

  const present = new Set(base.rows.map((row) => row.id));
  calcState.selected = calcState.loaded
    ? new Set([...calcState.selected].filter((id) => present.has(id)))
    : new Set(base.rows.map((row) => row.id));
  calcState.loaded = true;
  renderCalcRows();
  updateCalcAllLabel();
}

function applyCalcStats(stats) {
  els.calcGrams.textContent = stats.selected.gramsText;
  els.calcCount.textContent = stats.selected.countText;
  els.calcCost.textContent = stats.selected.costText;
  els.calcAvg.textContent = stats.selected.avgText;

  const positions = stats.positions ?? [];
  if (!positions.length) {
    els.calcPositions.innerHTML = '<p class="calc-pos-empty">还没有持仓，先添加一笔买入</p>';
  } else {
    const head =
      '<div class="calc-pos-row calc-pos-head"><span>银行</span><span>持仓</span><span>成本均价</span><span>实时卖出</span><span>模拟浮盈</span></div>';
    const rows = positions
      .map(
        (item) => `<div class="calc-pos-row">
          <span>${escAttr(item.label)}</span>
          <span>${escAttr(item.gramsText)}</span>
          <span>${escAttr(item.avgText)}</span>
          <span>${escAttr(item.sellText)}</span>
          <span class="${calcToneClass(item.tone)}">${escAttr(item.pnlText)} <em>${escAttr(item.pnlPctText)}</em></span>
        </div>`,
      )
      .join('');
    const total = stats.total
      ? `<div class="calc-pos-row calc-pos-total">
          <b>合计</b><b>${escAttr(stats.total.gramsText)}</b><b>${escAttr(stats.total.costText)}</b>
          <b>${escAttr(stats.total.valueText)}</b>
          <b class="${calcToneClass(stats.total.tone)}">${escAttr(stats.total.pnlText)} <em>${escAttr(stats.total.pnlPctText)}</em></b>
        </div>`
      : '';
    els.calcPositions.innerHTML = head + rows + total;
  }

  const note =
    stats.total?.invalidNote ||
    (!stats.total?.complete && positions.length ? '有银行缺实时卖出价，合计暂不显示' : '');
  els.calcInvalid.textContent = note;
  els.calcInvalid.hidden = !note;
}

function refreshCalcStats() {
  if (!calcState.loaded) return;
  window.gold.calcSummary({ symbol: calcState.symbol, ids: calcSelectedIds() }).then((result) => {
    if (result?.ok) applyCalcStats(result.stats);
  });
}

function loadCalc() {
  window.gold.calcLoad({ symbol: calcState.symbol, ids: calcSelectedIds() }).then((result) => {
    if (!result?.ok) return;
    applyCalcBase(result.base);
    refreshCalcStats();
  });
}

function setCalcSide(side) {
  calcState.side = side;
  els.calcBuy.classList.toggle('on', side === 'buy');
  els.calcSell.classList.toggle('on', side === 'sell');
  els.calcAdd.textContent = side === 'buy' ? '添加买入' : '添加卖出';
  els.calcAdd.classList.toggle('sell', side === 'sell');
}

els.calcBuy.addEventListener('click', () => setCalcSide('buy'));
els.calcSell.addEventListener('click', () => setCalcSide('sell'));

els.calcRows.addEventListener('change', (event) => {
  const box = event.target;
  if (!(box instanceof HTMLInputElement) || box.type !== 'checkbox') return;
  const row = box.closest('.calc-row');
  if (!row) return;
  if (box.checked) calcState.selected.add(row.dataset.id);
  else calcState.selected.delete(row.dataset.id);
  updateCalcAllLabel();
  refreshCalcStats();
});

els.calcAll.addEventListener('click', () => {
  const all = calcState.rows.map((row) => row.id);
  const every = all.length > 0 && all.every((id) => calcState.selected.has(id));
  calcState.selected = new Set(every ? [] : all);
  renderCalcRows();
  updateCalcAllLabel();
  refreshCalcStats();
});

els.calcSymbolInput.addEventListener('change', () => {
  calcState.symbol = els.calcSymbolInput.value;
  // 记住默认记账银行，下次打开计算页还用这家
  window.gold.setCalcSymbol(calcState.symbol);
  refreshCalcStats();
});

els.calcAdd.addEventListener('click', async () => {
  showCalcError('');
  const result = await window.gold.calcAdd({
    side: calcState.side,
    date: els.calcDate.value,
    grams: Number(els.calcGramsInput.value),
    price: Number(els.calcPriceInput.value),
    symbol: els.calcSymbolInput.value,
    ids: calcSelectedIds(),
  });
  if (!result?.ok) {
    showCalcError(result?.error ?? '添加失败');
    return;
  }
  if (result.addedId) calcState.selected.add(result.addedId);
  applyCalcBase(result.base);
  refreshCalcStats();
  els.calcGramsInput.value = '';
  els.calcPriceInput.value = '';
  els.calcGramsInput.focus();
});

els.calcDel.addEventListener('click', async () => {
  showCalcError('');
  const ids = calcSelectedIds();
  if (!ids.length) {
    showCalcError('先勾选要删除的记录');
    return;
  }
  if (!window.confirm(`删除选中的 ${ids.length} 条记录？`)) return;
  const result = await window.gold.calcRemove({ ids, symbol: calcState.symbol });
  if (!result?.ok) {
    showCalcError(result?.error ?? '删除失败');
    return;
  }
  ids.forEach((id) => calcState.selected.delete(id));
  applyCalcBase(result.base);
  applyCalcStats(result.stats);
});

els.calcDate.value = localDateKey();

els.dispName.addEventListener('change', () =>
  window.gold.setDisplay({ name: els.dispName.checked }).then((saved) => fillDisplay(saved.display, saved.arrowMode)),
);

els.dispPct.addEventListener('change', () =>
  window.gold.setDisplay({ pct: els.dispPct.checked }).then((saved) => fillDisplay(saved.display, saved.arrowMode)),
);

// 涨跌两个勾选合成一个下拉框
els.dispArrow.addEventListener('change', () =>
  window.gold.setDisplay({ mode: els.dispArrow.value }).then((saved) => {
    fillDisplay(saved.display, saved.arrowMode);
    els.dispArrow.value = saved.arrowMode;
  }),
);

els.trendOn.addEventListener('change', () =>
  window.gold.setTrend({ enabled: els.trendOn.checked }).then(applyState),
);

els.trendRangeSelect.addEventListener('change', () =>
  window.gold.setTrend({ range: els.trendRangeSelect.value }).then(applyState),
);

function rowsInDom() {
  return [...els.body.querySelectorAll('tr[data-symbol]')];
}

/** 拖拽时把行插到指针所在的那一行前面（越过中线就换位置） */
function moveDragged(row, y) {
  const next = rowsInDom().find((other) => {
    if (other === row) return false;
    const box = other.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
  if (next) els.body.insertBefore(row, next);
  else els.body.appendChild(row);
}

function endHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  hold = null;
}

els.body.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const row = event.target.closest('tr[data-symbol]');
  if (!row) return;
  hoveredSymbol = null;
  hideQuoteTip();
  const current = {
    row,
    startX: event.clientX,
    startY: event.clientY,
    lastY: event.clientY,
    pointerId: event.pointerId,
    moved: false,
    dragging: false,
    timer: 0,
  };
  hold = current;
  current.timer = setTimeout(() => {
    if (hold !== current) return;
    current.dragging = true;
    row.classList.add('dragging');
    document.body.classList.add('dragging-row');
    // 长按期间用户可能已经在移动了，立刻按最新位置排一次，拖拽才跟手
    moveDragged(row, current.lastY);
    // 捕获指针，拖出窗口边界也能继续收到 move/up
    try {
      row.setPointerCapture(current.pointerId);
    } catch {
      /* 已经松手了，本轮拖拽作废 */
    }
  }, HOLD_MS);
});

els.body.addEventListener('pointermove', (event) => {
  if (!hold) return;
  hold.lastY = event.clientY;
  // 长按计时期间先移动不取消：到点就进入拖拽，否则"按住再拖"这种自然手势永远排不了序
  if (Math.abs(event.clientX - hold.startX) + Math.abs(event.clientY - hold.startY) > MOVE_SLOP) hold.moved = true;
  if (!hold.dragging) return;
  moveDragged(hold.row, event.clientY);
});

function commitDrag() {
  if (!hold) return;
  const { row, dragging, moved } = hold;
  endHold();
  if (!dragging) {
    // 没到长按时长就移动过：是想拖拽，不是想换主显品种
    if (moved) {
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 250);
    }
    return;
  }
  row.classList.remove('dragging');
  document.body.classList.remove('dragging-row');
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 250);
  window.gold.setOrder(rowsInDom().map((r) => r.dataset.symbol)).then(applyState);
}

els.body.addEventListener('pointerup', commitDrag);
els.body.addEventListener('pointercancel', endHold);

els.notifyTest.addEventListener('click', () => window.gold.notifyTest());
els.quit.addEventListener('click', () => window.gold.quit());

window.addEventListener('scroll', hideQuoteTip, true);
window.gold.onUpdate((next) => {
  applyState(next);
  if (!els.viewCalc.hidden) {
    if (!calcState.loaded || !calcState.symbols.length) loadCalc();
    else refreshCalcStats();
  }
});
// 悬浮球与任务栏文字都是 Windows 专属，macOS 用菜单栏本身就有的文字位
window.gold.getCapabilities().then(async (caps) => {
  if (caps.taskbar) {
    els.taskbarRow.hidden = false;
    els.taskbarTrendRow.hidden = false;
  }
  if (caps.loginItemPlatform) {
    els.loginRow.hidden = false;
    els.loginOn.disabled = !caps.loginItem;
    els.loginHint.textContent = caps.loginItemReason || '登录系统后自动运行 GoldSentry';
    els.loginHint.classList.toggle('warn', !!caps.loginItemReason);
  }
  if (!caps.ball) return;
  els.ballRow.hidden = false;
  els.ballScaleRow.hidden = false;
  els.ballHint.hidden = false;
  // 缩放区间来自 core，滑杆不自己写死
  const next = await window.gold.getState();
  if (next?.ballScale) {
    els.ballScale.min = String(Math.round(next.ballScale.min * 100));
    els.ballScale.max = String(Math.round(next.ballScale.max * 100));
  }
  if (next) applyState(next);
});
window.gold.getState().then(applyState);
