const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('threddingDesktop', {
  getLogs:      () => ipcRenderer.invoke('logs:getRecent'),
  clearLogs:    () => ipcRenderer.invoke('logs:clear'),
  getHealth:    () => ipcRenderer.invoke('health:get'),
  copyText:     (text) => ipcRenderer.invoke('clipboard:writeText', text),
  saveTextFile: (text, defaultName) => ipcRenderer.invoke('debug:saveTextFile', { text, defaultName })
});
