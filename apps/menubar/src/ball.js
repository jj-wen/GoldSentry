const el = document.getElementById('ball');
const markEl = document.getElementById('mark');
const symEl = document.getElementById('sym');
const priceEl = document.getElementById('price');
const arrowEl = document.getElementById('arrow');

window.ball.onUpdate((data) => {
  markEl.textContent = data.mark ?? '';
  symEl.textContent = data.label ?? '—';
  priceEl.textContent = data.price ?? '—';
  arrowEl.textContent = data.arrow ?? '';
  for (const node of [priceEl, arrowEl]) {
    node.classList.remove('up', 'down');
    if (data.tone === 'up' || data.tone === 'down') node.classList.add(data.tone);
  }
});

let dragging = false;
let travelled = 0;

// 窗口跟着光标移动时 screenX 不变，所以增量只能取 movementX/Y（光标相对上一刻的位移）
el.addEventListener('pointerdown', (event) => {
  dragging = true;
  travelled = 0;
  el.setPointerCapture(event.pointerId);
});

el.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const dx = event.movementX;
  const dy = event.movementY;
  if (!dx && !dy) return;
  travelled += Math.abs(dx) + Math.abs(dy);
  window.ball.moveBy(dx, dy);
});

el.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = false;
  el.releasePointerCapture(event.pointerId);
  if (travelled >= 5) window.ball.dragEnd();
  // 右键进设置，左键开详情，与托盘保持一致
  else if (event.button === 2) window.ball.rightClick();
  else window.ball.click();
});

el.addEventListener('pointercancel', () => {
  dragging = false;
});

el.addEventListener('wheel', (event) => {
  event.preventDefault();
  window.ball.opacityDelta(event.deltaY > 0 ? -0.05 : 0.05);
});

el.addEventListener('contextmenu', (event) => event.preventDefault());

el.addEventListener('pointerdown', (event) => {
  if (event.button === 2) event.preventDefault();
});
