import { app } from 'electron';
import { LoggerService } from '../services/logger.service';
import { DatabaseService } from '../services/database.service';
import { HttpService } from '../services/http.service';

export function setupLifecycleHandlers(): void {
  // Global Uncaught Exception Handlers
  process.on('uncaughtException', (error: Error) => {
    LoggerService.error('Uncaught Exception in Electron Main Process:', error);
  });

  process.on('unhandledRejection', (reason: any) => {
    LoggerService.error('Unhandled Rejection in Electron Main Process:', reason);
  });

  // App Shutdown Handlers
  app.on('window-all-closed', () => {
    LoggerService.info('All windows closed.');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', async () => {
    LoggerService.info('Application preparing to quit. Performing cleanup...');
    await HttpService.stop();
    await DatabaseService.shutdown();
  });
}
