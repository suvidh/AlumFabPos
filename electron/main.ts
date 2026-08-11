import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';

// 1. Initialize %APPDATA%/ALUMFAB-POS Directory Structure
const userAppDataPath = app.getPath('userData');
const appDataRoot = path.join(userAppDataPath, '..', 'ALUMFAB-POS');

const dbDirectory = path.join(appDataRoot, 'database');
const backupsDirectory = path.join(appDataRoot, 'backups');
const logsDirectory = path.join(appDataRoot, 'logs');
const logosDirectory = path.join(appDataRoot, 'assets', 'logos');

[dbDirectory, backupsDirectory, logsDirectory, logosDirectory].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'ALUMFAB POS — Offline Desktop Billing & Inventory System',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('app:get-paths', () => {
  return {
    appDataRoot,
    dbDirectory,
    backupsDirectory,
    logsDirectory,
    logosDirectory
  };
});

ipcMain.handle('app:get-system-info', () => {
  return {
    appName: 'ALUMFAB POS',
    version: '1.0.0',
    platform: process.platform,
    isOffline: true,
    dbPath: path.join(dbDirectory, 'pos.db')
  };
});
