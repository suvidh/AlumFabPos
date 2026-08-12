/**
 * scripts/force-migrate-runtime.ts
 * =============================================================================
 * Bring the runtime database at %APPDATA%\ALUMFAB-POS\database\pos.db up to the
 * current Prisma schema — including whole missing tables — in one operation.
 *
 *   npm run db:force-migrate                 # show the SQL, change nothing
 *   npm run db:force-migrate -- --apply      # back up, apply, verify
 *   npm run db:force-migrate -- --apply --fallback-push
 *   npm run db:force-migrate -- --db "D:\pos.db" --apply
 *
 * HOW IT WORKS
 * ------------
 * 1. Snapshot the database (plus -wal/-shm, and a pos.db.bak beside it).
 * 2. `prisma migrate diff --from-url <runtime> --to-schema-datamodel` — this
 *    asks Prisma's own schema engine for the exact SQL that closes the gap.
 *    Auditable, and you see every statement before it runs.
 * 3. Refuse to continue if that SQL contains anything destructive, unless
 *    --allow-destructive is passed. A DROP against a live sales ledger should
 *    never happen because someone typed a convenience command.
 * 4. Apply it with foreign_keys=OFF, then PRAGMA foreign_key_check.
 * 5. Re-analyse with the same guard the app uses, and report 0 blocking /
 *    0 additive.
 * 6. Mark 0_baseline as applied so future `prisma migrate deploy` works.
 *
 * WHY NOT JUST `prisma db push`
 * -----------------------------
 * `db push` is available here via --fallback-push, and it is the documented
 * quick fix. It is second choice because on SQLite it applies some changes by
 * rebuilding the table — CREATE new_Table, INSERT ... SELECT, DROP old, RENAME.
 * That rewrites live sales data to add a column. For purely additive drift the
 * result is the same, but "the result is usually the same" is not the standard
 * to hold a shop's ledger to. It also leaves _prisma_migrations untouched, so
 * migration history stays broken.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { analyseDrift, formatReport } from '../electron/services/schema-drift';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const FALLBACK_PUSH = argv.includes('--fallback-push');
const ALLOW_DESTRUCTIVE = argv.includes('--allow-destructive');
const dbFlag = argv.indexOf('--db');
const EXPLICIT_DB = dbFlag >= 0 ? argv[dbFlag + 1] : null;

const SCHEMA = path.join(process.cwd(), 'prisma', 'schema.prisma');

/** Statement shapes that can lose data. Presence of any blocks an auto-apply. */
const DESTRUCTIVE = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\b/i,
  // Prisma's SQLite table-rebuild idiom: new_X is created, rows copied, old dropped.
  /\bALTER\s+TABLE\s+["`]?new_/i
];

function runtimeDbPath(): string {
  if (EXPLICIT_DB) return path.resolve(EXPLICIT_DB);
  const appData = process.env.APPDATA;
  if (!appData) {
    console.error(
      '\nAPPDATA is not set, so the runtime database cannot be located.\n' +
        'This script is meant to run in a Windows shell. Pass a path explicitly:\n' +
        '  npm run db:force-migrate -- --db "C:\\path\\to\\pos.db"\n'
    );
    process.exit(1);
  }
  return path.join(appData, 'ALUMFAB-POS', 'database', 'pos.db');
}

function backupDirFor(dbPath: string): string {
  const appData = process.env.APPDATA;
  return appData
    ? path.join(appData, 'ALUMFAB-POS', 'backups')
    : path.join(path.dirname(dbPath), 'backups');
}

function snapshot(dbPath: string): string {
  const dir = backupDirFor(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(dir, `PRE-FORCE-MIGRATE-${stamp}.db`);

  fs.copyFileSync(dbPath, target);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, target + suffix);
  }
  fs.copyFileSync(dbPath, `${dbPath}.bak`);
  return target;
}

function restore(backup: string, dbPath: string): void {
  fs.copyFileSync(backup, dbPath);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(backup + suffix)) fs.copyFileSync(backup + suffix, dbPath + suffix);
    else if (fs.existsSync(dbPath + suffix)) fs.rmSync(dbPath + suffix, { force: true });
  }
}

function prisma(args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync('npx', ['prisma', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    shell: process.platform === 'win32'
  });
}

/** SQLite paths must be forward-slashed and URL-safe inside a file: URL. */
function fileUrl(p: string): string {
  return `file:${p.replace(/\\/g, '/')}`;
}

// ---------------------------------------------------------------------------

async function main() {
  const dbPath = runtimeDbPath();
  const url = fileUrl(dbPath);

  console.log('\nALUMFAB POS — force-migrate runtime database');
  console.log('='.repeat(72));
  console.log(`  Target : ${dbPath}`);
  console.log(`  Schema : ${SCHEMA}`);
  console.log(`  Mode   : ${APPLY ? 'APPLY (changes will be made, after a backup)' : 'DRY RUN (read-only)'}`);
  console.log('='.repeat(72));

  if (!fs.existsSync(dbPath)) {
    console.error(
      `\n  Database not found.\n\n  If this terminal has never run the app, just launch it — ` +
        `DatabaseService.bootstrap() copies the template on first start.\n`
    );
    process.exit(1);
  }
  if (!fs.existsSync(SCHEMA)) {
    console.error(`\n  prisma/schema.prisma not found. Run this from the project root.\n`);
    process.exit(1);
  }
  console.log(`  Size   : ${Math.round(fs.statSync(dbPath).size / 1024)} KB\n`);

  // ---- 1. What is actually wrong? ----------------------------------------
  console.log('Step 1 — analysing drift with the same guard the app uses\n');
  {
    const client = new PrismaClient({ datasources: { db: { url } } });
    try {
      await client.$connect();
      const report = await analyseDrift(client);
      console.log(formatReport(report).split('\n').map((l) => `  ${l}`).join('\n'));
      if (report.ok) {
        console.log('\n  Nothing to do — this database already matches the schema.\n');
        await client.$disconnect();
        process.exit(0);
      }
      const tables = report.items.filter((i) => i.kind === 'missing-table').length;
      const columns = report.items.filter((i) => i.kind === 'missing-column').length;
      console.log(`\n  Summary: ${tables} missing table(s), ${columns} missing column(s).`);
    } finally {
      await client.$disconnect();
    }
  }

  // ---- 2. Ask Prisma for the exact SQL -----------------------------------
  console.log('\nStep 2 — generating migration SQL (prisma migrate diff)\n');
  let sql = '';
  let usedFallback = false;

  try {
    sql = prisma([
      'migrate',
      'diff',
      '--from-url',
      url,
      '--to-schema-datamodel',
      SCHEMA,
      '--script'
    ]).trim();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  migrate diff failed:\n    ${message.split('\n').slice(0, 4).join('\n    ')}`);

    if (!FALLBACK_PUSH) {
      console.error(
        '\n  Re-run with --fallback-push to use `prisma db push` instead.\n' +
          '  Note that db push may rebuild tables to apply changes, which rewrites\n' +
          '  existing rows. A backup is still taken first.\n'
      );
      process.exit(1);
    }
    usedFallback = true;
  }

  if (!usedFallback) {
    if (!sql) {
      console.log('  Prisma reports no schema difference. Nothing to apply.\n');
      process.exit(0);
    }
    console.log(sql.split('\n').map((l) => `  ${l}`).join('\n'));

    // ---- 3. Destructive statement gate -----------------------------------
    const dangerous = DESTRUCTIVE.filter((re) => re.test(sql));
    if (dangerous.length > 0 && !ALLOW_DESTRUCTIVE) {
      console.error(
        '\n' +
          '  REFUSING TO APPLY — the generated SQL contains destructive statements.\n\n' +
          '  This is not the additive gap the guard reported, which means the schema and\n' +
          '  this database have diverged in a way that needs a human decision about what\n' +
          '  happens to existing rows.\n\n' +
          '  Review the SQL above. If it is genuinely safe, re-run with --allow-destructive.\n'
      );
      process.exit(1);
    }
  }

  if (!APPLY) {
    console.log('\n  Dry run. Re-run with --apply to make these changes.\n');
    process.exit(0);
  }

  // ---- 4. Back up ---------------------------------------------------------
  console.log('\nStep 3 — safety backup\n');
  const backup = snapshot(dbPath);
  console.log(`  ${backup}`);
  console.log(`  ${dbPath}.bak`);

  // ---- 5. Apply -----------------------------------------------------------
  console.log('\nStep 4 — applying\n');

  if (usedFallback) {
    console.log('  Using `prisma db push` (fallback path).');
    try {
      const out = prisma(['db', 'push', '--skip-generate', '--accept-data-loss'], { DATABASE_URL: url });
      console.log(out.split('\n').map((l) => `    ${l}`).join('\n'));
    } catch (err: unknown) {
      console.error(`  db push failed: ${err instanceof Error ? err.message : String(err)}`);
      restore(backup, dbPath);
      console.error(`  Database restored from ${backup}\n`);
      process.exit(1);
    }
  } else {
    const client = new PrismaClient({ datasources: { db: { url } } });
    try {
      await client.$connect();
      await client.$executeRawUnsafe('PRAGMA foreign_keys=OFF');

      // Statement by statement so a failure names the exact line.
      const statements = sql
        .split(/;\s*$/m)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('--'));

      for (const stmt of statements) {
        await client.$executeRawUnsafe(stmt);
        console.log(`    ok: ${stmt.replace(/\s+/g, ' ').slice(0, 120)}`);
      }

      const violations = await client.$queryRawUnsafe<{ table: string; parent: string }[]>(
        'PRAGMA foreign_key_check'
      );
      await client.$executeRawUnsafe('PRAGMA foreign_keys=ON');

      if (violations.length > 0) {
        console.error(`\n  foreign_key_check found ${violations.length} broken reference(s):`);
        for (const v of violations.slice(0, 10)) console.error(`    ${v.table} -> missing ${v.parent}`);
        await client.$disconnect();
        restore(backup, dbPath);
        console.error(`\n  Database restored from ${backup}\n`);
        process.exit(1);
      }
    } catch (err: unknown) {
      console.error(`\n  Apply failed: ${err instanceof Error ? err.message : String(err)}`);
      await client.$disconnect();
      restore(backup, dbPath);
      console.error(`  Database restored from ${backup}\n`);
      process.exit(1);
    } finally {
      await client.$disconnect();
    }
  }

  // ---- 6. Verify with the app's own guard ---------------------------------
  console.log('\nStep 5 — verifying\n');
  {
    const client = new PrismaClient({ datasources: { db: { url } } });
    try {
      await client.$connect();
      const after = await analyseDrift(client);
      console.log(formatReport(after).split('\n').map((l) => `  ${l}`).join('\n'));

      if (!after.ok) {
        console.error(
          `\n  Drift remains after migrating. The database has NOT been reverted;\n` +
            `  a pre-change snapshot is at:\n    ${backup}\n`
        );
        process.exit(1);
      }
      console.log(`\n  0 blocking, 0 additive. Schema is current.`);
    } finally {
      await client.$disconnect();
    }
  }

  // ---- 7. Repair migration history ---------------------------------------
  // Without this, the next `migrate deploy` sees no _prisma_migrations rows and
  // tries to CREATE TABLE over live data.
  console.log('\nStep 6 — marking baseline migration as applied\n');
  try {
    prisma(['migrate', 'resolve', '--applied', '0_baseline'], { DATABASE_URL: url });
    console.log('  0_baseline recorded in _prisma_migrations.');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Already recorded is the common, harmless case.
    if (/already recorded|already applied/i.test(message)) {
      console.log('  0_baseline was already recorded.');
    } else {
      console.log(
        `  Could not record the baseline (${message.split('\n')[0]}).\n` +
          '  Not fatal — the schema is correct. Run this before the next release:\n' +
          '    npx prisma migrate resolve --applied 0_baseline'
      );
    }
  }

  console.log('\nDone. Launch the app — SchemaGuard should pass silently.\n');
}

void main();
