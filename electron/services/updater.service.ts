import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { LoggerService } from './logger.service';
import { UpdateState, UpdateStatus } from '../ipc/contracts';
import { IPC_CHANNELS } from '../ipc/channels';

/**
 * UpdaterService — deferred, till-safe auto-updates.
 *
 * Design constraints for a point-of-sale terminal:
 *
 *   1. NEVER interrupt a sale. The update is downloaded silently in the
 *      background; the actual swap only happens when the operator explicitly
 *      restarts, or when the app is closed at end of day.
 *   2. NEVER restart on its own. `autoInstallOnAppQuit` means the new build is
 *      applied during the next normal shutdown — the shop opens on the new
 *      version and nobody loses a cart.
 *   3. Fail quietly. A shop with a dead internet link must keep selling. Every
 *      failure path logs and degrades to "you are up to date".
 *   4. Report everything to the renderer so the UI can show a discreet
 *      "Update ready — restart when convenient" chip instead of a modal.
 *
 * Feed configuration lives in electron-builder.yml under `publish:`. That block
 * is baked into app-update.yml inside the packaged resources at build time; do
 * not duplicate the URL here.
 */
export class UpdaterService {
  /** Wait this long after launch before the first check — let the till boot. */
  private static readonly INITIAL_DELAY_MS = 45_000;

  /** Re-check on this cadence. 4h catches a same-day hotfix without noise. */
  private static readonly POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;

  private static pollTimer: NodeJS.Timeout | null = null;
  private static initialTimer: NodeJS.Timeout | null = null;
  private static initialized = false;

  private static state: UpdateState = {
    status: 'idle',
    currentVersion: app.getVersion(),
    availableVersion: null,
    releaseNotes: null,
    releaseDate: null,
    downloadPercent: 0,
    bytesPerSecond: 0,
    error: null,
    lastCheckedAt: null,
    updateReadyToInstall: false
  };

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Wire up electron-updater. Call once, after the main window exists.
   */
  public static initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    // ── Behaviour flags ────────────────────────────────────────────────────
    // Download as soon as an update is found: bandwidth is cheap at 2am, an
    // operator waiting at the counter for a 120 MB download is not.
    autoUpdater.autoDownload = true;

    // The deferred install. electron-updater stages the NSIS package and runs
    // it with /S during app quit. Combined with `differentialPackage: true` in
    // electron-builder.yml, a patch release is a ~3 MB download.
    autoUpdater.autoInstallOnAppQuit = true;

    // Do not silently jump users onto a beta feed.
    autoUpdater.allowPrerelease = false;

    // Refuse to "update" to an older build if someone re-publishes a stale
    // latest.yml — a downgrade would run new data through old migrations.
    autoUpdater.allowDowngrade = false;

    // Route electron-updater's own diagnostics into the app log file that
    // support already asks customers for.
    autoUpdater.logger = {
      info: (m: unknown) => LoggerService.info('[Updater]', m),
      warn: (m: unknown) => LoggerService.warn('[Updater]', m),
      error: (m: unknown) => LoggerService.error('[Updater]', m),
      debug: (m: unknown) => LoggerService.info('[Updater][debug]', m)
    } as never;

    // ── In development, only run if a dev feed file was dropped in ────────
    if (!app.isPackaged) {
      const devFeed = path.join(app.getAppPath(), 'dev-app-update.yml');
      if (fs.existsSync(devFeed)) {
        autoUpdater.updateConfigPath = devFeed;
        autoUpdater.forceDevUpdateConfig = true;
        LoggerService.info('[Updater] Development feed active:', devFeed);
      } else {
        LoggerService.info('[Updater] Not packaged and no dev-app-update.yml — updater idle.');
        this.setState({ status: 'idle' });
        return;
      }
    }

    this.registerEventHandlers();
    this.scheduleChecks();

    LoggerService.info(`[Updater] Initialized. Current version ${app.getVersion()}.`);
  }

  /**
   * Manual check, triggered from Settings > Updates.
   * Returns the state snapshot so the caller can render immediately.
   */
  public static async checkNow(): Promise<UpdateState> {
    if (!this.initialized || (!app.isPackaged && !autoUpdater.forceDevUpdateConfig)) {
      return this.getState();
    }

    // An update already sitting on disk needs no network round trip.
    if (this.state.updateReadyToInstall) return this.getState();

    try {
      this.setState({ status: 'checking', error: null });
      await autoUpdater.checkForUpdates();
    } catch (err: unknown) {
      // Offline shops hit this constantly — warn, never error.
      const message = err instanceof Error ? err.message : String(err);
      LoggerService.warn('[Updater] Check failed (this is normal when offline):', message);
      this.setState({
        status: 'error',
        error: message,
        lastCheckedAt: new Date().toISOString()
      });
    }
    return this.getState();
  }

  /**
   * Apply a downloaded update right now. The renderer must only call this once
   * it has confirmed no cart is open and no cash shift is mid-reconciliation.
   *
   * @returns false when there is nothing staged to install.
   */
  public static installNow(): boolean {
    if (!this.state.updateReadyToInstall) {
      LoggerService.warn('[Updater] installNow() called with no update staged.');
      return false;
    }

    LoggerService.info(`[Updater] Operator confirmed restart -> installing ${this.state.availableVersion}.`);

    // isSilent = true            -> run the NSIS package with /S, no wizard
    // isForceRunAfter = true     -> bring the till straight back up
    // The before-quit lifecycle hook still runs, so the SQLite connection is
    // closed cleanly and the HTTP server is stopped before the swap.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  }

  public static getState(): UpdateState {
    return { ...this.state };
  }

  /** Stop timers during shutdown so a pending check can't resurrect the app. */
  public static dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.pollTimer = null;
    this.initialTimer = null;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private static scheduleChecks(): void {
    this.initialTimer = setTimeout(() => {
      void this.checkNow();
    }, this.INITIAL_DELAY_MS);

    this.pollTimer = setInterval(() => {
      // Once a package is staged there is nothing left to look for.
      if (!this.state.updateReadyToInstall) void this.checkNow();
    }, this.POLL_INTERVAL_MS);

    // Timers must not hold the event loop open at shutdown.
    this.initialTimer.unref?.();
    this.pollTimer.unref?.();
  }

  private static registerEventHandlers(): void {
    autoUpdater.on('checking-for-update', () => {
      this.setState({ status: 'checking', error: null });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      LoggerService.info(`[Updater] Update available: ${info.version} (have ${app.getVersion()}).`);
      this.setState({
        status: 'downloading',
        availableVersion: info.version,
        releaseDate: info.releaseDate ?? null,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
        downloadPercent: 0,
        lastCheckedAt: new Date().toISOString()
      });
    });

    autoUpdater.on('update-not-available', () => {
      this.setState({
        status: 'idle',
        availableVersion: null,
        lastCheckedAt: new Date().toISOString()
      });
    });

    autoUpdater.on('download-progress', (p: ProgressInfo) => {
      this.setState({
        status: 'downloading',
        downloadPercent: Math.round(p.percent),
        bytesPerSecond: Math.round(p.bytesPerSecond)
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      LoggerService.info(`[Updater] ${info.version} downloaded and staged. Will apply on next quit.`);
      this.setState({
        status: 'ready',
        availableVersion: info.version,
        downloadPercent: 100,
        updateReadyToInstall: true
      });
    });

    autoUpdater.on('error', (err: Error) => {
      LoggerService.warn('[Updater] Error:', err?.message || err);
      this.setState({
        status: 'error',
        error: err?.message || 'Unknown updater error',
        lastCheckedAt: new Date().toISOString()
      });
    });
  }

  /** Merge a patch into the state and push the whole snapshot to every window. */
  private static setState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch, currentVersion: app.getVersion() };
    const payload = this.getState();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.UPDATE_EVENT, payload);
      }
    }
  }
}

export type { UpdateStatus };
