const strip = document.getElementById('strip');
const markEl = document.getElementById('mark');
const symEl = document.getElementById('sym');
const priceEl = document.getElementById('price');
const arrowEl = document.getElementById('arrow');

let lastSignature = '';

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
  document.body.dataset.ready = 'true';
  const signature = `${data.mark}|${data.label}|${data.price}|${data.arrow}`;
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
