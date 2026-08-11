import fs from 'fs';
import path from 'path';
import { AppPathsService } from '../main/app-paths';

export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

export class LoggerService {
  private static logFilePath: string | null = null;

  private static getLogPath(): string {
    if (!this.logFilePath) {
      const paths = AppPathsService.getPaths();
      this.logFilePath = path.join(paths.logsDir, 'app.log');
    }
    return this.logFilePath;
  }

  private static write(level: LogLevel, message: string, meta?: any) {
    const timestamp = new Date().toISOString();
    let metaStr = '';
    if (meta) {
      if (meta instanceof Error) {
        metaStr = ` | Error: ${meta.message}\nStack: ${meta.stack}`;
      } else {
        try {
          metaStr = ` | Meta: ${JSON.stringify(meta)}`;
        } catch {
          metaStr = ` | Meta: [Unserializable]`;
        }
      }
    }

    const logLine = `[${timestamp}] [${level}] ${message}${metaStr}\n`;

    // Console output for development
    if (level === LogLevel.ERROR) {
      console.error(logLine.trim());
    } else if (level === LogLevel.WARN) {
      console.warn(logLine.trim());
    } else {
      console.log(logLine.trim());
    }

    // Write safely to app.log file
    try {
      fs.appendFileSync(this.getLogPath(), logLine, 'utf8');
    } catch (e) {
      console.error('Failed writing to local app.log file:', e);
    }
  }

  public static info(message: string, meta?: any) {
    this.write(LogLevel.INFO, message, meta);
  }

  public static warn(message: string, meta?: any) {
    this.write(LogLevel.WARN, message, meta);
  }

  public static error(message: string, meta?: any) {
    this.write(LogLevel.ERROR, message, meta);
  }
}
