const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskbar', {
  // 拖动是单向通知：invoke 的往返会让移动明显发涩
  moveBy: (dx, dy) => ipcRenderer.send('taskbar:move-by', dx, dy),
  dragEnd: () => ipcRenderer.send('taskbar:drag-end'),
  click: () => ipcRenderer.send('taskbar:click'),
  setSize: (width, height) => ipcRenderer.send('taskbar:size', { width, height }),
  onUpdate: (callback) => ipcRenderer.on('taskbar:update', (_event, data) => callback(data)),
  onLayout: (callback) => ipcRenderer.on('taskbar:layout', (_event, data) => callback(data)),
});
