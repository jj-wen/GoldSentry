const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ball', {
  // 拖动与滚轮都是单向通知：走 invoke 会让每一下移动都等一次往返，手感发涩
  moveBy: (dx, dy) => ipcRenderer.send('ball:move-by', dx, dy),
  dragEnd: () => ipcRenderer.send('ball:drag-end'),
  click: () => ipcRenderer.send('ball:click'),
  opacityDelta: (delta) => ipcRenderer.send('ball:opacity-delta', delta),
  onUpdate: (callback) => ipcRenderer.on('ball:update', (_event, data) => callback(data)),
});
