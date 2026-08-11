const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');

// Check BOTH databases
const targets = [
  {
    label: 'TEMPLATE DB (prisma/pos.db)',
    dbPath: path.join(process.cwd(), 'prisma/pos.db')
  },
  {
    label: 'PRODUCTION DB (%APPDATA%/ALUMFAB-POS/database/pos.db)',
    dbPath: path.join(process.env.APPDATA, 'ALUMFAB-POS', 'database', 'pos.db')
  }
];

const requiredTables = [
  'AppMeta', 'Company', 'Branch', 'Category', 'Product',
  'BranchInventory', 'StockMovement', 'InvoiceSequence',
  'Customer', 'Sale', 'SaleItem', 'Payment',
  'BackupMetadata', 'AuditLog', 'Supplier',
  'Purchase', 'PurchaseItem', 'Expense'
];

async function checkDatabase(label, dbPath) {
  console.log('\n' + '═'.repeat(60));
  console.log('  ' + label);
  console.log('  PATH: ' + dbPath);
  console.log('  SIZE: ' + (fs.existsSync(dbPath) ? Math.round(fs.statSync(dbPath).size / 1024) + ' KB' : 'FILE NOT FOUND'));
  console.log('═'.repeat(60));

  if (!fs.existsSync(dbPath)) {
    console.log('  ⚠️  Database file does not exist — skipping check');
    return [];
  }

  const client = new PrismaClient({
    datasources: { db: { url: 'file:' + dbPath } }
  });

  const issues = [];

  try {
    await client.$connect();

    // Table inventory
    const rawTables = await client.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const tableNames = rawTables.map(t => t.name);

    // User table check
    const userExists = tableNames.includes('User');
    console.log('\n  USER TABLE:          ' + (userExists ? '❌ STILL EXISTS (auth table not dropped)' : '✅ DROPPED — clean'));
    if (userExists) {
      // Check if it has any rows
      const userCount = await client.$queryRawUnsafe('SELECT COUNT(*) as cnt FROM "User"');
      console.log('  USER ROW COUNT:      ' + Number(userCount[0].cnt));
      issues.push('FAIL: User table still present in ' + label + ' (' + Number(userCount[0].cnt) + ' rows)');
    }

    // Required table presence
    console.log('\n  REQUIRED TABLES:');
    let allPresent = true;
    for (const t of requiredTables) {
      const present = tableNames.includes(t);
      if (!present) { allPresent = false; issues.push('FAIL: Missing table ' + t + ' in ' + label); }
      console.log('    ' + (present ? '✅' : '❌') + ' ' + t);
    }

    // Row counts
    console.log('\n  ROW COUNTS:');
    for (const t of requiredTables) {
      if (!tableNames.includes(t)) continue;
      const res = await client.$queryRawUnsafe('SELECT COUNT(*) as cnt FROM "' + t + '"');
      const cnt = Number(res[0].cnt);
      console.log('    ' + t.padEnd(22) + cnt);
    }

    // AppMeta
    const meta = await client.$queryRawUnsafe('SELECT * FROM "AppMeta" WHERE id=1');
    if (meta.length > 0) {
      console.log('\n  APP META:            schemaVersion=' + meta[0].schemaVersion + ' appVersion=' + meta[0].appVersion);
    } else {
      console.log('\n  APP META:            ⚠️  Row not found');
      issues.push('WARN: AppMeta missing in ' + label);
    }

    // SQLite integrity
    const integrity = await client.$queryRawUnsafe('PRAGMA integrity_check');
    const intResult = integrity[0]?.integrity_check ?? JSON.stringify(integrity[0]);
    console.log('  INTEGRITY:           ' + (intResult === 'ok' ? '✅ ok' : '❌ ' + intResult));
    if (intResult !== 'ok') issues.push('FAIL: integrity_check=' + intResult + ' in ' + label);

    // FK violations
    const fk = await client.$queryRawUnsafe('PRAGMA foreign_key_check');
    console.log('  FK VIOLATIONS:       ' + (fk.length === 0 ? '✅ 0' : '❌ ' + fk.length + ' violation(s)'));
    if (fk.length > 0) issues.push('FAIL: ' + fk.length + ' FK violation(s) in ' + label);

    // Page size / fragmentation
    const pageSize = await client.$queryRawUnsafe('PRAGMA page_size');
    const pageCount = await client.$queryRawUnsafe('PRAGMA page_count');
    const freelistCount = await client.$queryRawUnsafe('PRAGMA freelist_count');
    console.log('  PAGE SIZE:           ' + pageSize[0].page_size + ' bytes');
    console.log('  PAGES USED:          ' + (Number(pageCount[0].page_count) - Number(freelistCount[0].freelist_count)) + ' / ' + pageCount[0].page_count);

    await client.$disconnect();

  } catch (e) {
    issues.push('FAIL: Exception during check of ' + label + ': ' + e.message);
    console.log('  ❌ CHECK ERROR:', e.message);
    try { await client.$disconnect(); } catch {}
  }

  return issues;
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  ALUMFAB POS — POST AUTH-REMOVAL DATABASE SAFETY CHECK');
  console.log('  ' + new Date().toISOString());
  console.log('═'.repeat(60));

  const allIssues = [];

  for (const target of targets) {
    const issues = await checkDatabase(target.label, target.dbPath);
    allIssues.push(...issues);
  }

  // Production DB needs special handling if User table still exists
  const prodPath = path.join(process.env.APPDATA, 'ALUMFAB-POS', 'database', 'pos.db');
  const prodUserExists = (() => {
    try {
      // Quick raw sqlite check without prisma for prod DB
      return false; // handled above
    } catch { return false; }
  })();

  console.log('\n' + '═'.repeat(60));
  console.log('  FINAL VERDICT');
  console.log('═'.repeat(60));

  const failIssues = allIssues.filter(i => i.startsWith('FAIL'));
  const warnIssues = allIssues.filter(i => i.startsWith('WARN'));

  if (failIssues.length === 0 && warnIssues.length === 0) {
    console.log('  ✅ ALL CHECKS PASSED — Both databases are clean and healthy');
  } else {
    if (failIssues.length > 0) {
      console.log('  ❌ FAILURES (' + failIssues.length + '):');
      failIssues.forEach(i => console.log('    → ' + i));
    }
    if (warnIssues.length > 0) {
      console.log('  ⚠️  WARNINGS (' + warnIssues.length + '):');
      warnIssues.forEach(i => console.log('    → ' + i));
    }
  }
  console.log('═'.repeat(60) + '\n');

  process.exit(failIssues.length > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('SAFETY CHECK FATAL:', e.message);
  process.exit(1);
});
