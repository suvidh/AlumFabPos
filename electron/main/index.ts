import { app, dialog } from 'electron';
import { AppPathsService } from './app-paths';
import { LoggerService } from '../services/logger.service';
import { DatabaseService } from '../services/database.service';
import { HttpService } from '../services/http.service';
import { UpdaterService } from '../services/updater.service';
import { registerIpcHandlers } from '../ipc/handlers';
import { createMainWindow, getMainWindow } from './window';
import { setupLifecycleHandlers } from './lifecycle';

// ---------------------------------------------------------------------------
// Single-instance lock
// ---------------------------------------------------------------------------
// Two copies of the till app would both try to bind port 3333 and both hold a
// write handle on pos.db. The installer's HKLM Run entry plus an operator
// double-clicking the desktop shortcut makes this a routine occurrence, so
// the second instance surrenders and focuses the first.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      // Launched by the installer's auto-start registry entry rather than by a
      // human. Reserved for boot-time behaviour (e.g. start minimised); the
      // window is still created so an unattended till comes up ready to sell.
      const isAutoStart = process.argv.includes('--autostart');

      // 1. Initialize AppData Storage Directories
      const paths = AppPathsService.getPaths();

      // 2. Initialize File Logger
      LoggerService.info('====================================================');
      LoggerService.info('Starting ALUMFAB POS Offline Desktop Application...');
      LoggerService.info(`Version: ${app.getVersion()} | Packaged: ${app.isPackaged} | AutoStart: ${isAutoStart}`);
      LoggerService.info(`AppData Root: ${paths.rootDir}`);
      LoggerService.info(`Database Path: ${paths.databaseFile}`);

      // 3. Setup Lifecycle & Error Handling
      setupLifecycleHandlers();

      // 4. Register IPC Handlers
      registerIpcHandlers();

      // 5. Bootstrap Database Engine & Auto-Create SQLite pos.db
      //    This also runs the schema drift guard, which may add missing
      //    columns (after a backup) or refuse to continue.
      const dbOk = await DatabaseService.bootstrap();

      if (!dbOk) {
        const fatal = DatabaseService.getFatalSchemaMessage();

        if (fatal) {
          // Incompatible schema. A till that opens with a partially readable
          // database will take payments and silently lose line items, so stop
          // here and put the diagnosis in front of whoever is standing at the
          // terminal rather than burying it in a log file.
          LoggerService.error('Halting startup: incompatible database schema.');
          dialog.showErrorBox('ALUMFAB POS — Database needs attention', fatal);
          app.exit(1);
          return;
        }

        LoggerService.warn('Database bootstrap reported issues. Continuing with health check warnings.');
      }

      // 6. Start Express HTTP REST API (for remote browser access via Tailscale)
      HttpService.start();

      // 7. Create Main Application Window
      createMainWindow();

      // 8. Arm the auto-updater. Must come after the window exists so the first
      //    state push has somewhere to land. Checks are delayed 45s internally
      //    so a cold boot isn't competing with the update download.
      UpdaterService.initialize();

      app.on('activate', () => {
        if (app.isReady()) {
          createMainWindow();
        }
      });

    } catch (error) {
      console.error('Fatal initialization error in Electron main process:', error);
      try {
        LoggerService.error('Fatal initialization error in app.whenReady:', error);
      } catch {
        // Ignore if logger uninitialized
      }
    }
  });
}
