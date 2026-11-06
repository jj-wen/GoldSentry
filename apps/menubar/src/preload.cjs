const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gold', {
  getState: () => ipcRenderer.invoke('gold:state'),
  getFees: () => ipcRenderer.invoke('gold:fees'),
  refresh: () => ipcRenderer.invoke('gold:refresh'),
  saveRules: (rules) => ipcRenderer.invoke('gold:save-rules', rules),
  setPrimary: (symbol) => ipcRenderer.invoke('gold:set-primary', symbol),
  setPollSeconds: (seconds) => ipcRenderer.invoke('gold:set-interval', seconds),
  saveBark: (bark) => ipcRenderer.invoke('gold:save-bark', bark),
  barkTest: () => ipcRenderer.invoke('gold:bark-test'),
  getCapabilities: () => ipcRenderer.invoke('gold:capabilities'),
  setBall: (patch) => ipcRenderer.invoke('gold:set-ball', patch),
  setTaskbar: (patch) => ipcRenderer.invoke('gold:set-taskbar', patch),
  onUpdate: (callback) => ipcRenderer.on('gold:update', (_event, state) => callback(state)),
});
