const el = document.getElementById('ball');
const markEl = document.getElementById('mark');
const symEl = document.getElementById('sym');
const priceEl = document.getElementById('price');
const pctEl = document.getElementById('pct');
const arrowEl = document.getElementById('arrow');

window.ball.onUpdate((data) => {
  markEl.textContent = data.mark ?? '';
  symEl.textContent = data.label ?? '—';
  priceEl.textContent = data.price ?? '—';
  pctEl.hidden = !data.pct;
  pctEl.textContent = data.pct ?? '';
  arrowEl.textContent = data.arrow ?? '';
  for (const node of [priceEl, pctEl, arrowEl]) {
    node.classList.remove('up', 'down');
    if (data.tone === 'up' || data.tone === 'down') node.classList.add(data.tone);
  }
});

let dragging = false;
let startScreenX = 0;
let startScreenY = 0;

// 窗口跟着光标移动时 movementX/Y 在部分 Windows/DPI 组合下会失真；
// 位置改由主进程按屏幕光标点驱动，这里只记录起点用于区分点击与拖动。
el.addEventListener('pointerdown', (event) => {
  dragging = true;
  startScreenX = event.screenX;
  startScreenY = event.screenY;
  el.setPointerCapture(event.pointerId);
  window.ball.dragStart();
});

el.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = false;
  el.releasePointerCapture(event.pointerId);
  window.ball.dragEnd();
  const travelled = Math.abs(event.screenX - startScreenX) + Math.abs(event.screenY - startScreenY);
  if (travelled < 5) {
    // 右键进设置，左键开详情，与托盘保持一致
    if (event.button === 2) window.ball.rightClick();
    else window.ball.click();
  }
});

el.addEventListener('pointercancel', () => {
  if (!dragging) return;
  dragging = false;
  window.ball.dragEnd();
});

window.addEventListener('blur', () => {
  if (!dragging) return;
  dragging = false;
  window.ball.dragEnd();
});

el.addEventListener('wheel', (event) => {
  event.preventDefault();
  window.ball.opacityDelta(event.deltaY > 0 ? -0.05 : 0.05);
});

el.addEventListener('contextmenu', (event) => event.preventDefault());

el.addEventListener('pointerdown', (event) => {
  if (event.button === 2) event.preventDefault();
});
