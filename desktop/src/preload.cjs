/**
 * input: Electron preload context
 * output: Exposed APIs to renderer process
 * pos: Desktop preload script for secure IPC communication
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  showInFolder: (filePath) => ipcRenderer.send('show-in-folder', filePath),
});
