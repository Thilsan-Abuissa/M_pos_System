const { contextBridge, ipcRenderer } = require('electron');

function safeOn(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('customerDisplayApi', {
  onUpdate: (callback) => safeOn('update-display', callback)
});
