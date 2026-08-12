/**
 * scripts/verify-bundle.mjs
 * =============================================================================
 * Reads the bundle produced by `vite build --config vite.ebcheck.mjs` and
 * asserts the packaging invariants that electron-builder.yml relies on.
 *
 *   npm run verify:bundle
 *
 * Exits non-zero on failure so it can gate a release in CI.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const OUT = path.join(os.tmpdir(), 'alumfab-ebcheck');
const mainBundle = path.join(OUT, 'main', 'index.js');
const preloadBundle = path.join(OUT, 'preload', 'index.js');

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
  'querystring', 'readline', 'repl', 'stream', 'stream/promises',
  'stream/web', 'string_decoder', 'timers', 'timers/promises', 'tls', 'tty',
  'url', 'util', 'util/types', 'v8', 'vm', 'worker_threads', 'zlib'
]);

const failures = [];
const notes = [];

function requireBundle(file, label) {
  if (!fs.existsSync(file)) {
    failures.push(`${label} bundle missing at ${file}. Run: npx vite build --config vite.ebcheck.mjs`);
    return null;
  }
  return fs.readFileSync(file, 'utf8');
}

const main = requireBundle(mainBundle, 'main');
const preload = requireBundle(preloadBundle, 'preload');

if (main) {
  // ---- 1. Which modules still resolve from node_modules at runtime? --------
  const requires = [...main.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
  const external = [...new Set(requires)]
    .map((m) => m.replace(/^node:/, ''))
    .filter((m) => m !== 'electron' && !NODE_BUILTINS.has(m));

  if (external.length === 0) {
    notes.push('main bundle resolves nothing from node_modules except the Prisma native engine');
  } else {
    notes.push(`main bundle still requires from node_modules: ${external.join(', ')}`);
    notes.push('  -> keep the full `node_modules/**/*` glob in electron-builder.yml files:');
  }

  // ---- 2. Critical wiring must survive bundling ---------------------------
  const mustContain = {
    'single-instance lock': 'requestSingleInstanceLock',
    'second-instance focus handler': 'second-instance',
    'auto-start flag': '--autostart',
    'updater: deferred install': 'autoInstallOnAppQuit',
    'updater: manual restart path': 'quitAndInstall',
    'updater: feed manifest': 'app-update.yml',
    'prisma: unpacked engine override': 'PRISMA_QUERY_ENGINE_LIBRARY',
    'ipc: update channels': 'update:install-now',
    'schema guard: drift analysis': 'SchemaGuard',
    'schema guard: additive repair': 'ADD COLUMN',
    // Prisma.dmmf is what the guard compares the live database against. If a
    // future client build strips it, the guard silently stops guarding.
    'schema guard: dmmf datamodel': 'datamodel'
  };
  for (const [label, needle] of Object.entries(mustContain)) {
    if (!main.includes(needle)) failures.push(`main bundle is missing ${label} ("${needle}")`);
  }
}

if (preload) {
  for (const ch of ['update:check', 'update:get-state', 'update:install-now', 'update:event']) {
    if (!preload.includes(ch)) failures.push(`preload bridge is missing channel "${ch}"`);
  }
}

// ---- 3. Build resources referenced by electron-builder.yml must exist ------
for (const asset of [
  'build/icon.ico',
  'build/installer.nsh',
  'build/license.txt',
  'build/installerSidebar.bmp',
  'build/uninstallerSidebar.bmp',
  'build/installerHeader.bmp',
  'prisma/pos.db',
  'prisma/schema.prisma',
  'hardware.ods'
]) {
  if (!fs.existsSync(asset)) failures.push(`missing build asset: ${asset}`);
}

// ---- 4. Every NSIS MessageBox must carry /SD ------------------------------
if (fs.existsSync('build/installer.nsh')) {
  const lines = fs.readFileSync('build/installer.nsh', 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!line.trim().startsWith('MessageBox')) return;
    const stmt = lines.slice(i, i + 5).join(' ');
    if (!stmt.includes('/SD')) {
      failures.push(`installer.nsh:${i + 1} MessageBox without /SD — this hangs a silent install`);
    }
  });
}

// ---- Report ---------------------------------------------------------------
for (const n of notes) console.log(`  note   ${n}`);
for (const f of failures) console.error(`  FAIL   ${f}`);

if (failures.length) {
  console.error(`\nverify-bundle: ${failures.length} problem(s) found.`);
  process.exit(1);
}
console.log('\nverify-bundle: all packaging invariants hold.');
