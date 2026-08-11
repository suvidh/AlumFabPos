import { AlumfabAPI } from '../../../electron/ipc/contracts';

declare global {
  interface Window {
    alumfab: AlumfabAPI;
  }
}

export {};
