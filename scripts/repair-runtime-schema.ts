/**
 * scripts/repair-runtime-schema.ts
 * =============================================================================
 * Inspect and repair the ALUMFAB POS runtime database from the command line.
 *
 *   npm run db:repair                 # report drift, change nothing
 *   npm run db:repair -- --apply      # take a backup, then add missing columns
 *   npm run db:repair -- --db "C:\path\to\pos.db"
 *   npm run db:repair -- --all        # check the template DB as well
 *
 * WHEN TO USE THIS
 * ----------------
 * The app repairs additive drift by itself on startup (see
 * electron/services/schema-guard.service.ts), so in normal operation you never
 * need this. Reach for it when:
 *
 *   - a terminal is already broken and you want the diagnosis before launching;
 *   - the guard reported BLOCKING drift and you need the detail;
 *   - you are preparing a fleet update and want to know what will change;
 *   - you want to verify the shipped template `prisma/pos.db` is current.
 *
 * SAFETY
 * ------
 *   - Default mode is read-only. Nothing changes without --apply.
 *   - --apply always snapshots the database (plus -wal/-shm) first.
 *   - Only ALTER TABLE ADD COLUMN and CREATE UNIQUE INDEX are ever emitted.
 *     No DROP, no table rebuilds, no data rewrites.
 *   - Blocking drift is reported and refused, never guessed at.
 */

import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { analyseDrift, applyRepair, formatReport } from '../electron/services/schema-drift';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const ALL = argv.includes('--all');
const dbFlagIndex = argv.indexOf('--db');
const EXPLICIT_DB = dbFlagIndex >= 0 ? argv[dbFlagIndex + 1] : null;

/** %APPDATA%\ALUMFAB-POS\database\pos.db — matches AppPathsService. */
function runtimeDbPath(): string | null {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  return path.join(appData, 'ALUMFAB-POS', 'database', 'pos.db');
}

function backupDir(): string {
  const appData = process.env.APPDATA;
  return appData
    ? path.join(appData, 'ALUMFAB-POS', 'backups')
    : path.join(process.cwd(), 'backups');
}

function snapshot(dbPath: string): string {
  const dir = backupDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(dir, `PRE-SCHEMA-REPAIR-${stamp}.db`);
  fs.copyFileSync(dbPath, target);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, target + suffix);
  }
  return target;
}

function kb(p: string): string {
  return `${Math.round(fs.statSync(p).size / 1024)} KB`;
}

// ---------------------------------------------------------------------------
// One database
// ---------------------------------------------------------------------------
async function inspect(label: string, dbPath: string): Promise<boolean> {
  const rule = '='.repeat(72);
  console.log(`\n${rule}\n  ${label}\n  ${dbPath}`);

  if (!fs.existsSync(dbPath)) {
    console.log(`  STATUS: file not found — skipping\n${rule}`);
    return true;
  }
  console.log(`  SIZE:   ${kb(dbPath)}\n${rule}\n`);

  const client = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

  try {
    await client.$connect();
    const report = await analyseDrift(client);

    if (report.ok) {
      console.log('  No drift. This database matches the current Prisma datamodel.');
      return true;
    }

    console.log(formatReport(report).split('\n').map((l) => `  ${l}`).join('\n'));

    // ---- Blocking: report and stop ---------------------------------------
    if (report.blocking.length > 0) {
      console.log(
        '\n  This drift cannot be repaired automatically. Nothing was changed.\n' +
          '  These changes need a migration with an explicit data plan — decide what\n' +
          '  existing rows should contain, then write it as a Prisma migration:\n' +
          '\n    npx prisma migrate dev --name <describe-the-change>\n'
      );
      return false;
    }

    // ---- Additive --------------------------------------------------------
    console.log('\n  Statements that would be executed:');
    for (const sql of report.repairSql) console.log(`    ${sql};`);

    if (!APPLY) {
      console.log('\n  Read-only mode. Re-run with --apply to make these changes.\n');
      return true;
    }

    const backup = snapshot(dbPath);
    console.log(`\n  Backup written: ${backup} (${kb(backup)})`);

    const result = await applyRepair(client, report);
    for (const sql of result.applied) console.log(`    applied: ${sql}`);

    if (result.failed.length > 0) {
      for (const f of result.failed) console.error(`    FAILED : ${f.sql}\n             ${f.error}`);
      console.error(
        `\n  ${result.failed.length} statement(s) failed. The database is in a partially\n` +
          `  repaired state. Restore from:\n    ${backup}\n`
      );
      return false;
    }

    const after = await analyseDrift(client);
    if (!after.ok) {
      console.error('\n  Verification failed — drift remains after repair:');
      console.error(formatReport(after).split('\n').map((l) => `    ${l}`).join('\n'));
      console.error(`\n  Restore from: ${backup}\n`);
      return false;
    }

    console.log(`\n  Repaired. ${result.applied.length} statement(s) applied; schema is now current.\n`);
    return true;
  } catch (err: unknown) {
    console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  } finally {
    await client.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('\nALUMFAB POS — runtime schema inspection');
  console.log(APPLY ? 'MODE: APPLY (changes will be made, after a backup)' : 'MODE: CHECK (read-only)');

  const targets: { label: string; dbPath: string }[] = [];

  if (EXPLICIT_DB) {
    targets.push({ label: 'EXPLICIT TARGET', dbPath: path.resolve(EXPLICIT_DB) });
  } else {
    const runtime = runtimeDbPath();
    if (runtime) {
      targets.push({ label: 'RUNTIME DB (%APPDATA%\\ALUMFAB-POS\\database\\pos.db)', dbPath: runtime });
    } else {
      console.log('\n  APPDATA is not set — this looks like a non-Windows shell.');
      console.log('  Pass a path explicitly:  npm run db:repair -- --db /path/to/pos.db');
    }
    if (ALL) {
      targets.push({
        label: 'TEMPLATE DB (prisma/pos.db, shipped with the installer)',
        dbPath: path.join(process.cwd(), 'prisma', 'pos.db')
      });
    }
  }

  if (targets.length === 0) {
    process.exit(1);
  }

  let allOk = true;
  for (const t of targets) {
    const ok = await inspect(t.label, t.dbPath);
    allOk = allOk && ok;
  }

  console.log(allOk ? '\nDone — no unresolved problems.\n' : '\nDone — unresolved problems remain. See above.\n');
  process.exit(allOk ? 0 : 1);
}

void main();
