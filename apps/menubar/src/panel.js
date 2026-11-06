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
  ballScaleRow: document.getElementById('ball-scale-row'),
  ballHint: document.getElementById('ball-hint'),
  ballOn: document.getElementById('ball-on'),
  ballOpacity: document.getElementById('ball-opacity'),
  ballVal: document.getElementById('ball-opacity-val'),
  ballScale: document.getElementById('ball-scale'),
  ballScaleVal: document.getElementById('ball-scale-val'),
  taskbarRow: document.getElementById('taskbar-row'),
  taskbarOn: document.getElementById('taskbar-on'),
  tabDetail: document.getElementById('tab-detail'),
  tabSettings: document.getElementById('tab-settings'),
  viewDetail: document.getElementById('view-detail'),
  viewSettings: document.getElementById('view-settings'),
  dispName: document.getElementById('disp-name'),
  dispArrow: document.getElementById('disp-arrow'),
  notifyTest: document.getElementById('notify-test'),
  quit: document.getElementById('quit'),
};

const TONE_CLASS = { up: 'up', down: 'down', flat: '' };

/** 标题属性来自银行接口与 core 常量，拼进 HTML 前一律转义 */
function escAttr(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function renderQuotes(next) {
  els.body.innerHTML = '';
  const cells = next.cells ?? {};
  const spreadCells = next.spreadCells ?? {};
  for (const quote of next.quotes) {
    const row = document.createElement('tr');
    const stale = quote.basis === 'realtime' && Date.now() - quote.quotedAt > 30 * 60000;
    const primary = quote.symbol === next.primarySymbol;
    // 买/卖/涨跌与点差列的文本都由 core 生成，这里只负责贴
    const cell = cells[quote.symbol] ?? { buy: '—', sell: '—', pct: '—', tone: 'flat' };
    const spread = spreadCells[quote.symbol] ?? { text: '—', basis: 'fee', note: '点差与费率均未知' };
    row.dataset.symbol = quote.symbol;
    if (primary) row.classList.add('primary');
    row.innerHTML = `<td class="name" title="${escAttr(quote.name)}">${primary ? '● ' : ''}${escAttr(quote.label)}</td>
      <td class="buy">${cell.buy}</td>
      <td>${cell.sell}</td>
      <td class="spread" title="${escAttr(spread.note)}">${spread.text}</td>
      <td class="${TONE_CLASS[cell.tone] ?? ''}">${cell.pct}</td>
      <td class="${stale ? 'stale' : ''}">${ageText(quote.quotedAt, quote.basis)}</td>`;
    row.addEventListener('click', () => {
      // 拖拽结束也会补一次 click，手势不能同时改主显品种
      if (suppressClick) return;
      window.gold.setPrimary(quote.symbol).then(applyState);
    });
    els.body.appendChild(row);
  }
}

function symbolOptions(extra) {
  const list = (state?.quotes ?? []).map((q) => ({ value: q.symbol, text: q.label }));
  // 规则里可能有已经下线的品种，留着选项才不会把这条悄悄改掉
  if (extra && !list.some((o) => o.value === extra)) list.push({ value: extra, text: extra });
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
  const unitOf = (value) => kinds.find((k) => k.kind === value)?.unit ?? '元/克';
  const el = document.createElement('div');
  el.className = pending ? 'rule-row pending' : 'rule-row';
  el.innerHTML = `${pending ? '' : `<input type="checkbox" class="on" ${row.enabled ? 'checked' : ''} />`}
    <select class="sym">${pending ? '<option value="" selected>选择品种…</option>' : ''}${optionTags(symbolOptions(pending ? '' : row.symbol), pending ? '' : row.symbol)}</select>
    <select class="kind">${optionTags(kinds.map((k) => ({ value: k.kind, text: k.text })), kind)}</select>
    <input type="number" class="val" step="0.01" value="${pending ? '' : (row.value ?? '')}" placeholder="${escAttr(unitOf(kind))}" />
    ${pending ? '' : '<button class="del" type="button" title="删除这条提醒">×</button>'}`;
  el.querySelector('.kind').addEventListener('change', (event) => {
    event.currentTarget.closest('.rule-row').querySelector('.val').placeholder = unitOf(event.currentTarget.value);
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
  return [...els.ruleRows.querySelectorAll('.rule-row')].map((row) => ({
    symbol: row.querySelector('.sym').value,
    kind: row.querySelector('.kind').value,
    value: row.querySelector('.val').value.trim(),
    // 末尾的新增行没有勾选，默认就是启用
    enabled: row.querySelector('.on')?.checked ?? true,
  }));
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
}

function fillDisplay(display, arrowMode) {
  if (!display) return;
  els.dispName.checked = !!display.name;
  const modes = state?.arrowModes ?? [];
  if (modes.length && els.dispArrow.options.length !== modes.length) {
    els.dispArrow.innerHTML = optionTags(modes.map((m) => ({ value: m.mode, text: m.text })), arrowMode);
  }
  if (arrowMode) els.dispArrow.value = arrowMode;
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
  // 拖拽进行中不能重建表格，否则正在拖的那一行会被换掉
  if (!hold?.dragging) renderQuotes(next);
  renderRules(next);
  fillBark(next.bark);
  fillBall(next.ball);
  fillTaskbar(next.taskbar);
  fillDisplay(next.display, next.arrowMode);
  if (document.activeElement !== els.interval) els.interval.value = String(next.pollSeconds ?? 30);
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

els.taskbarOn.addEventListener('change', () => window.gold.setTaskbar({ enabled: els.taskbarOn.checked }));

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

els.refresh.addEventListener('click', () => window.gold.refresh().then(applyState));
els.save.addEventListener('click', () => {
  window.gold.saveRules(collectRules()).then(applyState);
  els.save.textContent = '已保存';
  setTimeout(() => (els.save.textContent = '保存'), 1200);
});

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

els.dispName.addEventListener('change', () =>
  window.gold.setDisplay({ name: els.dispName.checked }).then((saved) => fillDisplay(saved.display, saved.arrowMode)),
);

// 涨跌两个勾选合成一个下拉框
els.dispArrow.addEventListener('change', () =>
  window.gold.setDisplay({ mode: els.dispArrow.value }).then((saved) => {
    fillDisplay(saved.display, saved.arrowMode);
    els.dispArrow.value = saved.arrowMode;
  }),
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

window.gold.onUpdate(applyState);
// 悬浮球与任务栏文字都是 Windows 专属，macOS 用菜单栏本身就有的文字位
window.gold.getCapabilities().then(async (caps) => {
  if (caps.taskbar) els.taskbarRow.hidden = false;
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
