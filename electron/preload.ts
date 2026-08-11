import { contextBridge, ipcRenderer } from 'electron';

// Expose safe, context-isolated IPC channels to Renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  getPaths: () => ipcRenderer.invoke('app:get-paths'),
  getSystemInfo: () => ipcRenderer.invoke('app:get-system-info')
});
