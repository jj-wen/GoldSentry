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
  if (travelled < 5) window.ball.click();
  else window.ball.dragEnd();
});

el.addEventListener('pointercancel', () => {
  dragging = false;
});

el.addEventListener('wheel', (event) => {
  event.preventDefault();
  window.ball.opacityDelta(event.deltaY > 0 ? -0.05 : 0.05);
});
