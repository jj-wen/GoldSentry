const strip = document.getElementById('strip');
const markEl = document.getElementById('mark');
const symEl = document.getElementById('sym');
const priceEl = document.getElementById('price');
const arrowEl = document.getElementById('arrow');
const sparkEl = document.getElementById('spark');

let lastSignature = '';

const SPARK_W = 42;
const SPARK_H = 12;
const SVG_NS = 'http://www.w3.org/2000/svg';

function sparkNode(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function renderSpark(spark) {
  sparkEl.replaceChildren();
  const points = spark?.points ?? [];
  // SVG 元素没有 hidden 这个 IDL 属性，赋值只会挂成扩展属性，必须改内容属性
  sparkEl.toggleAttribute('hidden', points.length < 2);
  sparkEl.classList.remove('up', 'down', 'flat');
  if (points.length < 2) return;
  sparkEl.classList.add(spark.tone === 'up' || spark.tone === 'down' ? spark.tone : 'flat');
  let segment = [];
  const flush = () => {
    if (segment.length >= 2) {
      const coords = segment.map((p) => `${(p.x * SPARK_W).toFixed(2)},${(0.5 + p.y * (SPARK_H - 1)).toFixed(2)}`);
      sparkEl.appendChild(
        sparkNode('polyline', { points: coords.join(' '), fill: 'none', stroke: 'currentColor' }),
      );
    } else if (segment.length === 1) {
      sparkEl.appendChild(
        sparkNode('circle', {
          cx: (segment[0].x * SPARK_W).toFixed(2),
          cy: (0.5 + segment[0].y * (SPARK_H - 1)).toFixed(2),
          r: 1,
          fill: 'currentColor',
        }),
      );
    }
    segment = [];
  };
  for (const point of points) {
    if (point.gap) flush();
    segment.push(point);
  }
  flush();
}

function reportSize() {
  requestAnimationFrame(() => {
    const rect = strip.getBoundingClientRect();
    window.taskbar.setSize(Math.ceil(rect.width), Math.ceil(rect.height));
  });
}

window.taskbar.onUpdate((data) => {
  markEl.hidden = !data.mark;
  markEl.textContent = data.mark ?? '';
  symEl.textContent = data.label ?? '—';
  priceEl.textContent = data.price ?? '—';
  arrowEl.hidden = !data.arrow;
  arrowEl.textContent = data.arrow ?? '';
  for (const node of [priceEl, arrowEl]) {
    node.classList.remove('up', 'down');
    if (data.tone === 'up' || data.tone === 'down') node.classList.add(data.tone);
  }
  renderSpark(data.spark);
  strip.title = data.spark
    ? `单击打开面板 · ${data.spark.rangeText} ${data.spark.changeText}`
    : '单击打开面板 · 沿任务栏拖动可移位';
  document.body.dataset.ready = 'true';
  const signature = `${data.mark}|${data.label}|${data.price}|${data.arrow}|${data.spark?.points?.length ?? 0}`;
  if (signature !== lastSignature) {
    lastSignature = signature;
    reportSize();
  }
});

window.taskbar.onLayout((data) => {
  document.body.dataset.vertical = data.vertical ? 'true' : 'false';
  // 等方向样式生效再量，否则拿到的是旋转前的尺寸
  requestAnimationFrame(reportSize);
});

let dragging = false;
let travelled = 0;

// 窗口跟着光标走时 screenX 不变，增量只能取 movementX/Y
strip.addEventListener('pointerdown', (event) => {
  dragging = true;
  travelled = 0;
  strip.setPointerCapture(event.pointerId);
});

strip.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const dx = event.movementX;
  const dy = event.movementY;
  if (!dx && !dy) return;
  travelled += Math.abs(dx) + Math.abs(dy);
  window.taskbar.moveBy(dx, dy);
});

strip.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = false;
  strip.releasePointerCapture(event.pointerId);
  if (travelled >= 5) window.taskbar.dragEnd();
  // 右键进设置，左键开详情，与托盘保持一致
  else if (event.button === 2) window.taskbar.rightClick();
  else window.taskbar.click();
});

strip.addEventListener('pointercancel', () => {
  dragging = false;
});

strip.addEventListener('contextmenu', (event) => event.preventDefault());

strip.addEventListener('pointerdown', (event) => {
  if (event.button === 2) event.preventDefault();
});
