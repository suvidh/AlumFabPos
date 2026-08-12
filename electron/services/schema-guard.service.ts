import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { analyseDrift, applyRepair, formatReport, DriftReport } from './schema-drift';
import { LoggerService } from './logger.service';

export interface SchemaGuardResult {
  /** False means the app must not proceed to seeding or serving requests. */
  safeToProceed: boolean;
  /** True when columns were added during this startup. */
  repaired: boolean;
  report: DriftReport;
  backupPath: string | null;
  /** Operator-facing message. Non-null only when safeToProceed is false. */
  fatalMessage: string | null;
}

/**
 * SchemaGuard — runs on every startup, before any domain query.
 *
 * Policy (chosen deliberately for a retail till):
 *
 *   Additive drift  -> back up, ALTER TABLE, verify, continue. The shop opens
 *                      on time and nobody notices. This is what a missing
 *                      `costPricePaise` looks like, and it is the overwhelming
 *                      majority of real-world drift.
 *
 *   Blocking drift  -> refuse to start, with a message naming the exact tables
 *                      and columns. A till that half-works is worse than one
 *                      that clearly says "call support": a partially readable
 *                      database will happily take payments and lose the line
 *                      items.
 *
 * The alternative — letting Prisma discover the problem mid-transaction — is
 * what produced the original bulk-import rollback. Failing at boot converts an
 * unexplained transaction abort into a one-line diagnosis.
 */
export class SchemaGuard {
  /**
   * @param client   connected PrismaClient for the runtime database
   * @param dbPath   absolute path to the SQLite file (for the safety backup)
   * @param backupDir where pre-repair snapshots are written
   */
  public static async ensureCompatible(
    client: PrismaClient,
    dbPath: string,
    backupDir: string,
    locate: { appPath?: string; resourcesPath?: string } = {}
  ): Promise<SchemaGuardResult> {
    let report: DriftReport;

    try {
      report = await analyseDrift(client, locate);
    } catch (err: unknown) {
      // A guard that crashes must not take the till down with it. If we cannot
      // introspect, log loudly and let the app continue — Prisma's own errors
      // are still the backstop.
      const message = err instanceof Error ? err.message : String(err);
      LoggerService.error('[SchemaGuard] Drift analysis failed; continuing unguarded:', message);
      return {
        safeToProceed: true,
        repaired: false,
        report: {
          ok: true,
          repairable: false,
          items: [],
          additive: [],
          blocking: [],
          repairSql: [],
          ddlSource: null
        },
        backupPath: null,
        fatalMessage: null
      };
    }

    // ---- Clean -----------------------------------------------------------
    if (report.ok) {
      LoggerService.info('[SchemaGuard] Database schema matches the Prisma datamodel.');
      return { safeToProceed: true, repaired: false, report, backupPath: null, fatalMessage: null };
    }

    LoggerService.warn('[SchemaGuard] Schema drift detected:\n' + formatReport(report));

    // ---- Blocking --------------------------------------------------------
    if (report.blocking.length > 0) {
      const summary = report.blocking
        .map((i) => `  - ${i.table}${i.column ? `.${i.column}` : ''}: ${i.kind}`)
        .join('\n');

      const fatalMessage =
        'The ALUMFAB POS database is not compatible with this version of the application.\n\n' +
        `${report.blocking.length} change(s) cannot be applied automatically:\n${summary}\n\n` +
        'Your data has NOT been modified. A technician can inspect and repair with:\n' +
        '  npm run db:repair -- --check\n\n' +
        `Database: ${dbPath}`;

      LoggerService.error('[SchemaGuard] Refusing to start.\n' + fatalMessage);
      return { safeToProceed: false, repaired: false, report, backupPath: null, fatalMessage };
    }

    // ---- Additive: back up, then repair ----------------------------------
    let backupPath: string | null = null;
    try {
      backupPath = this.snapshot(dbPath, backupDir);
      LoggerService.info(`[SchemaGuard] Pre-repair snapshot written to ${backupPath}`);
    } catch (err: unknown) {
      // No backup means no repair. Losing a shop's ledger to an unattended
      // ALTER TABLE is not a trade worth making.
      const message = err instanceof Error ? err.message : String(err);
      const fatalMessage =
        'ALUMFAB POS needs to update its database structure, but could not create a safety ' +
        `backup first, so no changes were made.\n\nReason: ${message}\n\n` +
        `Check free disk space and permissions on:\n  ${backupDir}`;
      LoggerService.error('[SchemaGuard] Backup failed; skipping repair. ' + message);
      return { safeToProceed: false, repaired: false, report, backupPath: null, fatalMessage };
    }

    const newTables = report.additive.filter((i) => i.kind === 'missing-table').length;
    const newColumns = report.additive.filter((i) => i.kind === 'missing-column').length;
    LoggerService.info(
      `[SchemaGuard] Applying ${report.repairSql.length} statement(s): ` +
        `${newTables} table(s), ${newColumns} column(s). DDL source: ${report.ddlSource ?? 'n/a'}`
    );

    const result = await applyRepair(client, report);
    for (const sql of result.applied) {
      LoggerService.info(`[SchemaGuard]   applied: ${sql.replace(/\s+/g, ' ').slice(0, 160)}`);
    }

    // Creating a missing table cannot orphan an existing row, so a violation
    // here means the database was already damaged. Say so instead of letting
    // the till discover it during a sale.
    if (result.foreignKeyViolations.length > 0) {
      const sample = result.foreignKeyViolations
        .slice(0, 10)
        .map((v) => `  - ${v.table} row ${v.rowid ?? '?'} -> missing ${v.parent}`)
        .join('\n');
      const fatalMessage =
        'ALUMFAB POS updated the database structure, but found rows pointing at records ' +
        `that no longer exist.\n\n${result.foreignKeyViolations.length} broken reference(s):\n${sample}\n\n` +
        `The database has NOT been reverted. A snapshot from before the change is at:\n  ${backupPath}\n\n` +
        'Contact support before trading on this terminal.';
      LoggerService.error(`[SchemaGuard] foreign_key_check found ${result.foreignKeyViolations.length} violation(s).`);
      return { safeToProceed: false, repaired: true, report, backupPath, fatalMessage };
    }

    if (result.failed.length > 0) {
      for (const f of result.failed) {
        LoggerService.error(`[SchemaGuard]   FAILED: ${f.sql}\n              ${f.error}`);
      }
      const fatalMessage =
        'ALUMFAB POS could not finish updating its database structure.\n\n' +
        `${result.applied.length} change(s) applied, ${result.failed.length} failed.\n\n` +
        `A backup taken before any change is at:\n  ${backupPath}\n\n` +
        'Restore that file and contact support rather than continuing.';
      return { safeToProceed: false, repaired: result.applied.length > 0, report, backupPath, fatalMessage };
    }

    // ---- Verify the repair actually worked -------------------------------
    const after = await analyseDrift(client, locate);
    if (after.blocking.length > 0 || after.additive.length > 0) {
      const fatalMessage =
        'ALUMFAB POS applied database changes but the schema still does not match.\n\n' +
        `${formatReport(after)}\n\nBackup: ${backupPath}`;
      LoggerService.error('[SchemaGuard] Post-repair verification failed.\n' + formatReport(after));
      return { safeToProceed: false, repaired: true, report, backupPath, fatalMessage };
    }

    LoggerService.info(
      `[SchemaGuard] Repair complete — ${newTables} table(s) and ${newColumns} column(s) created, ` +
        'foreign key integrity verified, schema now current.'
    );
    return { safeToProceed: true, repaired: true, report, backupPath, fatalMessage: null };
  }

  /**
   * Copy the SQLite file plus its WAL/SHM sidecars.
   *
   * A plain copyFileSync of just the .db can miss committed transactions still
   * living in the write-ahead log, which would make the "safety" backup quietly
   * lossy. Copying all three keeps the set consistent.
   */
  private static snapshot(dbPath: string, backupDir: string): string {
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const target = path.join(backupDir, `PRE-SCHEMA-REPAIR-${stamp}.db`);

    fs.copyFileSync(dbPath, target);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, target + suffix);
    }

    // Also drop a `pos.db.bak` beside the live database. The timestamped copy
    // in backups/ is the real archive — this one is the file a technician on
    // the phone can be talked through restoring without navigating anywhere.
    // Overwritten on each repair by design: it means "the last known good".
    try {
      fs.copyFileSync(dbPath, `${dbPath}.bak`);
    } catch (err: unknown) {
      LoggerService.warn(
        `[SchemaGuard] Could not write ${dbPath}.bak: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return target;
  }
}
