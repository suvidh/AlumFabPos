import { app } from 'electron';
import { AppPathsService } from './app-paths';
import { LoggerService } from '../services/logger.service';
import { DatabaseService } from '../services/database.service';
import { HttpService } from '../services/http.service';
import { registerIpcHandlers } from '../ipc/handlers';
import { createMainWindow } from './window';
import { setupLifecycleHandlers } from './lifecycle';

app.whenReady().then(async () => {
  try {
    // 1. Initialize AppData Storage Directories
    const paths = AppPathsService.getPaths();

    // 2. Initialize File Logger
    LoggerService.info('====================================================');
    LoggerService.info('Starting ALUMFAB POS Offline Desktop Application...');
    LoggerService.info(`AppData Root: ${paths.rootDir}`);
    LoggerService.info(`Database Path: ${paths.databaseFile}`);

    // 3. Setup Lifecycle & Error Handling
    setupLifecycleHandlers();

    // 4. Register IPC Handlers
    registerIpcHandlers();

    // 5. Bootstrap Database Engine & Auto-Create SQLite pos.db
    const dbOk = await DatabaseService.bootstrap();
    if (!dbOk) {
      LoggerService.warn('Database bootstrap reported issues. Continuing with health check warnings.');
    }

    // 6. Start Express HTTP REST API (for remote browser access via Tailscale)
    HttpService.start();

    // 6. Create Main Application Window
    createMainWindow();

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
