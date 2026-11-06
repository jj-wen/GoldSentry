const labelOf = (symbol) => state?.quotes.find((q) => q.symbol === symbol)?.label ?? symbol;

const KIND = (rule) =>
  rule.above !== undefined ? '涨到 ≥' : rule.below !== undefined ? '跌到 ≤' : '当日 ±%';

function ageText(quotedAt, basis) {
  if (!Number.isFinite(quotedAt)) return '未知';
  const minutes = Math.max(0, Math.round((Date.now() - quotedAt) / 60000));
  if (basis === 'dailyFix') return minutes >= 60 ? `${Math.round(minutes / 60)} 小时前` : '今日已定价';
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.round(minutes / 60)} 小时前`;
}

const els = {
  stamp: document.getElementById('stamp'),
  health: document.getElementById('health'),
  errors: document.getElementById('errors'),
  body: document.querySelector('#quotes tbody'),
  ruleRows: document.getElementById('rule-rows'),
  save: document.getElementById('save'),
  refresh: document.getElementById('refresh'),
  interval: document.getElementById('interval'),
  barkOn: document.getElementById('bark-on'),
  barkServer: document.getElementById('bark-server'),
  barkKey: document.getElementById('bark-key'),
  barkSave: document.getElementById('bark-save'),
  barkTest: document.getElementById('bark-test'),
  barkResult: document.getElementById('bark-result'),
  ballRow: document.getElementById('ball-row'),
  ballHint: document.getElementById('ball-hint'),
  ballOn: document.getElementById('ball-on'),
  ballOpacity: document.getElementById('ball-opacity'),
  ballVal: document.getElementById('ball-opacity-val'),
  taskbarRow: document.getElementById('taskbar-row'),
  taskbarOn: document.getElementById('taskbar-on'),
  tabDetail: document.getElementById('tab-detail'),
  tabSettings: document.getElementById('tab-settings'),
  viewDetail: document.getElementById('view-detail'),
  viewSettings: document.getElementById('view-settings'),
  dispName: document.getElementById('disp-name'),
  dispUp: document.getElementById('disp-up'),
  dispDown: document.getElementById('disp-down'),
  notifyTest: document.getElementById('notify-test'),
  quit: document.getElementById('quit'),
};

let rulesRendered = false;

function renderQuotes(next) {
  els.body.innerHTML = '';
  for (const quote of next.quotes) {
    const row = document.createElement('tr');
    const stale = quote.basis === 'realtime' && Date.now() - quote.quotedAt > 30 * 60000;
    const primary = quote.symbol === next.primarySymbol;
    const pct = quote.dayChangePct;
    const known = pct !== undefined && Number.isFinite(pct);
    // 红涨绿跌，按 A 股习惯来，不用国外的反色
    const pctClass = !known || pct === 0 ? '' : pct > 0 ? 'up' : 'down';
    const fee = fees[quote.symbol];
    row.dataset.symbol = quote.symbol;
    if (primary) row.classList.add('primary');
    row.innerHTML = `<td class="name" title="${quote.name}">${primary ? '● ' : ''}${quote.label}</td>
      <td class="buy">${quote.buyPrice.toFixed(2)}</td>
      <td>${quote.sellPrice.toFixed(2)}</td>
      <td>${quote.spread.toFixed(2)}</td>
      <td class="${pctClass}">${known ? `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'}</td>
      <td class="fee" title="${fee ? `${fee.note}（截至 ${fee.asOf}）` : '费率未知'}">${fee ? fee.text : '—'}</td>
      <td class="${stale ? 'stale' : ''}">${ageText(quote.quotedAt, quote.basis)}</td>`;
    row.addEventListener('click', () => window.gold.setPrimary(quote.symbol).then(applyState));
    els.body.appendChild(row);
  }
}

function renderRules(rules) {
  if (rulesRendered) return;
  rulesRendered = true;
  els.ruleRows.innerHTML = '';
  for (const rule of rules) {
    const field = rule.above !== undefined ? 'above' : rule.below !== undefined ? 'below' : 'absDayChangePct';
    const value = rule[field] ?? '';
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.dataset.ruleId = rule.id;
    row.innerHTML = `<input type="checkbox" class="on" ${rule.enabled ? 'checked' : ''} />
      <span class="sym">${labelOf(rule.symbol)}</span>
      <span class="kind">${KIND(rule)}</span>
      <input type="number" class="val" step="0.01" value="${value}" placeholder="${field === 'absDayChangePct' ? '%' : '元/克'}" />`;
    els.ruleRows.appendChild(row);
  }
}

function collectRules() {
  const base = state?.rules ?? [];
  return base.map((rule) => {
    const row = els.ruleRows.querySelector(`[data-rule-id="${CSS.escape(rule.id)}"]`);
    if (!row) return rule;
    const field = rule.above !== undefined ? 'above' : rule.below !== undefined ? 'below' : 'absDayChangePct';
    const raw = row.querySelector('.val').value.trim();
    const next = { ...rule, enabled: row.querySelector('.on').checked };
    delete next[field];
    if (raw !== '') next[field] = Number(raw);
    return next;
  });
}

let state = null;
let fees = {};

function fillBark(bark) {
  if (!bark) return;
  // 正在输入时不覆盖，避免轮询刷新打断编辑
  if (document.activeElement === els.barkServer || document.activeElement === els.barkKey) return;
  els.barkOn.checked = !!bark.enabled;
  els.barkServer.value = bark.server ?? '';
  els.barkKey.value = bark.deviceKey ?? '';
}

const HEALTH_TEXT = { ok: '正常', degraded: '部分异常', offline: '全部失效' };

function fillBall(ball) {
  if (!ball) return;
  // 球上滚轮也会改透明度，正在拖滑杆时不覆盖，避免来回打架
  if (document.activeElement === els.ballOpacity) return;
  els.ballOn.checked = !!ball.enabled;
  const percent = Math.round(ball.opacity * 100);
  els.ballOpacity.value = String(percent);
  els.ballVal.textContent = `${percent}%`;
}

function fillTaskbar(taskbar) {
  if (!taskbar) return;
  els.taskbarOn.checked = !!taskbar.enabled;
}

function fillDisplay(display) {
  if (!display) return;
  els.dispName.checked = !!display.name;
  els.dispUp.checked = !!display.up;
  els.dispDown.checked = !!display.down;
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
    els.health.textContent = HEALTH_TEXT[next.health?.status ?? 'ok'] ?? '';
    els.health.dataset.status = next.health?.status ?? 'ok';
  }
  renderQuotes(next);
  renderRules(next.rules);
  fillBark(next.bark);
  fillBall(next.ball);
  fillTaskbar(next.taskbar);
  fillDisplay(next.display);
  if (document.activeElement !== els.interval) els.interval.value = String(next.pollSeconds ?? 30);
}

els.interval.addEventListener('change', async () => {
  const result = await window.gold.setPollSeconds(Number(els.interval.value));
  if (!result.ok) els.interval.value = String(state?.pollSeconds ?? 30);
});

els.ballOn.addEventListener('change', async () => {
  const saved = await window.gold.setBall({ enabled: els.ballOn.checked });
  els.ballVal.textContent = `${Math.round(saved.opacity * 100)}%`;
});

els.taskbarOn.addEventListener('change', () => window.gold.setTaskbar({ enabled: els.taskbarOn.checked }));

// 透明度要即时反馈，用 input 而不是 change
els.ballOpacity.addEventListener('input', async () => {
  const percent = Number(els.ballOpacity.value);
  els.ballVal.textContent = `${percent}%`;
  await window.gold.setBall({ opacity: percent / 100 });
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

els.refresh.addEventListener('click', () => window.gold.refresh().then(applyState));
els.save.addEventListener('click', () => window.gold.saveRules(collectRules()).then((rules) => {
  els.save.textContent = '已保存';
  setTimeout(() => (els.save.textContent = '保存'), 1200);
  if (state) applyState({ ...state, rules });
}));

function selectTab(mode) {
  const showSettings = mode === 'settings';
  els.viewDetail.hidden = showSettings;
  els.viewSettings.hidden = !showSettings;
  els.tabDetail.classList.toggle('active', !showSettings);
  els.tabSettings.classList.toggle('active', showSettings);
}

els.tabDetail.addEventListener('click', () => selectTab('detail'));
els.tabSettings.addEventListener('click', () => selectTab('settings'));
window.gold.onMode(selectTab);

for (const [el, key] of [
  [els.dispName, 'name'],
  [els.dispUp, 'up'],
  [els.dispDown, 'down'],
]) {
  el.addEventListener('change', () => window.gold.setDisplay({ [key]: el.checked }).then(fillDisplay));
}

els.notifyTest.addEventListener('click', () => window.gold.notifyTest());
els.quit.addEventListener('click', () => window.gold.quit());

window.gold.onUpdate(applyState);
// 悬浮球与任务栏文字都是 Windows 专属，macOS 用菜单栏本身就有的文字位
window.gold.getCapabilities().then((caps) => {
  if (caps.taskbar) els.taskbarRow.hidden = false;
  if (!caps.ball) return;
  els.ballRow.hidden = false;
  els.ballHint.hidden = false;
});
window.gold.getFees().then((loaded) => {
  fees = loaded;
  if (state) renderQuotes(state);
});
window.gold.getState().then(applyState);
