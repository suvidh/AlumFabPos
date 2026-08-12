/**
 * scripts/patch-company-profile.ts
 * =============================================================================
 * Backfills the registered ALUMFAB Hardware business details — GSTIN, phone,
 * address, state, website — onto the Company and Branch rows of an already
 * seeded database.
 *
 *   npm run company:patch                 # show what would change, read-only
 *   npm run company:patch -- --apply      # back up, then write the values
 *   npm run company:patch -- --db "D:\pos.db" --apply
 *
 * WHY THIS EXISTS
 * ---------------
 * `CompanyService.getCompany()` only seeds a Company/Branch row the first
 * time it is ever called (`if (!company)`). A database that already has one —
 * every shop that installed the app before this fix — will never pick up
 * updated seed defaults on its own. `printService.ts` already falls back to
 * these same values when a snapshot field is blank, so invoices print
 * correctly regardless; this script is what makes the underlying Company /
 * Branch records (and anything else that reads them, e.g. a future Settings
 * screen) correct too, and it's what future sales snapshot from at print time.
 *
 * SAFETY
 * ------
 *   - Default mode is read-only. Nothing changes without --apply.
 *   - --apply always snapshots the database (plus -wal/-shm) first.
 *   - Only fills fields that are currently NULL or empty — never overwrites a
 *     value someone already entered (e.g. via Settings), so this is safe to
 *     run more than once and safe to run on a shop that customized its data.
 */

import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const dbFlagIndex = argv.indexOf('--db');
const EXPLICIT_DB = dbFlagIndex >= 0 ? argv[dbFlagIndex + 1] : null;

// Source: ALUMFAB dealer letterhead / delivery challan.
const PATCH = {
  gstin: '24ABOPK8064H1ZD',
  phone: '9824157960',
  email: 'teamalumfab@gmail.com',
  state: 'Gujarat',
  address: 'Shop No. 2, Kalindi Apartment, Nr. Sharda Hospital Circle, Majura Gate Road, Surat - 395002'
};

function runtimeDbPath(): string | null {
  if (EXPLICIT_DB) return path.resolve(EXPLICIT_DB);
  const appData = process.env.APPDATA;
  return appData ? path.join(appData, 'ALUMFAB-POS', 'database', 'pos.db') : null;
}

function backupDirFor(dbPath: string): string {
  const appData = process.env.APPDATA;
  return appData ? path.join(appData, 'ALUMFAB-POS', 'backups') : path.join(path.dirname(dbPath), 'backups');
}

function snapshot(dbPath: string): string {
  const dir = backupDirFor(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(dir, `PRE-COMPANY-PATCH-${stamp}.db`);
  fs.copyFileSync(dbPath, target);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, target + suffix);
  }
  return target;
}

async function main() {
  const dbPath = runtimeDbPath();
  console.log('\nALUMFAB POS — company profile patch');
  console.log(APPLY ? 'MODE: APPLY (changes will be made, after a backup)' : 'MODE: CHECK (read-only)');

  if (!dbPath) {
    console.error(
      '\n  APPDATA is not set. Pass a path explicitly:\n    npm run company:patch -- --db /path/to/pos.db\n'
    );
    process.exit(1);
  }
  if (!fs.existsSync(dbPath)) {
    console.error(`\n  Database not found at ${dbPath}\n`);
    process.exit(1);
  }
  console.log(`  Target: ${dbPath}\n`);

  const client = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

  try {
    await client.$connect();

    const company = await client.company.findFirst({ include: { branches: true } });
    if (!company) {
      console.log('  No Company row yet — nothing to patch. It will be seeded correctly on next app launch.\n');
      return;
    }

    const companyChanges: Record<string, string> = {};
    if (!company.taxId) companyChanges.taxId = PATCH.gstin;
    if (!company.phone) companyChanges.phone = PATCH.phone;
    if (!company.email) companyChanges.email = PATCH.email;
    if (!company.state) companyChanges.state = PATCH.state;
    if (!company.address) companyChanges.address = PATCH.address;

    const branchChanges = new Map<string, Record<string, string>>();
    for (const branch of company.branches) {
      const changes: Record<string, string> = {};
      if (!branch.gstin) changes.gstin = PATCH.gstin;
      if (!branch.phone) changes.phone = PATCH.phone;
      if (!branch.state) changes.state = PATCH.state;
      if (!branch.address) changes.address = PATCH.address;
      if (Object.keys(changes).length > 0) branchChanges.set(branch.id, changes);
    }

    const totalChanges = Object.keys(companyChanges).length + branchChanges.size;
    if (totalChanges === 0) {
      console.log('  Every field is already filled in — nothing to patch.\n');
      return;
    }

    console.log('  Changes that would be made:');
    if (Object.keys(companyChanges).length > 0) {
      console.log(`    Company "${company.name}":`);
      for (const [k, v] of Object.entries(companyChanges)) console.log(`      ${k}: (blank) -> ${v}`);
    }
    for (const branch of company.branches) {
      const changes = branchChanges.get(branch.id);
      if (!changes) continue;
      console.log(`    Branch "${branch.name}" (${branch.code}):`);
      for (const [k, v] of Object.entries(changes)) console.log(`      ${k}: (blank) -> ${v}`);
    }

    if (!APPLY) {
      console.log('\n  Read-only mode. Re-run with --apply to make these changes.\n');
      return;
    }

    const backup = snapshot(dbPath);
    console.log(`\n  Backup written: ${backup}`);

    if (Object.keys(companyChanges).length > 0) {
      await client.company.update({ where: { id: company.id }, data: companyChanges });
      console.log(`  Updated Company "${company.name}".`);
    }
    for (const [branchId, changes] of branchChanges) {
      const branch = company.branches.find((b) => b.id === branchId)!;
      await client.branch.update({ where: { id: branchId }, data: changes });
      console.log(`  Updated Branch "${branch.name}".`);
    }

    console.log(
      '\n  Done. New sales will snapshot these values onto their invoices automatically.\n' +
        '  Existing invoices already printed keep their original snapshot, but ' +
        'printService.ts falls back to the same details for them, so they display correctly too.\n'
    );
  } finally {
    await client.$disconnect();
  }
}

void main();
