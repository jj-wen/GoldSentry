const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskbar', {
  // 拖动由主进程按光标位置驱动，渲染层只负责开始/结束
  dragStart: () => ipcRenderer.send('taskbar:drag-start'),
  dragEnd: () => ipcRenderer.send('taskbar:drag-end'),
  click: () => ipcRenderer.send('taskbar:click'),
  rightClick: () => ipcRenderer.send('taskbar:right-click'),
  setSize: (width, height) => ipcRenderer.send('taskbar:size', { width, height }),
  onUpdate: (callback) => ipcRenderer.on('taskbar:update', (_event, data) => callback(data)),
  onLayout: (callback) => ipcRenderer.on('taskbar:layout', (_event, data) => callback(data)),
});
