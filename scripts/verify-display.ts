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
  coversTaskbar,
  DEFAULT_DISPLAY,
  detectTaskbar,
  displayFromArrowMode,
  FEE_STALE_DAYS,
  feeAgeDays,
  feeCell,
  formatPct,
  formatQuoteCells,
  marketSessionAt,
  bankSessionAt,
  tradingHoursOf,
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
  beijingDateKey,
  beijingDayStart,
  dayTrendSeries,
  normalizeTrendSettings,
  TREND_GAP_MS,
  TREND_RANGE_ORDER,
  trendSparkline,
  updateAgeText,
  parseBatchPrice,
  parseLondonGold,
  londonGoldView,
  convertLondonGold,
  londonPremium,
} from '../packages/core/src/index.ts';
import { renderDashboardHtml } from '../apps/menubar/src/dashboard.ts';

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
const ALL_ON = { name: true, up: true, down: true, pct: true };
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
check('合法开关原样保留', JSON.stringify(normalizeDisplay({ name: false, up: false, down: true, pct: true })) === JSON.stringify({ name: false, up: false, down: true, pct: true }));
check('涨跌百分比默认关闭', DEFAULT_DISPLAY.pct === false && normalizeDisplay({}).pct === false);
check('涨跌百分比只认布尔', normalizeDisplay({ pct: 'yes' }).pct === false && normalizeDisplay({ pct: true }).pct === true);

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
const unknown = spreadCell(0, 'GF');
check('两边都给不出数字时显示 —', unknown.text === '—' && unknown.basis === 'fee', JSON.stringify(unknown));
check('未知时 tooltip 仍解释原因', unknown.note.includes('以银行 App 为准'), unknown.note);
const spreadFee = spreadCell(0, 'MS');
check(
  '点差为 0 时用人工核实的元/克点差兜底',
  spreadFee.text === '3.80元' && spreadFee.basis === 'fee',
  JSON.stringify(spreadFee),
);
check('人工点差说明写清来源', spreadFee.note.includes('用户核实'), spreadFee.note);
check('中信人工点差为 2.7 元/克', spreadCell(0, 'ZX').text === '2.70元', spreadCell(0, 'ZX').text);
check('工商按对比表显示买卖费率', spreadCell(0, 'GS').text === '0.2%/0.5%', spreadCell(0, 'GS').text);
check('点差缺失也退回服务费', spreadCell(undefined, 'ZS').text === '0%/0.4%');
check('点差为负（脏数据）不显示成点差', spreadCell(-1, 'ZS').basis === 'fee');

// --- 费率过期：人工核实值放久了要提示重新核对 ---
const AS_OF = Date.parse('2026-11-05');
const DAY = 86_400_000;
const beforeDeadline = AS_OF + (FEE_STALE_DAYS - 1) * DAY;
const atDeadline = AS_OF + FEE_STALE_DAYS * DAY;
const overdue = AS_OF + (FEE_STALE_DAYS + 1) * DAY;
check('核实天数按自然日算', feeAgeDays('2026-11-05', AS_OF + 3 * DAY) === 3);
check('脏日期不编天数', feeAgeDays('不是日期', AS_OF) === undefined);
check('未来日期不倒着算', feeAgeDays('2026-11-05', AS_OF - DAY) === 0);
check('阈值内不标过期', feeCell('ZS', beforeDeadline).stale === false && feeCell('ZS', beforeDeadline).text === '0%/0.4%');
check('恰好到阈值当天还不算过期', feeCell('ZS', atDeadline).stale === false);
check('超过阈值标过期并带 ⚠', feeCell('ZS', overdue).stale === true && feeCell('ZS', overdue).text === '0%/0.4% ⚠');
check('过期说明写清天数与去处', feeCell('ZS', overdue).note.includes(`${FEE_STALE_DAYS + 1} 天`) && feeCell('ZS', overdue).note.includes('银行 App'));
check('本来就查不到数字的不标黄（避免噪音）', feeCell('GF', overdue).stale === false && feeCell('GF', overdue).text === '—');
check('未收录的品种不标黄', feeCell('NOPE', overdue).stale === false);
check('点差口径不受费率过期影响', spreadCell(3.5, 'ZS', overdue).stale === false && spreadCell(3.5, 'ZS', overdue).basis === 'spread');
check('退回费率口径时把过期透传给面板', spreadCell(0, 'ZS', overdue).stale === true);
check('当前收录的费率都还在有效期内', spreadCell(0, 'ZS').stale === false && spreadCell(0, 'NJ').stale === false);

// --- 品种顺序：面板拖出来的顺序 ---
check('脏顺序被清理', JSON.stringify(normalizeSymbolOrder(['ZS', 'ZS', 1, '', 'GS'])) === JSON.stringify(['ZS', 'GS']));
check('非数组退回空', JSON.stringify(normalizeSymbolOrder(undefined)) === JSON.stringify([]) && normalizeSymbolOrder('ZS').length === 0);
const rows = [{ symbol: 'ZS' }, { symbol: 'GS' }, { symbol: 'MS' }];
check(
  '按用户顺序重排',
  JSON.stringify(applySymbolOrder(rows, ['GS', 'ZS']).map((r) => r.symbol)) === JSON.stringify(['GS', 'ZS', 'MS']),
);
const shuffledBatch = parseBatchPrice({
  resultData: {
    code: '00000000',
    data: [
      { productSku: '2045976593', buyPrice: '1', sellPrice: '1', time: '1' },
      { productSku: '21001001000001', buyPrice: '1', sellPrice: '1', time: '1' },
      { productSku: '1961543816', buyPrice: '1', sellPrice: '1', time: '1' },
    ],
  },
});
check(
  '京东返回乱序时按声明顺序输出，民生第二',
  JSON.stringify(shuffledBatch.map((q) => q.symbol)) === JSON.stringify(['ZS', 'MS', 'ZX']),
  JSON.stringify(shuffledBatch.map((q) => q.symbol)),
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
const AS = (up: boolean, down: boolean) => ({ name: true, up, down, pct: false });
check('两个都开 = 涨跌都显示', arrowModeOf(AS(true, true)) === 'both');
check('只开上涨 = 只显示上涨', arrowModeOf(AS(true, false)) === 'up');
check('只开下跌 = 只显示下跌', arrowModeOf(AS(false, true)) === 'down');
check('两个都关 = 不显示箭头', arrowModeOf(AS(false, false)) === 'none');
check(
  '四种模式来回切换都能还原',
  ARROW_MODE_ORDER.every((mode) => arrowModeOf(displayFromArrowMode(AS(true, true), mode)) === mode),
);
check(
  '切换箭头模式不动品种名与百分比开关',
  JSON.stringify(displayFromArrowMode({ name: false, up: true, down: true, pct: true }, 'none')) ===
    JSON.stringify({ name: false, up: false, down: false, pct: true }),
);
check('箭头模式与颜色互不影响', priceTone(-1) === 'down' && !showArrow(-1, AS(true, false)));

// --- 悬浮球等比例缩放 ---
check('缩放下限夹住', clampBallScale(0.1) === BALL_SCALE_MIN, String(clampBallScale(0.1)));
check('悬浮球最小可缩到 40%', clampBallScale(0.4) === 0.4 && BALL_SCALE_MIN === 0.4, String(clampBallScale(0.4)));
check('40% 时边长按比例缩到 42px', ballSizeFor(0.4) === 42, String(ballSizeFor(0.4)));
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

// --- 交易时段：连续盘 09:00 → 次日 02:30，周末/节假日休市 ---
const at = (iso: string) => Date.parse(iso);
const session = (iso: string) => marketSessionAt(at(iso));
check('周日中午休市', session('2026-11-08T04:00:00Z').open === false, session('2026-11-08T04:00:00Z').reason);
check('周日休市原因写周末', session('2026-11-08T04:00:00Z').reason === '周末休市');
check('周六凌晨 01:00 仍属周五夜盘，开市', session('2026-11-06T17:00:00Z').open === true, session('2026-11-06T17:00:00Z').reason);
check('周六 03:00 已收盘', session('2026-11-06T19:00:00Z').open === false && session('2026-11-06T19:00:00Z').reason === '周末休市');
check('周一 08:00 开市前', session('2026-11-09T00:00:00Z').open === false && session('2026-11-09T00:00:00Z').reason.includes('09:00'));
check('周一 09:00 准时开市', session('2026-11-09T01:00:00Z').open === true);
check('周五 22:00 夜盘仍在', session('2026-11-06T14:00:00Z').open === true);
check('工作日 15:40 日盘后仍有夜盘', session('2026-11-06T07:40:00Z').open === true);
check('周五 02:29 属周四夜盘', session('2026-11-05T18:29:00Z').open === true);
check('周五 02:30 夜里收盘', session('2026-11-05T18:30:00Z').open === false && session('2026-11-05T18:30:00Z').reason.includes('09:00'));
check('国庆上午休市', session('2026-10-01T02:00:00Z').open === false && session('2026-10-01T02:00:00Z').reason === '国庆休市');
check('节前最后交易日白天开市', session('2026-09-30T02:00:00Z').open === true);
check('节前最后交易日晚上停夜盘', session('2026-09-30T13:00:00Z').open === false && session('2026-09-30T13:00:00Z').reason === '节前夜盘暂停');
check('节日凌晨没有前一晚夜盘', session('2026-09-30T17:00:00Z').open === false && session('2026-09-30T17:00:00Z').reason === '节前夜盘暂停');
check('节日最后一天凌晨仍休市', session('2026-10-07T17:00:00Z').open === false && session('2026-10-07T17:00:00Z').reason === '国庆休市');
check('节后首日 09:00 恢复', session('2026-10-08T01:00:00Z').open === true);
check('调休补班的周六照样休市', session('2026-10-10T02:00:00Z').open === false && session('2026-10-10T02:00:00Z').reason === '周末休市');

// --- 单家银行收盘点：工商 22:30，浙商 02:30，其余 02:00 ---
const bankAt = (symbol: string, iso: string) => bankSessionAt(symbol, at(iso));
check('工商交易时段文案', tradingHoursOf('GS')?.text === '周一 09:10–周五 22:30', tradingHoursOf('GS')?.text);
check('浙商交易时段文案', tradingHoursOf('ZS')?.text === '周一 09:00–周六 02:30', tradingHoursOf('ZS')?.text);
check('广发交易时段文案', tradingHoursOf('GF')?.text === '周一 09:00–周六 02:00', tradingHoursOf('GF')?.text);
check('周五 10:30 各行都开市', bankAt('GS', '2026-11-06T02:30:00Z').open && bankAt('MS', '2026-11-06T02:30:00Z').open);
check('工商 09:05 还没开市', bankAt('GS', '2026-11-06T01:05:00Z').open === false && bankAt('GS', '2026-11-06T01:05:00Z').text === '未开盘');
check('民生 09:05 还没开市', bankAt('MS', '2026-11-06T01:05:00Z').open === false);
check('浙商 09:05 已开市', bankAt('ZS', '2026-11-06T01:05:00Z').open === true);
check('工商 22:31 已收盘', bankAt('GS', '2026-11-06T14:31:00Z').open === false && bankAt('GS', '2026-11-06T14:31:00Z').text === '已收盘');
check('同一时刻浙商仍在交易', bankAt('ZS', '2026-11-06T14:31:00Z').open === true);
check('广发午后不中断', bankAt('GF', '2026-11-06T08:00:00Z').open === true);
check('民生凌晨 01:30 仍在交易', bankAt('MS', '2026-11-06T17:30:00Z').open === true);
check('民生凌晨 02:15 已收盘', bankAt('MS', '2026-11-06T18:15:00Z').open === false);
check('浙商凌晨 02:15 仍在交易', bankAt('ZS', '2026-11-06T18:15:00Z').open === true);
check('周末所有银行休市', bankAt('ZS', '2026-11-07T02:00:00Z').open === false && bankAt('GS', '2026-11-07T02:00:00Z').open === false);
check('节假日所有银行休市', bankAt('GS', '2026-10-01T02:00:00Z').text === '休市');

// --- 更新列：休市时报价不动不标黄 ---
const OPEN_NOW = at('2026-11-06T02:00:00Z');
const quoteForAge = { buyPrice: 880, sellPrice: 879.5, quotedAt: OPEN_NOW - 40 * 60_000, basis: 'realtime' };
check('开市期间 40 分钟未更新标黄', formatQuoteCells(quoteForAge, OPEN_NOW).updateStale === true);
check('休市期间同样陈旧不标黄', formatQuoteCells(quoteForAge, at('2026-11-08T04:00:00Z')).updateStale === false);
check('更新文案按分钟展示', formatQuoteCells(quoteForAge, OPEN_NOW).update === '40 分钟前', formatQuoteCells(quoteForAge, OPEN_NOW).update);
check('刚取到的显示刚刚', updateAgeText(OPEN_NOW - 20_000, 'realtime', OPEN_NOW) === '刚刚');
check('一小时内按分钟', updateAgeText(OPEN_NOW - 10 * 60_000, 'realtime', OPEN_NOW) === '10 分钟前');
check('日定价当日显示已定价', updateAgeText(OPEN_NOW - 10 * 60_000, 'dailyFix', OPEN_NOW) === '今日已定价');
check('日定价跨小时按小时', updateAgeText(OPEN_NOW - 3 * 3_600_000, 'dailyFix', OPEN_NOW) === '3 小时前');
check('没有时间戳显示未知', updateAgeText(undefined, 'realtime', OPEN_NOW) === '未知');

// 每家银行按自己的时段判断：23:00 工商已收盘、浙商仍开市
const LATE_NIGHT = at('2026-11-06T15:00:00Z');
const lateQuote = { buyPrice: 880, sellPrice: 879.5, quotedAt: LATE_NIGHT - 40 * 60_000, basis: 'realtime' };
check('已收盘银行的旧报价不标黄', formatQuoteCells({ ...lateQuote, symbol: 'GS' }, LATE_NIGHT).updateStale === false);
check('仍在交易银行的旧报价标黄', formatQuoteCells({ ...lateQuote, symbol: 'ZS' }, LATE_NIGHT).updateStale === true);

// --- 全屏遮挡：只有盖住任务栏那一块的全屏窗口才隐藏贴纸 ---
const TB = { x: 0, y: 1032, width: 1920, height: 48 };
check('主屏全屏盖住任务栏', coversTaskbar({ x: 0, y: 0, width: 1920, height: 1080 }, TB) === true);
check('副屏全屏不影响主屏贴纸', coversTaskbar({ x: 1920, y: 0, width: 1536, height: 864 }, TB) === false);
check('窗口只盖住半屏不算全屏', coversTaskbar({ x: 0, y: 0, width: 1920, height: 900 }, TB) === false);
const LEFT_TB = { x: 0, y: 0, width: 48, height: 1080 };
check('任务栏在左侧也能判断', coversTaskbar({ x: 0, y: 0, width: 1920, height: 1080 }, LEFT_TB) === true);
const RIGHT_TB = { x: 1872, y: 0, width: 48, height: 1080 };
check('任务栏在右侧也能判断', coversTaskbar({ x: 1920, y: 0, width: 1536, height: 864 }, RIGHT_TB) === false);

// --- 分时序列：按日/按品种过滤、排序、断线、汇总与降采样 ---
const TREND_NOW = at('2026-11-06T02:00:00Z'); // 周五 10:00 北京
const TREND_TODAY = beijingDateKey(TREND_NOW);
const trendSamples = [
  { symbol: 'ZS', ts: TREND_NOW, buyPrice: 880 },
  { symbol: 'ZS', ts: TREND_NOW - 60 * 60_000, buyPrice: 870 },
  { symbol: 'ZS', ts: TREND_NOW - 59 * 60_000, buyPrice: 871 },
  { symbol: 'MS', ts: TREND_NOW, buyPrice: 999 },
  { symbol: 'ZS', ts: TREND_NOW - 24 * 60 * 60_000, buyPrice: 850 },
  { symbol: 'ZS', ts: TREND_NOW - 24 * 60 * 60_000 - 60_000, buyPrice: 849 },
];
const trend = dayTrendSeries(trendSamples, 'ZS', TREND_NOW);
check('分时只取当天与当前品种', trend.points.length === 3 && trend.day === TREND_TODAY && trend.isToday);
check('分时点按时间升序', trend.points[0].ts === TREND_NOW - 60 * 60_000 && trend.points[2].ts === TREND_NOW);
check('超过 30 分钟断线', trend.points[0].gap === false && trend.points[1].gap === false && trend.points[2].gap === true);
check('分时开盘/最新/高低正确', trend.open === 870 && trend.last === 880 && trend.low === 870 && trend.high === 880);
check('分时涨跌相对首笔', trend.changeText === '+1.15%' && trend.tone === 'up', trend.changeText);
check('分时金额由 core 格式化', trend.lastText === '880.00' && trend.lowText === '870.00' && trend.highText === '880.00');
check('分时横轴按北京时间自然日', trend.dayStart === TREND_NOW - 10 * 60 * 60_000 && trend.dayEnd - trend.dayStart === 86_400_000);
check(
  '北京自然日按 UTC+8 切',
  beijingDateKey(Date.parse('2026-11-09T15:59:59Z')) === '2026-11-09' &&
    beijingDateKey(Date.parse('2026-11-09T16:00:00Z')) === '2026-11-10',
  `${beijingDateKey(Date.parse('2026-11-09T15:59:59Z'))}/${beijingDateKey(Date.parse('2026-11-09T16:00:00Z'))}`,
);
const trendDup = dayTrendSeries(
  [
    { symbol: 'ZS', ts: TREND_NOW, buyPrice: 880 },
    { symbol: 'ZS', ts: TREND_NOW, buyPrice: 881 },
  ],
  'ZS',
  TREND_NOW,
);
check('同一时间戳保留最后一笔', trendDup.points.length === 1 && trendDup.points[0].price === 881);
const trendMany = Array.from({ length: 600 }, (_, i) => ({ symbol: 'ZS', ts: TREND_NOW - (599 - i) * 1000, buyPrice: 870 + i }));
const trendDown = dayTrendSeries(trendMany, 'ZS', TREND_NOW, { maxPoints: 50 });
check('分时降采样到上限且保留首尾', trendDown.points.length === 50 && trendDown.points[0].ts === trendMany[0].ts && trendDown.points[49].ts === trendMany[599].ts);
check('降采样不改汇总值', trendDown.high === 870 + 599 && trendDown.low === 870);
const previousKey = beijingDateKey(TREND_NOW - 24 * 60 * 60_000);
const trendPrev = dayTrendSeries(trendSamples, 'ZS', TREND_NOW, { preferPreviousDay: true });
check('休市回退上一交易日', trendPrev.day === previousKey && trendPrev.isToday === false && trendPrev.points.length === 2, trendPrev.day);
const trendDupDay = [
  { symbol: 'ZS', ts: TREND_NOW - 24 * 60 * 60_000, buyPrice: 850 },
  { symbol: 'ZS', ts: TREND_NOW - 24 * 60 * 60_000, buyPrice: 851 },
  { symbol: 'ZS', ts: TREND_NOW - 48 * 60 * 60_000, buyPrice: 840 },
  { symbol: 'ZS', ts: TREND_NOW - 48 * 60 * 60_000 + 60_000, buyPrice: 841 },
];
const trendSkipDup = dayTrendSeries(trendDupDay, 'ZS', TREND_NOW, { preferPreviousDay: true });
check(
  '回退跳过只有重复时间戳的日子',
  trendSkipDup.day === beijingDateKey(TREND_NOW - 48 * 60 * 60_000) && trendSkipDup.points.length === 2,
  trendSkipDup.day,
);
const trendEmpty = dayTrendSeries([], 'ZS', TREND_NOW);
check('没有采样时图表为空', trendEmpty.points.length === 0 && trendEmpty.open === null && trendEmpty.changeText === '—' && trendEmpty.tone === 'flat');
const trendBad = dayTrendSeries(
  [
    { symbol: 'ZS', ts: TREND_NOW, buyPrice: 0 },
    { symbol: 'ZS', ts: TREND_NOW, buyPrice: Number.NaN },
  ],
  'ZS',
  TREND_NOW,
);
check('无效价格不计入分时', trendBad.points.length === 0);
check('断线阈值是 30 分钟', TREND_GAP_MS === 30 * 60_000);
check('分时点自带北京时间，面板不用自己拼', trend.points[2].timeText === '10:00', trend.points[2].timeText);
check('全天模式横轴固定 00/12/24', trend.axisLabels.join('|') === '00:00|12:00|24:00', trend.axisLabels.join('|'));

// --- 7/10 天走势：跨自然日，横轴换成日期 ---
const trend7 = dayTrendSeries(trendSamples, 'ZS', TREND_NOW, { range: '7d' });
check('7 天窗口从当前往回截', trend7.windowStart === TREND_NOW - 7 * 86_400_000 && trend7.windowEnd === TREND_NOW);
check('7 天包含多日采样', trend7.points.length === 5, String(trend7.points.length));
check(
  '7 天标题与日期横轴',
  trend7.windowText === '近 7 天' && trend7.axisLabels.every((label) => /^\d{2}-\d{2}$/.test(label)),
  trend7.axisLabels.join('|'),
);
check('多日悬停带日期', /^\d{2}-\d{2} \d{2}:\d{2}$/.test(trend7.points[0].timeText), trend7.points[0].timeText);
check('多日图只在真实时间空档断线', trend7.points.filter((point) => point.gap).length === 1, String(trend7.points.filter((point) => point.gap).length));
const trend10 = dayTrendSeries(trendSamples, 'ZS', TREND_NOW, { range: '10d' });
check(
  '10 天窗口更宽且仍可绘制',
  trend10.windowStart === TREND_NOW - 10 * 86_400_000 && trend10.points.length === trend7.points.length,
);
const trend7Empty = dayTrendSeries([], 'ZS', TREND_NOW, { range: '7d' });
check('多日模式没有采样时为空', trend7Empty.points.length === 0 && trend7Empty.windowText === '近 7 天');

// --- 分时图配置：显示开关、时间范围与窗口裁剪 ---
check(
  '分时配置缺省为显示 + 全天',
  JSON.stringify(normalizeTrendSettings(undefined)) === JSON.stringify({ enabled: true, range: 'day' }),
);
check(
  '分时配置保留合法值、丢弃脏值',
  JSON.stringify(normalizeTrendSettings({ enabled: false, range: '1h' })) === JSON.stringify({ enabled: false, range: '1h' }),
);
check(
  '分时配置脏 range 退回全天',
  JSON.stringify(normalizeTrendSettings({ enabled: 'no', range: '3h' })) === JSON.stringify({ enabled: true, range: 'day' }),
);
check('时间范围覆盖 30 分钟到全天', TREND_RANGE_ORDER.join('|') === '30m|1h|2h|4h|6h|12h|day|7d|10d', TREND_RANGE_ORDER.join('|'));
check(
  '新增范围可保存',
  JSON.stringify(normalizeTrendSettings({ enabled: true, range: '4h' })) === JSON.stringify({ enabled: true, range: '4h' }),
);

const rangeSamples = [
  { symbol: 'ZS', ts: TREND_NOW, buyPrice: 880 },
  { symbol: 'ZS', ts: TREND_NOW - 30 * 60_000, buyPrice: 875 },
  { symbol: 'ZS', ts: TREND_NOW - 90 * 60_000, buyPrice: 872 },
  { symbol: 'ZS', ts: TREND_NOW - 5 * 60 * 60_000, buyPrice: 865 },
];
const trendHour = dayTrendSeries(rangeSamples, 'ZS', TREND_NOW, { range: '1h' });
check('1 小时只留窗口内采样', trendHour.points.length === 2 && trendHour.points[0].price === 875, String(trendHour.points.length));
check('1 小时窗口从当前时刻往回截', trendHour.windowEnd === TREND_NOW && trendHour.windowStart === TREND_NOW - 3_600_000);
check('1 小时汇总只看窗口内', trendHour.open === 875 && trendHour.last === 880 && trendHour.low === 875 && trendHour.high === 880);
check('1 小时涨跌相对窗口首笔', trendHour.changeText === '+0.57%' && trendHour.tone === 'up', trendHour.changeText);
check('1 小时横轴按实际窗口', trendHour.axisLabels.join('|') === '09:00|09:30|10:00', trendHour.axisLabels.join('|'));
check('1 小时标题带范围', trendHour.windowText === '今日 · 1 小时' && trendHour.rangeText === '1 小时', trendHour.windowText);

const trend30 = dayTrendSeries(rangeSamples, 'ZS', TREND_NOW, { range: '30m' });
check('30 分钟只留窗口内采样', trend30.points.length === 2 && trend30.windowStart === TREND_NOW - 30 * 60_000);
check('30 分钟横轴按实际窗口', trend30.axisLabels.join('|') === '09:30|09:45|10:00', trend30.axisLabels.join('|'));

const spark = trendSparkline(trend30);
check(
  '任务栏迷你走势按时间比例归一化',
  spark?.points.length === 2 && spark.points[0].x === 0 && Math.abs(spark.points[1].x - 1) < 1e-9,
  JSON.stringify(spark?.points),
);
check('迷你走势价格越高 y 越小', !!spark && spark.points[1].y < spark.points[0].y);
check('迷你走势保留涨跌颜色', spark?.tone === 'up', spark?.tone);
check('少于两个点不画迷你走势', trendSparkline(trendDup) === null);
check('迷你走势保留断线标记', trendSparkline(trend)?.points[2].gap === true);

const trendHalf = dayTrendSeries(rangeSamples, 'ZS', TREND_NOW, { range: '12h' });
check('半天包含当天全部采样且不跨出自然日', trendHalf.points.length === 4 && trendHalf.windowStart === trendHalf.dayStart);
check('半天横轴末端跟到当前时刻', trendHalf.axisLabels[2] === '10:00' && trendHalf.axisLabels[0] === '00:00', trendHalf.axisLabels.join('|'));

const trendOld = dayTrendSeries([{ symbol: 'ZS', ts: TREND_NOW - 3 * 60 * 60_000, buyPrice: 860 }], 'ZS', TREND_NOW, { range: '1h' });
check('窗口内没有采样时图表为空', trendOld.points.length === 0 && trendOld.open === null && trendOld.changeText === '—');

const trendPrevHour = dayTrendSeries(trendSamples, 'ZS', TREND_NOW, { preferPreviousDay: true, range: '1h' });
check(
  '回退日按当天最后一笔截窗口',
  trendPrevHour.isToday === false && trendPrevHour.windowEnd === TREND_NOW - 24 * 60 * 60_000 && trendPrevHour.points.length === 2,
  `${trendPrevHour.day} ${trendPrevHour.points.length}`,
);

// --- 浏览器速览页：只读单文件，金额与颜色必须和面板同一口径 ---
const dashNow = Date.now();
const dashQuote = (
  symbol: string,
  name: string,
  buyPrice: number,
  sellPrice: number,
  dayChangePct: number | undefined,
) => ({
  sourceId: 'jd',
  symbol,
  name,
  label: name,
  currency: 'CNY' as const,
  unit: 'GRAM' as const,
  buyPrice,
  sellPrice,
  midPrice: (buyPrice + sellPrice) / 2,
  spread: buyPrice - sellPrice,
  basis: 'realtime' as const,
  dayChangePct,
  quotedAt: dashNow,
  fetchedAt: dashNow,
});
const dashHtml = renderDashboardHtml({
  quotes: [
    dashQuote('ZS', '浙商积存金', 875.5, 873.2, -0.42),
    dashQuote('GS', '工商积存金', 880.126, 877.8, 0.35),
  ],
  primarySymbol: 'ZS',
  errors: ['<boom>'],
  updatedAt: dashNow,
});
check('速览页金额两位小数', dashHtml.includes('>875.50<') && dashHtml.includes('>873.20<'));
check('速览页涨跌颜色按真实方向', dashHtml.includes('hero-price down') && dashHtml.includes('class="num up"'));
check('速览页主显行标出', dashHtml.includes('is-primary') && dashHtml.includes('>主显<'));
check('速览页自动刷新', dashHtml.includes('http-equiv="refresh" content="30"'));
check('速览页转义外部文本', dashHtml.includes('&lt;boom&gt;') && !dashHtml.includes('<boom>'));

// --- 伦敦金：独立参考行情，字段与折算都按新浪外盘口径 ---
const londonPayload =
  'var hq_str_hf_XAU="3954.90,3987.690,3954.90,3955.25,4000.31,3954.84,16:20:00,3987.69,3990.89,0,0,0,2026-11-12,伦敦金（现货黄金）";\n' +
  'var hq_str_fx_susdcny="16:21:01,6.6689000000,6.6690000000,6.6749000000,51.0000000000,6.6718000000,6.6718000000,6.6667000000,6.6689000000,在岸人民币,-0.0899,-0.0060,0.0051,此行情由新浪财经计算得出,0.0000,0.0000,,2026-11-12";';
const london = parseLondonGold(londonPayload, 0);
const londonView = londonGoldView(london, london.quotedAt);
check('伦敦金现价与买一卖一', london.price === 3954.9 && london.bid === 3954.9 && london.ask === 3955.25);
check('伦敦金按昨收算涨跌', londonView.pctText === '-0.82%' && londonView.tone === 'down', londonView.pctText);
check('伦敦金时间按北京时间解析', london.quotedAt === Date.UTC(2026, 10, 12, 8, 20, 0), String(london.quotedAt));
check('伦敦金按在岸汇率折算元/克', londonView.cnyText === '≈ 847.97 元/克' && londonView.fxText === '在岸汇率 6.6689', londonView.cnyText);
check('伦敦金价格两位小数', londonView.priceText === '3954.90' && londonView.unitText === '美元/盎司');
const noFx = parseLondonGold(londonPayload.split('\n')[0], 0);
check('缺少汇率时只提示不硬算', noFx.cnyPerGram === undefined && londonGoldView(noFx).cnyText === '汇率未知，暂不折算');

// --- 伦敦金换算：两边都能量，非法输入不编数 ---
const usdToCnyCny = convertLondonGold(3954.9, 'usdOz', 6.6689);
check(
  '美元/盎司换算元/克',
  !!usdToCnyCny && Math.abs(usdToCnyCny.cnyGram - 847.966) < 0.01,
  usdToCnyCny ? usdToCnyCny.cnyGram.toFixed(3) : 'null',
);
const cnyToUsd = convertLondonGold(usdToCnyCny!.cnyGram, 'cnyGram', 6.6689);
check(
  '元/克反算回美元/盎司',
  !!cnyToUsd && Math.abs(cnyToUsd.usdOz - 3954.9) < 0.001,
  cnyToUsd ? cnyToUsd.usdOz.toFixed(3) : 'null',
);
check(
  '换算输入非法或汇率缺失时返回 null',
  convertLondonGold(0, 'usdOz', 6.6689) === null &&
    convertLondonGold(-1, 'cnyGram', 6.6689) === null &&
    convertLondonGold(Number.NaN, 'usdOz', 6.6689) === null &&
    convertLondonGold(100, 'usdOz', Number.NaN) === null,
);
check(
  '美元→元/克显示实际算式',
  usdToCnyCny?.formula === '3954.90 美元/盎司 × 6.6689 ÷ 31.1034768 ≈ 847.97 元/克',
  usdToCnyCny?.formula ?? 'null',
);
check(
  '元/克→美元显示实际算式',
  cnyToUsd?.formula === '847.97 元/克 × 31.1034768 ÷ 6.6689 ≈ 3954.90 美元/盎司',
  cnyToUsd?.formula ?? 'null',
);
const premium = londonPremium(860, 847.97);
check(
  '银行溢价按折算价算金额与百分比',
  !!premium && Math.abs(premium.amount - 12.03) < 0.001 && Math.abs(premium.pct - 1.4186) < 0.01,
  premium ? `${premium.amount.toFixed(2)} / ${premium.pct.toFixed(2)}%` : 'null',
);
check(
  '溢价输入缺失时不硬算',
  londonPremium(860, Number.NaN) === null && londonPremium(0, 847.97) === null,
);

console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
// 这里没有常驻定时器，让事件循环自然排空即可；不要 process.exit()（Windows + Node 24 会撞 libuv 断言）
process.exitCode = failures ? 1 : 0;
