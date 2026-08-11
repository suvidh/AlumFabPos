import { app } from 'electron';
import { AppInfoResult, AppPathsResult, PingResult } from '../ipc/contracts';
import { AppPathsService } from '../main/app-paths';

export class SystemService {
  public static getAppInfo(): AppInfoResult {
    return {
      name: 'ALUMFAB POS',
      version: app.getVersion() || '1.0.0',
      platform: process.platform,
      arch: process.arch,
      isOffline: true
    };
  }

  public static getAppPaths(): AppPathsResult {
    return AppPathsService.getPaths();
  }

  public static ping(): PingResult {
    return {
      pong: true,
      timestamp: new Date().toISOString()
    };
  }
}
