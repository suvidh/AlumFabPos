import { contextBridge } from 'electron';
import { alumfabAPI } from './api';

// Expose strictly namespaced window.alumfab API to Renderer process
contextBridge.exposeInMainWorld('alumfab', alumfabAPI);
