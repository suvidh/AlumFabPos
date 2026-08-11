import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { AppPathsResult } from '../ipc/contracts';

export class AppPathsService {
  private static paths: AppPathsResult | null = null;

  /**
   * Resolve and ensure all required application directories exist in %APPDATA%\ALUMFAB-POS
   */
  public static getPaths(): AppPathsResult {
    if (this.paths) return this.paths;

    const userAppData = app.getPath('userData');
    // Logical root: %APPDATA%\ALUMFAB-POS
    const rootDir = path.join(userAppData, '..', 'ALUMFAB-POS');
    const databaseDir = path.join(rootDir, 'database');
    const databaseFile = path.join(databaseDir, 'pos.db');
    const backupDir = path.join(rootDir, 'backups');
    const logsDir = path.join(rootDir, 'logs');
    const logosDir = path.join(rootDir, 'assets', 'logos');

    // Recursively ensure directories exist
    [rootDir, databaseDir, backupDir, logsDir, logosDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    this.paths = {
      rootDir,
      databaseDir,
      databaseFile,
      backupDir,
      logsDir,
      logosDir
    };

    return this.paths;
  }
}
