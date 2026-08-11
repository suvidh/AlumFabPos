/**
 * db-audit-readonly.js
 * READ-ONLY inspection of both SQLite databases.
 * Zero writes. Zero schema changes. Zero pushes.
 */

const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs   = require('fs');

const TEMPLATE_DB = path.join(process.cwd(), 'prisma', 'pos.db');
const PROD_DB     = path.join(process.env.APPDATA, 'ALUMFAB-POS', 'database', 'pos.db');

const REQUIRED_BUSINESS_TABLES = [
  'AppMeta', 'Company', 'Branch', 'Category', 'Product',
  'BranchInventory', 'StockMovement', 'Customer',
  'Sale', 'SaleItem', 'Payment', 'InvoiceSequence',
  'AuditLog', 'BackupMetadata',
  'Supplier', 'Purchase', 'PurchaseItem', 'Expense'
];

function hr(char = '═', n = 62) { return char.repeat(n); }

async function auditDatabase(label, dbPath) {
  const result = {
    label,
    dbPath,
    exists: false,
    sizeKB: 0,
    tables: [],
    userTablePresent: null,
    missingTables: [],
    rowCounts: {},
    appMeta: null,
    integrity: null,
    fkViolations: null,
    issues: []
  };

  if (!fs.existsSync(dbPath)) {
    result.issues.push(`FILE NOT FOUND: ${dbPath}`);
    return result;
  }

  result.exists   = true;
  result.sizeKB   = Math.round(fs.statSync(dbPath).size / 1024);
  result.modified = fs.statSync(dbPath).mtime.toISOString();

  const client = new PrismaClient({
    datasources: { db: { url: 'file:' + dbPath } },
    log: []
  });

  try {
    await client.$connect();

    // ── Table inventory ────────────────────────────────────────────────────
    const raw = await client.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    result.tables = raw.map(r => r.name).filter(n => n !== 'sqlite_sequence');

    // ── User table check ───────────────────────────────────────────────────
    result.userTablePresent = result.tables.includes('User');
    if (result.userTablePresent) {
      const uc = await client.$queryRawUnsafe('SELECT COUNT(*) as c FROM "User"');
      result.userRowCount = Number(uc[0].c);
      result.issues.push(`User table still present (${result.userRowCount} rows)`);
    }

    // ── Missing business tables ────────────────────────────────────────────
    result.missingTables = REQUIRED_BUSINESS_TABLES.filter(
      t => !result.tables.includes(t)
    );

    // ── Row counts (read-only SELECT COUNT) ───────────────────────────────
    for (const t of REQUIRED_BUSINESS_TABLES) {
      if (!result.tables.includes(t)) {
        result.rowCounts[t] = 'TABLE MISSING';
        continue;
      }
      const res = await client.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "${t}"`);
      result.rowCounts[t] = Number(res[0].c);
    }

    // ── AppMeta ───────────────────────────────────────────────────────────
    if (result.tables.includes('AppMeta')) {
      const mrow = await client.$queryRawUnsafe('SELECT * FROM "AppMeta" WHERE id=1');
      result.appMeta = mrow.length ? mrow[0] : null;
    }

    // ── Sample spot-check: first Product row ──────────────────────────────
    if (result.tables.includes('Product') && result.rowCounts['Product'] > 0) {
      const p = await client.$queryRawUnsafe(
        'SELECT sku, name, sellingPricePaise, sellingUnit FROM "Product" LIMIT 3'
      );
      result.sampleProducts = p;
    }

    // ── SQLite PRAGMA integrity_check (read-only) ─────────────────────────
    const ic = await client.$queryRawUnsafe('PRAGMA integrity_check');
    result.integrity = ic[0]?.integrity_check ?? JSON.stringify(ic[0]);
    if (result.integrity !== 'ok') {
      result.issues.push(`integrity_check: ${result.integrity}`);
    }

    // ── SQLite PRAGMA foreign_key_check (read-only) ───────────────────────
    const fk = await client.$queryRawUnsafe('PRAGMA foreign_key_check');
    result.fkViolations = fk.length;
    if (fk.length > 0) {
      result.issues.push(`${fk.length} foreign key violation(s)`);
      result.fkDetail = fk;
    }

    // ── Quick_check (read-only) ───────────────────────────────────────────
    const qc = await client.$queryRawUnsafe('PRAGMA quick_check');
    result.quickCheck = qc[0]?.quick_check ?? JSON.stringify(qc[0]);

    await client.$disconnect();
  } catch (e) {
    result.issues.push(`EXCEPTION: ${e.message}`);
    try { await client.$disconnect(); } catch {}
  }

  return result;
}

function printAudit(r) {
  const tag = (ok) => ok ? '✅' : '❌';
  const pad = (s, n = 26) => String(s).padEnd(n);

  console.log(`\n${hr()}`);
  console.log(`  ${r.label}`);
  console.log(`  PATH:     ${r.dbPath}`);
  if (!r.exists) {
    console.log(`  ⚠️  FILE NOT FOUND — SKIPPING`);
    return;
  }
  console.log(`  SIZE:     ${r.sizeKB} KB`);
  console.log(`  MODIFIED: ${r.modified}`);
  console.log(hr());

  // Tables present
  console.log('\n  ALL SQLITE TABLES IN FILE:');
  r.tables.forEach(t => {
    const isAuth = t === 'User';
    const isReq  = REQUIRED_BUSINESS_TABLES.includes(t);
    const icon   = isAuth ? '🗑️ ' : isReq ? '✅' : '⬜';
    console.log(`    ${icon} ${t}`);
  });

  // User table
  console.log(`\n  User table present:     ${tag(!r.userTablePresent)} ${r.userTablePresent ? 'STILL EXISTS (' + r.userRowCount + ' rows)' : 'ABSENT — removed cleanly'}`);

  // Missing tables
  if (r.missingTables.length === 0) {
    console.log(`  Missing business tables: ✅ NONE — all ${REQUIRED_BUSINESS_TABLES.length} tables present`);
  } else {
    console.log(`  Missing business tables: ❌ ${r.missingTables.join(', ')}`);
  }

  // Row counts
  console.log('\n  ROW COUNTS (read-only SELECT COUNT):');
  for (const [t, cnt] of Object.entries(r.rowCounts)) {
    const ok = typeof cnt === 'number';
    const flag = !ok ? '❌' : cnt === 0 ? '⬜' : '✅';
    console.log(`    ${flag} ${pad(t)} ${cnt}`);
  }

  // AppMeta
  if (r.appMeta) {
    console.log(`\n  AppMeta row:            ✅ present`);
    console.log(`    id:            ${r.appMeta.id}`);
    console.log(`    schemaVersion: ${r.appMeta.schemaVersion}`);
    console.log(`    appVersion:    ${r.appMeta.appVersion}`);
  } else {
    const isTemplate = r.label.includes('TEMPLATE');
    console.log(`\n  AppMeta row:            ${isTemplate ? '⚠️  none (blank template — normal)' : '❌ MISSING'}`);
  }

  // Sample products
  if (r.sampleProducts) {
    console.log('\n  SAMPLE PRODUCTS (first 3):');
    r.sampleProducts.forEach(p =>
      console.log(`    SKU:${p.sku}  Unit:${p.sellingUnit}  Price:₹${(p.sellingPricePaise/100).toFixed(2)}  Name:${p.name}`)
    );
  }

  // Integrity
  console.log(`\n  SQLite integrity_check:  ${tag(r.integrity === 'ok')} ${r.integrity}`);
  console.log(`  SQLite quick_check:      ${tag(r.quickCheck === 'ok')} ${r.quickCheck}`);
  console.log(`  Foreign key violations:  ${tag(r.fkViolations === 0)} ${r.fkViolations}`);
}

async function main() {
  console.log(`\n${hr()}`);
  console.log('  ALUMFAB POS — AUTH REMOVAL DB SAFETY AUDIT');
  console.log('  READ-ONLY — no writes, no schema changes, no pushes');
  console.log(`  ${new Date().toISOString()}`);
  console.log(hr());

  const template = await auditDatabase('TEMPLATE DB  (prisma/pos.db)', TEMPLATE_DB);
  const prod     = await auditDatabase('PRODUCTION DB  (%APPDATA%/ALUMFAB-POS/database/pos.db)', PROD_DB);

  printAudit(template);
  printAudit(prod);

  // ── Final verdict ──────────────────────────────────────────────────────
  const passes = {};

  // Business tables preserved
  passes.businessTables = prod.missingTables.length === 0;

  // Existing data preserved (products, sales, inventory all > 0)
  passes.businessData =
    prod.rowCounts['Product']        > 0 &&
    prod.rowCounts['BranchInventory'] > 0 &&
    prod.rowCounts['StockMovement']   > 0 &&
    prod.rowCounts['Sale']            > 0 &&
    prod.rowCounts['Payment']         > 0;

  // AppMeta preserved
  passes.appMeta = prod.appMeta !== null && prod.appMeta !== undefined;

  // Only User table was removed (not in tables, was auth-only)
  passes.onlyUserRemoved = !prod.userTablePresent;

  // DB integrity
  passes.integrity = prod.integrity === 'ok' && prod.fkViolations === 0;

  const allPass = Object.values(passes).every(Boolean);

  console.log(`\n${hr()}`);
  console.log('  AUTH REMOVAL DB SAFETY AUDIT — RESULTS');
  console.log(hr());
  const pf = (b) => b ? 'PASS ✅' : 'FAIL ❌';
  console.log(`  Business Tables Preserved:     ${pf(passes.businessTables)}`);
  console.log(`  Existing Business Data Preserved: ${pf(passes.businessData)}`);
  console.log(`  AppMeta Preserved:             ${pf(passes.appMeta)}`);
  console.log(`  Only User Table Removed:       ${pf(passes.onlyUserRemoved)}`);
  console.log(`  SQLite Integrity:              ${pf(passes.integrity)}`);
  console.log(`\n  FINAL DB STATUS: ${allPass ? 'PASS ✅' : 'NEEDS CORRECTION ❌'}`);
  console.log(hr() + '\n');

  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error('AUDIT FATAL:', e.message); process.exit(1); });
