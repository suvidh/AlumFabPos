import { app } from 'electron';
import { LoggerService } from '../services/logger.service';
import { DatabaseService } from '../services/database.service';
import { HttpService } from '../services/http.service';
import { UpdaterService } from '../services/updater.service';

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

  // Cleanup order matters. Stop accepting new work, cancel any pending update
  // check, then close the SQLite handle last so nothing is mid-transaction.
  //
  // When electron-updater has a package staged, this hook is what runs
  // immediately before the NSIS installer executes — a clean $disconnect() here
  // is the difference between a smooth upgrade and a locked pos.db.
  app.on('before-quit', async () => {
    LoggerService.info('Application preparing to quit. Performing cleanup...');
    UpdaterService.dispose();
    await HttpService.stop();
    await DatabaseService.shutdown();
  });
}
