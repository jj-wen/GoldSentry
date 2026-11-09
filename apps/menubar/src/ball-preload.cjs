const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ball', {
  // 拖动由主进程按光标位置驱动，渲染层只负责开始/结束，避免高频 pointermove 灌满 IPC
  dragStart: () => ipcRenderer.send('ball:drag-start'),
  dragEnd: () => ipcRenderer.send('ball:drag-end'),
  click: () => ipcRenderer.send('ball:click'),
  rightClick: () => ipcRenderer.send('ball:right-click'),
  opacityDelta: (delta) => ipcRenderer.send('ball:opacity-delta', delta),
  onUpdate: (callback) => ipcRenderer.on('ball:update', (_event, data) => callback(data)),
});
