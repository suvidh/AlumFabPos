/**
 * vite.ebcheck.mjs — packaging pre-flight for the main/preload bundles
 * =============================================================================
 *
 *   npm run verify:bundle
 *
 * Builds the Electron main and preload processes to a throwaway directory and
 * reports which modules the main bundle still expects to resolve from
 * node_modules at runtime.
 *
 * WHY THIS EXISTS
 * ---------------
 * vite-plugin-electron bundles most production dependencies (express, cors,
 * qrcode, the Prisma JS runtime) directly into dist-electron/main/index.js.
 * That is exactly what makes the "SIZE NOTE" optimisation in
 * electron-builder.yml safe — you can drop node_modules from the packaged app
 * and keep only the Prisma native engine.
 *
 * It is safe *only* while the check below reports no non-builtin requires. A
 * new dependency with a dynamic require that rolldown cannot analyse statically
 * would silently reintroduce a runtime dependency, and the failure surfaces at
 * the customer's counter rather than in CI. Run this before every release, and
 * always after adding a dependency used by the main process.
 *
 * Note it does NOT overwrite dist-electron/ — the real build owns that.
 */

import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'alumfab-ebcheck');

export default defineConfig({
  plugins: [
    electron([
      {
        entry: 'electron/main/index.ts',
        vite: { build: { outDir: path.join(OUT, 'main'), emptyOutDir: true } }
      },
      {
        entry: 'electron/preload/index.ts',
        vite: { build: { outDir: path.join(OUT, 'preload'), emptyOutDir: true } }
      }
    ])
  ],
  build: { outDir: path.join(OUT, 'renderer'), emptyOutDir: true },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } }
});
