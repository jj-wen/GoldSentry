import {
  applySymbolOrder,
  arrowModeOf,
  ARROW_MODE_ORDER,
  BALL_BASE_SIZE,
  BALL_SCALE_MAX,
  BALL_SCALE_MIN,
  ballSizeFor,
  clampBallScale,
  clampIntoWorkArea,
  clampOpacity,
  DEFAULT_DISPLAY,
  detectTaskbar,
  displayFromArrowMode,
  formatPct,
  formatQuoteCells,
  normalizeDisplay,
  normalizeSymbolOrder,
  priceTone,
  scaledSquare,
  showArrow,
  spreadCell,
  formatPrice,
  OPACITY_MAX,
  OPACITY_MIN,
  placeOnTaskbar,
  TASKBAR_END_MARGIN,
} from '../packages/core/src/index.ts';

let failures = 0;
function check(label: string, condition: boolean, extra = ''): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!condition) failures++;
}

// --- 金额：所有端共用，必须固定两位 ---
check('整数补两位', formatPrice(868) === '868.00', formatPrice(868));
check('多余小数位四舍五入', formatPrice(868.456) === '868.46', formatPrice(868.456));
check('零点零元不省略', formatPrice(0) === '0.00', formatPrice(0));
check('undefined 显示 —，不编数字', formatPrice(undefined) === '—', formatPrice(undefined));
check('NaN 显示 —', formatPrice(Number.NaN) === '—', formatPrice(Number.NaN));
check('Infinity 显示 —', formatPrice(Number.POSITIVE_INFINITY) === '—');

// --- 涨跌幅 ---
check('正数带 +', formatPct(1.5) === '+1.50%', formatPct(1.5));
check('负数带 -', formatPct(-0.7) === '-0.70%', formatPct(-0.7));
check('零算平盘', formatPct(0) === '+0.00%', formatPct(0));
check('缺失显示 —', formatPct(undefined) === '—');

// --- 透明度：滑杆与滚轮都过这里 ---
check('下限夹住', clampOpacity(0.05) === OPACITY_MIN, String(clampOpacity(0.05)));
check('上限夹住', clampOpacity(1.4) === OPACITY_MAX, String(clampOpacity(1.4)));
check('NaN 退回默认而不是崩', clampOpacity(Number.NaN, 0.9) === 0.9, String(clampOpacity(Number.NaN, 0.9)));
check('字符串数字可用', clampOpacity('0.85') === 0.85, String(clampOpacity('0.85')));
check('滚轮累加后保留两位', clampOpacity(0.9 + 0.05 + 0.05) === 1, String(clampOpacity(0.9 + 0.05 + 0.05)));
check('滚轮下压 0.05 的浮点尾巴被抹平', clampOpacity(0.35 - 0.05) === 0.3, String(clampOpacity(0.35 - 0.05)));
check('正常区间原样通过', clampOpacity(0.72) === 0.72, String(clampOpacity(0.72)));

// --- 位置：换分辨率/拔屏后球不能丢 ---
const work = { x: 0, y: 0, width: 1920, height: 1040 };
const size = { width: 104, height: 104 };
check(
  '工作区内不动',
  JSON.stringify(clampIntoWorkArea({ x: 300, y: 200, ...size }, work)) === JSON.stringify({ x: 300, y: 200 }),
);
check(
  '越右边被拉回',
  clampIntoWorkArea({ x: 2400, y: 500, ...size }, work).x === work.width - size.width,
  JSON.stringify(clampIntoWorkArea({ x: 2400, y: 500, ...size }, work)),
);
check(
  '越下边被拉回',
  clampIntoWorkArea({ x: 500, y: 1500, ...size }, work).y === work.height - size.height,
);
check(
  '负坐标（原来在副屏左侧）拉回原点',
  JSON.stringify(clampIntoWorkArea({ x: -600, y: -200, ...size }, work)) === JSON.stringify({ x: 0, y: 0 }),
);
check(
  '副屏在工作区右侧之外时贴右边缘',
  clampIntoWorkArea({ x: 3200, y: 100, ...size }, work).x === 1920 - 104,
);
const tiny = { x: 0, y: 0, width: 80, height: 80 };
check(
  '球比工作区还大时贴左上，保证找得到',
  JSON.stringify(clampIntoWorkArea({ x: 500, y: 500, ...size }, tiny)) === JSON.stringify({ x: 0, y: 0 }),
);

// --- 任务栏几何：Electron 读不到系统任务栏，只能靠 bounds 与 workArea 的差 ---
const screenBounds = { x: 0, y: 0, width: 1920, height: 1080 };
const bottomBar = detectTaskbar(screenBounds, { x: 0, y: 0, width: 1920, height: 1032 });
check('底边任务栏能识别', bottomBar?.edge === 'bottom', JSON.stringify(bottomBar));
check(
  '底边任务栏矩形贴着屏幕底',
  JSON.stringify(bottomBar?.rect) === JSON.stringify({ x: 0, y: 1032, width: 1920, height: 48 }),
  JSON.stringify(bottomBar?.rect),
);
check('底边厚度 48', bottomBar?.thickness === 48, String(bottomBar?.thickness));
check(
  '顶边任务栏能识别',
  JSON.stringify(detectTaskbar(screenBounds, { x: 0, y: 48, width: 1920, height: 1032 })?.rect) ===
    JSON.stringify({ x: 0, y: 0, width: 1920, height: 48 }),
);
check(
  '左边任务栏能识别',
  detectTaskbar(screenBounds, { x: 48, y: 0, width: 1872, height: 1080 })?.edge === 'left',
);
check(
  '右边任务栏能识别',
  detectTaskbar(screenBounds, { x: 0, y: 0, width: 1872, height: 1080 })?.edge === 'right',
);
check('自动隐藏（workArea 等于 bounds）不当作任务栏', detectTaskbar(screenBounds, screenBounds) === null);
check(
  '自动隐藏残留 1px 也不算',
  detectTaskbar(screenBounds, { x: 0, y: 0, width: 1920, height: 1079 }) === null,
);
check(
  '自动隐藏残留 2px 也不算',
  detectTaskbar(screenBounds, { x: 0, y: 0, width: 1920, height: 1078 }) === null,
);

if (bottomBar) {
  const placed = placeOnTaskbar({ width: 120, height: 20 }, bottomBar, null);
  check(
    '默认落在托盘左侧并填满任务栏高度',
    JSON.stringify(placed) === JSON.stringify({ x: 1500, y: 1032, width: 120, height: 48 }),
    JSON.stringify(placed),
  );
  check(
    '默认位置离右端正好留出安全距离',
    placed.x + placed.width === 1920 - TASKBAR_END_MARGIN,
    `${placed.x} + ${placed.width}`,
  );
  check('记住的位置原样使用', placeOnTaskbar({ width: 120, height: 20 }, bottomBar, 800).x === 800);
  check(
    '拖过右端只到安全边距，不会压住时钟',
    placeOnTaskbar({ width: 120, height: 20 }, bottomBar, 5000).x === 1920 - TASKBAR_END_MARGIN - 120,
    String(placeOnTaskbar({ width: 120, height: 20 }, bottomBar, 5000).x),
  );
  check(
    '再往右也不会越过边距',
    placeOnTaskbar({ width: 99, height: 20 }, bottomBar, 1821).x === 1920 - TASKBAR_END_MARGIN - 99,
  );
  check('拖出左边界被拉回', placeOnTaskbar({ width: 120, height: 20 }, bottomBar, -50).x === 0);
}
const rightBar = detectTaskbar(screenBounds, { x: 0, y: 0, width: 1872, height: 1080 });
if (rightBar) {
  const placed = placeOnTaskbar({ width: 120, height: 20 }, rightBar, null);
  check(
    '竖排任务栏：窗口变窄变高并贴住右边缘',
    JSON.stringify(placed) === JSON.stringify({ x: 1872, y: 760, width: 48, height: 20 }),
    JSON.stringify(placed),
  );
  check('竖排记住的位置沿 y 生效', placeOnTaskbar({ width: 120, height: 20 }, rightBar, 100).y === 100);
  check(
    '竖排拖过下端同样留出安全边距',
    placeOnTaskbar({ width: 120, height: 20 }, rightBar, 5000).y === 1080 - TASKBAR_END_MARGIN - 20,
  );
}
const negBounds = { x: -1920, y: 0, width: 1920, height: 1080 };
const negBar = detectTaskbar(negBounds, { x: -1920, y: 0, width: 1920, height: 1040 });
check(
  '副屏在左侧（负坐标）也能算对',
  negBar?.rect.y === 1040 && placeOnTaskbar({ width: 120, height: 20 }, negBar, null).x === -420,
  JSON.stringify(negBar && placeOnTaskbar({ width: 120, height: 20 }, negBar, null)),
);

// --- 显示内容开关：颜色看真实涨跌，箭头才看开关 ---
const ALL_ON = { name: true, up: true, down: true };
check('涨时红色', priceTone(1.5) === 'up');
check('跌时绿色', priceTone(-1.5) === 'down');
check('持平是白色（flat）', priceTone(0) === 'flat');
check('缺涨跌幅也是白色，不猜方向', priceTone(undefined) === 'flat' && priceTone(Number.NaN) === 'flat');
check('关掉上涨，跌幅颜色不变、箭头隐藏', priceTone(-0.4) === 'down' && !showArrow(-0.4, { name: true, up: true, down: false }));
check('关掉下跌，涨幅颜色不变、箭头隐藏', priceTone(0.4) === 'up' && !showArrow(0.4, { name: true, up: false, down: true }));
check('开关全开时箭头出现', showArrow(0.4, ALL_ON) && showArrow(-0.4, ALL_ON));
check('持平不配箭头', !showArrow(0, ALL_ON) && !showArrow(undefined, ALL_ON));
check('脏配置退回默认（全显示）', JSON.stringify(normalizeDisplay(undefined)) === JSON.stringify(DEFAULT_DISPLAY));
check('非布尔值被丢弃', JSON.stringify(normalizeDisplay({ name: 'no', up: 1 })) === JSON.stringify(DEFAULT_DISPLAY));
check('合法开关原样保留', JSON.stringify(normalizeDisplay({ name: false, up: false, down: true })) === JSON.stringify({ name: false, up: false, down: true }));

// --- 面板单元格：金额与方向都由 core 出，外壳不许自己 toFixed ---
const cells = formatQuoteCells({ buyPrice: 873.1, sellPrice: 872.6, dayChangePct: -0.31 });
check('面板买入卖出固定两位', cells.buy === '873.10' && cells.sell === '872.60', `${cells.buy} / ${cells.sell}`);
check('面板涨跌幅带符号', cells.pct === '-0.31%' && cells.tone === 'down', `${cells.pct} ${cells.tone}`);
check('平盘标成 flat（不上色）', formatQuoteCells({ buyPrice: 1, sellPrice: 1, dayChangePct: 0 }).tone === 'flat');
check('缺涨跌幅显示 — 且 tone 为 flat（白色）', (() => {
  const missing = formatQuoteCells({ buyPrice: 1, sellPrice: 1 });
  return missing.pct === '—' && missing.tone === 'flat';
})());
check('价缺失也走 —，不出现 NaN', (() => {
  const broken = formatQuoteCells({});
  return broken.buy === '—' && broken.sell === '—';
})());

// --- 点差列：优先点差，点差为 0 才退回服务费 ---
const withSpread = spreadCell(3.5, 'GF');
check('有点差显示点差', withSpread.text === '3.50' && withSpread.basis === 'spread', JSON.stringify(withSpread));
check('点差说明写清是买入减卖出', withSpread.note.includes('买入减卖出'), withSpread.note);
const feeOnly = spreadCell(0, 'ZS');
check('点差为 0 退回服务费', feeOnly.text === '0%/0.4%' && feeOnly.basis === 'fee', JSON.stringify(feeOnly));
check('服务费说明带核实日期', feeOnly.note.includes('截至 2026-11-05'), feeOnly.note);
const unknown = spreadCell(0, 'MS');
check('两边都给不出数字时显示 —', unknown.text === '—' && unknown.basis === 'fee', JSON.stringify(unknown));
check('未知时 tooltip 仍解释原因', unknown.note.includes('以银行 App 为准'), unknown.note);
check('点差缺失也退回服务费', spreadCell(undefined, 'ZS').text === '0%/0.4%');
check('点差为负（脏数据）不显示成点差', spreadCell(-1, 'ZS').basis === 'fee');

// --- 品种顺序：面板拖出来的顺序 ---
check('脏顺序被清理', JSON.stringify(normalizeSymbolOrder(['ZS', 'ZS', 1, '', 'GS'])) === JSON.stringify(['ZS', 'GS']));
check('非数组退回空', JSON.stringify(normalizeSymbolOrder(undefined)) === JSON.stringify([]) && normalizeSymbolOrder('ZS').length === 0);
const rows = [{ symbol: 'ZS' }, { symbol: 'GS' }, { symbol: 'MS' }];
check(
  '按用户顺序重排',
  JSON.stringify(applySymbolOrder(rows, ['GS', 'ZS']).map((r) => r.symbol)) === JSON.stringify(['GS', 'ZS', 'MS']),
);
check('空顺序保持原样', JSON.stringify(applySymbolOrder(rows, []).map((r) => r.symbol)) === JSON.stringify(['ZS', 'GS', 'MS']));
check(
  '新品种不会因为没排过而消失',
  JSON.stringify(applySymbolOrder(rows, ['ZZ', 'MS']).map((r) => r.symbol)) === JSON.stringify(['MS', 'ZS', 'GS']),
);
check('返回的是新数组，不改原列表', (() => {
  const source = [{ symbol: 'ZS' }];
  const moved = applySymbolOrder(source, ['ZS']);
  return moved !== source && moved[0] === source[0];
})());

// --- 涨跌箭头：一个下拉框对应两个布尔，老配置不迁移 ---
const AS = (up: boolean, down: boolean) => ({ name: true, up, down });
check('两个都开 = 涨跌都显示', arrowModeOf(AS(true, true)) === 'both');
check('只开上涨 = 只显示上涨', arrowModeOf(AS(true, false)) === 'up');
check('只开下跌 = 只显示下跌', arrowModeOf(AS(false, true)) === 'down');
check('两个都关 = 不显示箭头', arrowModeOf(AS(false, false)) === 'none');
check(
  '四种模式来回切换都能还原',
  ARROW_MODE_ORDER.every((mode) => arrowModeOf(displayFromArrowMode(AS(true, true), mode)) === mode),
);
check(
  '切换箭头模式不动品种名开关',
  JSON.stringify(displayFromArrowMode({ name: false, up: true, down: true }, 'none')) ===
    JSON.stringify({ name: false, up: false, down: false }),
);
check('箭头模式与颜色互不影响', priceTone(-1) === 'down' && !showArrow(-1, AS(true, false)));

// --- 悬浮球等比例缩放 ---
check('缩放下限夹住', clampBallScale(0.1) === BALL_SCALE_MIN, String(clampBallScale(0.1)));
check('缩放上限夹住', clampBallScale(9) === BALL_SCALE_MAX, String(clampBallScale(9)));
check('脏缩放退回默认', clampBallScale(undefined, 1) === 1 && clampBallScale('abc', 1) === 1);
check('字符串缩放可用', clampBallScale('1.25') === 1.25, String(clampBallScale('1.25')));
check('缩放保留两位不出现浮点尾巴', clampBallScale(0.7 + 0.05 + 0.05) === 0.8, String(clampBallScale(0.7 + 0.05 + 0.05)));
check('100% 就是基准边长', ballSizeFor(1) === BALL_BASE_SIZE, String(ballSizeFor(1)));
check('150% 等比放大', ballSizeFor(1.5) === 156, String(ballSizeFor(1.5)));
check('超出区间按夹住后的缩放算尺寸', ballSizeFor(3) === Math.round(BALL_BASE_SIZE * BALL_SCALE_MAX), String(ballSizeFor(3)));
check(
  '缩放围绕球心，不会往右下挪',
  JSON.stringify(scaledSquare({ x: 100, y: 100, width: 104, height: 104 }, 156)) ===
    JSON.stringify({ x: 74, y: 74, size: 156 }),
  JSON.stringify(scaledSquare({ x: 100, y: 100, width: 104, height: 104 }, 156)),
);
const shrunk = scaledSquare({ x: 0, y: 0, width: 104, height: 104 }, 62);
check(
  '缩小后仍夹得回工作区',
  clampIntoWorkArea({ x: shrunk.x, y: shrunk.y, width: shrunk.size, height: shrunk.size }, { x: 0, y: 0, width: 30, height: 30 }).x === 0,
  JSON.stringify(shrunk),
);

console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
// 这里没有常驻定时器，让事件循环自然排空即可；不要 process.exit()（Windows + Node 24 会撞 libuv 断言）
process.exitCode = failures ? 1 : 0;
