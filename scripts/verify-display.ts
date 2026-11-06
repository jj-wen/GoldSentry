import {
  clampIntoWorkArea,
  clampOpacity,
  detectTaskbar,
  formatPct,
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
  check('拖出右边界被拉回', placeOnTaskbar({ width: 120, height: 20 }, bottomBar, 5000).x === 1800);
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
}
const negBounds = { x: -1920, y: 0, width: 1920, height: 1080 };
const negBar = detectTaskbar(negBounds, { x: -1920, y: 0, width: 1920, height: 1040 });
check(
  '副屏在左侧（负坐标）也能算对',
  negBar?.rect.y === 1040 && placeOnTaskbar({ width: 120, height: 20 }, negBar, null).x === -420,
  JSON.stringify(negBar && placeOnTaskbar({ width: 120, height: 20 }, negBar, null)),
);

console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
// 这里没有常驻定时器，让事件循环自然排空即可；不要 process.exit()（Windows + Node 24 会撞 libuv 断言）
process.exitCode = failures ? 1 : 0;
