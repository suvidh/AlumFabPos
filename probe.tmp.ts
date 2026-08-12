import { PrismaClient } from '@prisma/client';
import { analyseDrift, formatReport } from './electron/services/schema-drift';

const dbPath = process.argv[2];
const c = new PrismaClient({ datasources: { db: { url: 'file:' + dbPath } } });
(async () => {
  const r = await analyseDrift(c);
  console.log(`--- ${dbPath} ---`);
  console.log('ok:', r.ok, '| repairable:', r.repairable, '| additive:', r.additive.length, '| blocking:', r.blocking.length);
  console.log(formatReport(r));
  if (r.repairSql.length) { console.log('\nREPAIR SQL:'); r.repairSql.forEach(s => console.log('  ' + s)); }
  await c.$disconnect();
})();
