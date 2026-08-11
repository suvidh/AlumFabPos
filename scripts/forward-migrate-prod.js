/**
 * forward-migrate-prod.js
 *
 * Safe forward migration for ALUMFAB POS production database.
 * Adds Phase 2 tables (Supplier, Purchase, PurchaseItem, Expense)
 * that are present in the schema but missing from the older production DB.
 *
 * SAFETY RULES:
 *  - Uses IF NOT EXISTS — will never touch tables that already exist
 *  - No DROP statements
 *  - No data is deleted or modified
 *  - Creates a backup snapshot before migrating
 */

const fs   = require('fs');
const path = require('path');

const PROD_DB = path.join(process.env.APPDATA, 'ALUMFAB-POS', 'database', 'pos.db');
const BACKUP_DIR = path.join(process.env.APPDATA, 'ALUMFAB-POS', 'backups');

function pad(n) { return String(n).padStart(2, '0'); }

function getTimestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
       + `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function run() {
  console.log('\n════════════════════════════════════════════════════════');
  console.log('  ALUMFAB POS — FORWARD MIGRATION (Phase 2 Tables)');
  console.log('════════════════════════════════════════════════════════\n');

  if (!fs.existsSync(PROD_DB)) {
    console.log('❌ Production DB not found at:', PROD_DB);
    process.exit(1);
  }

  // ── Step 1: Pre-migration safety backup ────────────────────────────────
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  const backupName = `PRE-MIGRATION-${getTimestamp()}.db`;
  const backupPath = path.join(BACKUP_DIR, backupName);
  fs.copyFileSync(PROD_DB, backupPath);
  const backupSize = Math.round(fs.statSync(backupPath).size / 1024);
  console.log(`✅ Pre-migration safety backup created:`);
  console.log(`   ${backupPath} (${backupSize} KB)\n`);

  // ── Step 2: Open SQLite with better-sqlite3 ─────────────────────────────
  // Use the bundled sqlite3 from Prisma's dependencies
  let Database;
  try {
    // Try better-sqlite3 first (available in electron projects)
    Database = require('better-sqlite3');
  } catch {
    console.log('better-sqlite3 not available, using @prisma/client raw queries approach...');
    runWithPrisma();
    return;
  }

  const db = new Database(PROD_DB);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');

  const existingTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all().map(r => r.name);

  console.log('Existing tables:', existingTables.join(', '));

  const migrations = [];

  if (!existingTables.includes('Supplier')) {
    migrations.push({
      name: 'Supplier',
      sql: `CREATE TABLE IF NOT EXISTS "Supplier" (
        "id"        TEXT NOT NULL PRIMARY KEY,
        "name"      TEXT NOT NULL,
        "phone"     TEXT,
        "address"   TEXT,
        "gstin"     TEXT,
        "notes"     TEXT,
        "isActive"  INTEGER NOT NULL DEFAULT 1,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      )`
    });
  }

  if (!existingTables.includes('Purchase')) {
    migrations.push({
      name: 'Purchase',
      sql: `CREATE TABLE IF NOT EXISTS "Purchase" (
        "id"              TEXT NOT NULL PRIMARY KEY,
        "branchId"        TEXT NOT NULL,
        "supplierId"      TEXT,
        "referenceNumber" TEXT,
        "date"            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "totalPaise"      INTEGER NOT NULL,
        "notes"           TEXT,
        "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"       DATETIME NOT NULL,
        CONSTRAINT "Purchase_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )`
    });
  }

  if (!existingTables.includes('PurchaseItem')) {
    migrations.push({
      name: 'PurchaseItem',
      sql: `CREATE TABLE IF NOT EXISTS "PurchaseItem" (
        "id"             TEXT NOT NULL PRIMARY KEY,
        "purchaseId"     TEXT NOT NULL,
        "productId"      TEXT NOT NULL,
        "quantityMilli"  INTEGER NOT NULL,
        "ratePaise"      INTEGER NOT NULL,
        "lineTotalPaise" INTEGER NOT NULL,
        "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PurchaseItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )`
    });
  }

  if (!existingTables.includes('Expense')) {
    migrations.push({
      name: 'Expense',
      sql: `CREATE TABLE IF NOT EXISTS "Expense" (
        "id"                  TEXT NOT NULL PRIMARY KEY,
        "branchId"            TEXT NOT NULL,
        "date"                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "categoryDescription" TEXT NOT NULL,
        "amountPaise"         INTEGER NOT NULL,
        "notes"               TEXT,
        "createdAt"           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"           DATETIME NOT NULL,
        CONSTRAINT "Expense_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )`
    });
  }

  if (migrations.length === 0) {
    console.log('✅ No migrations needed — all tables already present\n');
    db.close();
    return;
  }

  // ── Step 3: Execute migrations in a transaction ──────────────────────────
  console.log(`Running ${migrations.length} migration(s)...\n`);

  const migrate = db.transaction(() => {
    for (const m of migrations) {
      db.prepare(m.sql).run();
      console.log(`  ✅ Created table: ${m.name}`);
    }
  });

  try {
    migrate();
    db.pragma('foreign_keys = ON');
    db.close();
    console.log('\n✅ Migration complete — all Phase 2 tables created\n');
  } catch (e) {
    console.error('\n❌ Migration failed:', e.message);
    console.log('Restoring from backup...');
    fs.copyFileSync(backupPath, PROD_DB);
    console.log('✅ Backup restored. No changes were made to the production database.');
    process.exit(1);
  }
}

async function runWithPrisma() {
  // Fallback: use Prisma raw queries for migration
  const { PrismaClient } = require('@prisma/client');
  const client = new PrismaClient({ datasources: { db: { url: 'file:' + PROD_DB } } });
  await client.$connect();

  const tables = await client.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table'"
  );
  const tableNames = tables.map(t => t.name);

  const sqls = [];

  if (!tableNames.includes('Supplier')) {
    sqls.push(`CREATE TABLE IF NOT EXISTS "Supplier" (
      "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "phone" TEXT,
      "address" TEXT, "gstin" TEXT, "notes" TEXT, "isActive" INTEGER NOT NULL DEFAULT 1,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`);
  }
  if (!tableNames.includes('Purchase')) {
    sqls.push(`CREATE TABLE IF NOT EXISTS "Purchase" (
      "id" TEXT NOT NULL PRIMARY KEY, "branchId" TEXT NOT NULL, "supplierId" TEXT,
      "referenceNumber" TEXT, "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "totalPaise" INTEGER NOT NULL, "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`);
  }
  if (!tableNames.includes('PurchaseItem')) {
    sqls.push(`CREATE TABLE IF NOT EXISTS "PurchaseItem" (
      "id" TEXT NOT NULL PRIMARY KEY, "purchaseId" TEXT NOT NULL, "productId" TEXT NOT NULL,
      "quantityMilli" INTEGER NOT NULL, "ratePaise" INTEGER NOT NULL,
      "lineTotalPaise" INTEGER NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  }
  if (!tableNames.includes('Expense')) {
    sqls.push(`CREATE TABLE IF NOT EXISTS "Expense" (
      "id" TEXT NOT NULL PRIMARY KEY, "branchId" TEXT NOT NULL,
      "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "categoryDescription" TEXT NOT NULL, "amountPaise" INTEGER NOT NULL, "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`);
  }

  for (const sql of sqls) {
    await client.$executeRawUnsafe(sql);
    const tableName = sql.match(/CREATE TABLE IF NOT EXISTS "(\w+)"/)[1];
    console.log('  ✅ Created table:', tableName);
  }

  await client.$disconnect();
  console.log('\n✅ Migration complete (via Prisma fallback)\n');
}

run();
