import { AlumfabAPI } from '../ipc/contracts';

declare global {
  interface Window {
    alumfab: AlumfabAPI;
  }
}

export {};
