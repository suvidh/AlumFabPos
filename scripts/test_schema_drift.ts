/**
 * scripts/test_schema_drift.ts
 * =============================================================================
 * Proves the drift guard against a database that is deliberately behind the
 * schema — the exact condition that produced
 *
 *   "Transaction rolled back: Invalid `prisma.product.update()` invocation:
 *    The column 'costPricePaise' does not exist in the current database."
 *
 * Run:  node --experimental-sqlite -r esbuild-register scripts/test_schema_drift.ts
 *   or: npm run test:drift
 *
 * WHY A FAKE CLIENT
 * -----------------
 * `analyseDrift` and `applyRepair` only ever call `$queryRawUnsafe` and
 * `$executeRawUnsafe`. Backing those two methods with `node:sqlite` lets the
 * test run anywhere — including CI containers and the Linux build box — with no
 * Prisma query engine and no Windows dependency. The SQL under test is byte for
 * byte what production executes.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { PrismaClient } from '@prisma/client';
import { analyseDrift, applyRepair, formatReport } from '../electron/services/schema-drift';

const TEMPLATE = path.join(process.cwd(), 'prisma', 'pos.db');
const WORKDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'alumfab-drift-'));

let failures = 0;
function check(label: string, condition: boolean | (() => boolean), detail = '') {
  const ok = typeof condition === 'function' ? condition() : condition;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/** Minimal PrismaClient stand-in: only the two raw methods are exercised. */
function fakeClient(db: DatabaseSync): PrismaClient {
  return {
    $queryRawUnsafe: async (sql: string) => db.prepare(sql).all(),
    $executeRawUnsafe: async (sql: string) => {
      db.exec(sql);
      return 0;
    }
  } as unknown as PrismaClient;
}

function seedProducts(db: DatabaseSync, n = 2) {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO Product (id, sku, name, sellingUnit, sellingPricePaise, taxPercentage,
       minimumStockMilli, isActive, isDeleted, createdAt, updatedAt)
     VALUES (?, ?, ?, 'PCS', ?, 18.0, 0, 1, 0, ?, ?)`
  );
  for (let i = 1; i <= n; i++) {
    stmt.run(`p-test-${i}`, `TEST-SKU-${i}`, `Test Product ${i}`, 48500 + i, now, now);
  }
}

async function main() {
  console.log('\n=== ALUMFAB POS — schema drift guard ===\n');

  // ---------------------------------------------------------------------
  // Case 1: a healthy database must report no drift at all.
  // ---------------------------------------------------------------------
  console.log('Case 1: current template database');
  {
    const p = path.join(WORKDIR, 'healthy.db');
    fs.copyFileSync(TEMPLATE, p);
    const db = new DatabaseSync(p);
    const report = await analyseDrift(fakeClient(db));
    check('no drift detected', report.ok, formatReport(report).split('\n')[0]);
    check('nothing classified as blocking', report.blocking.length === 0);
    db.close();
  }

  // ---------------------------------------------------------------------
  // Case 2: the reported production bug — Product.costPricePaise missing.
  // ---------------------------------------------------------------------
  console.log('\nCase 2: stale database missing Product.costPricePaise');
  {
    const p = path.join(WORKDIR, 'stale.db');
    fs.copyFileSync(TEMPLATE, p);
    const db = new DatabaseSync(p);
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('ALTER TABLE "Product" DROP COLUMN "costPricePaise"');
    seedProducts(db, 2);

    const before = db.prepare('SELECT COUNT(*) c FROM Product').get() as { c: number };

    const client = fakeClient(db);
    const report = await analyseDrift(client);

    check('drift detected', !report.ok);
    check('classified repairable (no blocking items)', report.repairable, `blocking=${report.blocking.length}`);
    check(
      'costPricePaise identified',
      report.additive.some((i) => i.table === 'Product' && i.column === 'costPricePaise')
    );

    const stmt = report.repairSql.find((s) => s.includes('costPricePaise'));
    check('generated NOT NULL DEFAULT 0', !!stmt && /NOT NULL DEFAULT 0/.test(stmt), stmt);

    const result = await applyRepair(client, report);
    check('repair applied cleanly', result.failed.length === 0, JSON.stringify(result.failed));

    const after = await analyseDrift(client);
    check('database now matches the schema', after.ok, formatReport(after).split('\n')[0]);

    // The whole point: existing rows survive and get the default.
    const rows = db.prepare('SELECT sku, costPricePaise FROM Product ORDER BY sku').all() as {
      sku: string;
      costPricePaise: number;
    }[];
    check('no rows lost', rows.length === before.c, `${before.c} -> ${rows.length}`);
    check('existing rows defaulted to 0', rows.every((r) => r.costPricePaise === 0));

    // Simulate what the ODS import does: update a product, then read it back
    // with the full column list. This is the exact query shape that threw P2022.
    db.prepare('UPDATE Product SET name = ?, sellingPricePaise = ? WHERE sku = ?').run(
      'Renamed by import',
      50000,
      'TEST-SKU-1'
    );
    const readBack = db
      .prepare('SELECT sku, name, sellingPricePaise, costPricePaise FROM Product WHERE sku = ?')
      .get('TEST-SKU-1') as { name: string; costPricePaise: number };
    check('import-style update + read-back succeeds', readBack.name === 'Renamed by import');
    check('costPricePaise readable after repair', readBack.costPricePaise === 0);

    db.close();
  }

  // ---------------------------------------------------------------------
  // Case 3: nullable column missing — must add without NOT NULL.
  // ---------------------------------------------------------------------
  console.log('\nCase 3: stale database missing an optional column (Product.brand)');
  {
    const p = path.join(WORKDIR, 'optional.db');
    fs.copyFileSync(TEMPLATE, p);
    const db = new DatabaseSync(p);
    db.exec('ALTER TABLE "Product" DROP COLUMN "brand"');
    const client = fakeClient(db);
    const report = await analyseDrift(client);
    const stmt = report.repairSql.find((s) => s.includes('"brand"'));
    check('brand identified as additive', !!stmt, stmt);
    check('added as nullable, no NOT NULL', !!stmt && !/NOT NULL/.test(stmt));
    check('repair succeeds', (await applyRepair(client, report)).failed.length === 0);
    check('clean afterwards', (await analyseDrift(client)).ok);
    db.close();
  }

  // ---------------------------------------------------------------------
  // Case 4a: a missing table IS repairable — but only from recorded DDL,
  // never improvised.
  // ---------------------------------------------------------------------
  console.log('\nCase 4a: missing table, recorded DDL available');
  {
    const p = path.join(WORKDIR, 'notable.db');
    fs.copyFileSync(TEMPLATE, p);
    const db = new DatabaseSync(p);
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('DROP TABLE "Expense"');

    const client = fakeClient(db);
    const report = await analyseDrift(client);
    check('classified additive', report.additive.some((i) => i.table === 'Expense'));
    check('no blocking items', report.blocking.length === 0);
    check('DDL came from the migrations directory', report.ddlSource !== null, String(report.ddlSource));
    check('CREATE TABLE emitted', report.repairSql.some((s) => /^CREATE TABLE\s+"Expense"/.test(s)));

    const result = await applyRepair(client, report);
    check('repair applied', result.failed.length === 0);
    check('clean afterwards', (await analyseDrift(client)).ok);

    // The recreated table must carry its foreign keys, not just its columns.
    const fks = db.prepare('PRAGMA foreign_key_list("Expense")').all();
    check('foreign keys restored', fks.length > 0, `${fks.length} FK(s)`);
    db.close();
  }

  // ---------------------------------------------------------------------
  // Case 4b: no catalog means no guessing. Still blocks.
  // ---------------------------------------------------------------------
  console.log('\nCase 4b: missing table, NO recorded DDL (migrations resource absent)');
  {
    const p = path.join(WORKDIR, 'notable-nocatalog.db');
    fs.copyFileSync(TEMPLATE, p);
    const db = new DatabaseSync(p);
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('DROP TABLE "Expense"');

    const report = await analyseDrift(fakeClient(db), { catalog: { tables: new Map(), root: null } });
    check('reported as blocking', report.blocking.some((i) => i.table === 'Expense'));
    check('not auto-repairable', !report.repairable);
    check('no SQL improvised', !report.repairSql.some((s) => s.includes('Expense')));
    db.close();
  }

  // ---------------------------------------------------------------------
  // Case 5: an unknown extra column is informational, not an error.
  // ---------------------------------------------------------------------
  console.log('\nCase 5: database has a column the schema does not know about');
  {
    const p = path.join(WORKDIR, 'extra.db');
    fs.copyFileSync(TEMPLATE, p);
    const db = new DatabaseSync(p);
    db.exec('ALTER TABLE "Product" ADD COLUMN "legacyCostRupees" REAL');
    const report = await analyseDrift(fakeClient(db));
    check('not blocking', report.blocking.length === 0);
    check('reported as info', report.items.some((i) => i.severity === 'info' && i.column === 'legacyCostRupees'));
    db.close();
  }

  // ---------------------------------------------------------------------
  // Case 6: the reported production state — 10 missing tables AND missing
  // columns at once, on a database holding real rows.
  // ---------------------------------------------------------------------
  console.log('\nCase 6: 10 missing tables + missing columns (the reported field state)');
  {
    const p = path.join(WORKDIR, 'ancient.db');
    fs.copyFileSync(TEMPLATE, p);
    const db = new DatabaseSync(p);
    db.exec('PRAGMA foreign_keys=OFF');

    // Tables added after this terminal's build was cut.
    const dropped = [
      'ProductBranchBarcode',
      'PurchaseOrder',
      'PurchaseOrderItem',
      'GoodsReceivedNote',
      'GRNItem',
      'CustomerLedger',
      'CashShift',
      'SalesReturn',
      'SalesReturnItem',
      'VoidAuditLog'
    ];
    for (const t of dropped) db.exec(`DROP TABLE IF EXISTS "${t}"`);

    // Seed BEFORE removing columns, so the rows look like what an older build
    // would actually have written.
    seedProducts(db, 3);

    // Columns added after that build.
    for (const c of ['costPricePaise', 'taxPercentage', 'isDeleted', 'brand', 'finish']) {
      db.exec(`ALTER TABLE "Product" DROP COLUMN "${c}"`);
    }

    const client = fakeClient(db);
    const report = await analyseDrift(client);

    check(
      `all ${dropped.length} tables detected`,
      dropped.every((t) => report.items.some((i) => i.kind === 'missing-table' && i.table === t))
    );
    check('tables classified additive, not blocking', report.blocking.length === 0, formatReport(report));
    check('recorded DDL located', report.ddlSource !== null, String(report.ddlSource));

    // Ordering matters for the foreign_key_check to mean anything.
    const createOrder = report.repairSql
      .map((s) => /^CREATE TABLE\s+"?([A-Za-z0-9_]+)"?/.exec(s)?.[1])
      .filter(Boolean) as string[];
    check('CREATE TABLE emitted before ALTER TABLE', () => {
      const firstAlter = report.repairSql.findIndex((s) => s.startsWith('ALTER TABLE'));
      const lastCreate = report.repairSql.map((s) => s.startsWith('CREATE TABLE')).lastIndexOf(true);
      return firstAlter === -1 || lastCreate < firstAlter;
    });
    check(
      'PurchaseOrder created before PurchaseOrderItem that references it',
      createOrder.indexOf('PurchaseOrder') < createOrder.indexOf('PurchaseOrderItem'),
      createOrder.join(' -> ')
    );

    const result = await applyRepair(client, report);
    check('repair applied cleanly', result.failed.length === 0, JSON.stringify(result.failed.slice(0, 2)));
    check('no foreign key violations', result.foreignKeyViolations.length === 0);

    const after = await analyseDrift(client);
    check('0 blocking, 0 additive remaining', after.ok, formatReport(after).split('\n')[0]);

    // Foreign keys must actually be enforceable afterwards, not just present.
    db.exec('PRAGMA foreign_keys=ON');
    const fk = db.prepare('PRAGMA foreign_key_check').all();
    check('database-wide foreign_key_check clean', fk.length === 0, `${fk.length} violation(s)`);

    // The recreated tables must be usable, not merely present. Seed the parent
    // rows a real terminal would have, then exercise a child insert.
    const now2 = new Date().toISOString();
    db.prepare(
      `INSERT INTO "Company" ("id","name","isActive","createdAt","updatedAt")
       VALUES ('co-1','ALUMFAB Hardware',1,?,?)`
    ).run(now2, now2);
    db.prepare(
      `INSERT INTO "Branch" ("id","companyId","code","name","isActive","isDeleted","createdAt","updatedAt")
       VALUES ('br-1','co-1','MAIN','Main Counter',1,0,?,?)`
    ).run(now2, now2);

    const product = db.prepare('SELECT id FROM Product LIMIT 1').get() as { id: string };

    db.prepare(
      `INSERT INTO "ProductBranchBarcode" ("productId","branchId","barcode")
       VALUES (?, 'br-1', 'TEST-BARCODE-1')`
    ).run(product.id);
    check(
      'recreated table accepts a valid insert',
      (db.prepare('SELECT COUNT(*) c FROM "ProductBranchBarcode"').get() as { c: number }).c === 1
    );

    // And the restored foreign key must actually bite.
    let rejected = false;
    try {
      db.prepare(
        `INSERT INTO "ProductBranchBarcode" ("productId","branchId","barcode")
         VALUES ('no-such-product', 'br-1', 'TEST-BARCODE-2')`
      ).run();
    } catch {
      rejected = true;
    }
    check('foreign key constraint is enforced on the recreated table', rejected);

    // Composite primary key must have survived too.
    let dupRejected = false;
    try {
      db.prepare(
        `INSERT INTO "ProductBranchBarcode" ("productId","branchId","barcode")
         VALUES (?, 'br-1', 'TEST-BARCODE-1')`
      ).run(product.id);
    } catch {
      dupRejected = true;
    }
    check('composite primary key enforced', dupRejected);

    // Finally: the exact ODS UPDATE_EXISTING shape that started all of this.
    db.prepare('UPDATE Product SET name = ?, sellingPricePaise = ? WHERE sku = ?').run(
      'Updated by ODS import',
      52000,
      'TEST-SKU-1'
    );
    const row = db
      .prepare('SELECT name, costPricePaise, taxPercentage, isDeleted FROM Product WHERE sku = ?')
      .get('TEST-SKU-1') as { name: string; costPricePaise: number; isDeleted: number };
    check('ODS-style update + full-column read-back succeeds', row.name === 'Updated by ODS import');
    check('restored columns hold their defaults', row.costPricePaise === 0 && row.isDeleted === 0);
    check('all 3 seeded rows survived', (db.prepare('SELECT COUNT(*) c FROM Product').get() as { c: number }).c === 3);

    db.close();
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  fs.rmSync(WORKDIR, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

void main();
