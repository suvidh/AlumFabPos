import fs from 'fs';
import path from 'path';

/**
 * schema-ddl.ts — the recorded DDL catalog
 * =============================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * The drift guard could always add a missing *column* — `ALTER TABLE ADD
 * COLUMN` is a one-liner derivable from the datamodel. A missing *table* is
 * different: it needs the full CREATE TABLE with column order, NOT NULL
 * constraints, defaults, primary key, and every foreign key clause with the
 * right ON DELETE / ON UPDATE actions. Reconstructing that from `Prisma.dmmf`
 * means re-implementing the Prisma SQLite connector's DDL generator and hoping
 * it matches. That is improvisation, and the guard rightly refused.
 *
 * So don't reconstruct it — read it. Each `prisma/migrations/<name>/migration.sql`
 * already contains the exact statements Prisma generated. This module indexes
 * those files by table name so SchemaGuard can create a missing table using the
 * recorded DDL, byte for byte.
 *
 * The Prisma CLI is a devDependency and is not in the installer, so shelling
 * out to `prisma migrate deploy` at runtime is not an option in a packaged
 * build. The migration SQL is ~30 KB of text; shipping it as a resource is.
 *
 * SEARCH ORDER
 * ------------
 *   1. resources/migrations/          (packaged — see extraResources)
 *   2. <appPath>/prisma/migrations/   (dev)
 *   3. <cwd>/prisma/migrations/       (CLI scripts, tests)
 */

export interface TableDdl {
  table: string;
  /** The CREATE TABLE statement, exactly as recorded. */
  createSql: string;
  /** CREATE INDEX / CREATE UNIQUE INDEX statements belonging to this table. */
  indexSql: string[];
  /** Migration folder the statements came from, for logging. */
  source: string;
}

export interface DdlCatalog {
  /** Keyed by table name. */
  tables: Map<string, TableDdl>;
  /** Absolute path the catalog was loaded from, or null when unavailable. */
  root: string | null;
}

const EMPTY: DdlCatalog = { tables: new Map(), root: null };

// ---------------------------------------------------------------------------
// Locating the migrations directory
// ---------------------------------------------------------------------------

/**
 * @param appPath        `app.getAppPath()` in Electron; undefined elsewhere
 * @param resourcesPath  `process.resourcesPath` in Electron; undefined elsewhere
 */
export function findMigrationsDir(appPath?: string, resourcesPath?: string): string | null {
  const candidates = [
    resourcesPath ? path.join(resourcesPath, 'migrations') : null,
    appPath ? path.join(appPath, 'prisma', 'migrations') : null,
    path.join(process.cwd(), 'prisma', 'migrations')
  ].filter((p): p is string => p !== null);

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Split a migration file into complete statements.
 *
 * Naive `split(';')` breaks on semicolons inside string literals — a DEFAULT
 * 'a;b' would be torn in half. This walks the text tracking single-quote state
 * (with SQLite's '' escape) and strips `--` line comments, which is enough for
 * generated DDL. It is not a general SQL parser and does not need to be.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (inString) {
      current += ch;
      if (ch === "'") {
        // '' is an escaped quote, not the end of the literal.
        if (sql[i + 1] === "'") {
          current += sql[++i];
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (ch === "'") {
      inString = true;
      current += ch;
      continue;
    }

    // Line comment: skip to end of line.
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      current += '\n';
      continue;
    }

    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

const CREATE_TABLE_RE = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([A-Za-z0-9_]+)["`\]]?/i;
const CREATE_INDEX_RE =
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?[A-Za-z0-9_]+["`\]]?\s+ON\s+["`[]?([A-Za-z0-9_]+)["`\]]?/i;

/**
 * Load every migration in chronological order and index the DDL by table.
 *
 * Later migrations win: if a table is dropped and recreated across the history,
 * the most recent definition is the one that matters.
 */
export function loadDdlCatalog(appPath?: string, resourcesPath?: string): DdlCatalog {
  const root = findMigrationsDir(appPath, resourcesPath);
  if (!root) return EMPTY;

  const tables = new Map<string, TableDdl>();

  // Prisma names migration folders <timestamp>_<name>, so lexical order is
  // chronological order. `0_baseline` sorts first, which is what we want.
  const folders = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const folder of folders) {
    const file = path.join(root, folder, 'migration.sql');
    if (!fs.existsSync(file)) continue;

    let statements: string[];
    try {
      statements = splitStatements(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }

    for (const stmt of statements) {
      const createMatch = CREATE_TABLE_RE.exec(stmt);
      if (createMatch) {
        const table = createMatch[1];
        tables.set(table, { table, createSql: stmt, indexSql: [], source: folder });
        continue;
      }

      const indexMatch = CREATE_INDEX_RE.exec(stmt);
      if (indexMatch) {
        const entry = tables.get(indexMatch[1]);
        // An index on a table we have no CREATE for is not useful to us.
        if (entry) entry.indexSql.push(stmt);
      }
    }
  }

  return { tables, root };
}

/**
 * Order tables so that a referenced table is created before the table that
 * references it.
 *
 * Repairs run with `PRAGMA foreign_keys=OFF`, so strictly speaking order does
 * not matter for the DDL to succeed. It matters for the `foreign_key_check`
 * that runs afterwards to be meaningful, and it keeps the applied SQL readable
 * in the log. Cycles (SQLite allows them) fall back to alphabetical.
 */
export function orderByDependency(names: string[], catalog: DdlCatalog): string[] {
  const wanted = new Set(names);
  const deps = new Map<string, Set<string>>();

  for (const name of names) {
    const ddl = catalog.tables.get(name);
    const refs = new Set<string>();
    if (ddl) {
      const re = /REFERENCES\s+["`[]?([A-Za-z0-9_]+)["`\]]?/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(ddl.createSql)) !== null) {
        // Only dependencies we are also creating in this pass constrain us;
        // tables that already exist impose no ordering.
        if (m[1] !== name && wanted.has(m[1])) refs.add(m[1]);
      }
    }
    deps.set(name, refs);
  }

  const ordered: string[] = [];
  const done = new Set<string>();
  const remaining = [...names].sort();

  while (remaining.length > 0) {
    const ready = remaining.filter((n) => [...(deps.get(n) ?? [])].every((d) => done.has(d)));

    if (ready.length === 0) {
      // Circular reference — emit the rest alphabetically. FKs are off during
      // the repair, so this still applies cleanly.
      ordered.push(...remaining);
      break;
    }

    for (const n of ready) {
      ordered.push(n);
      done.add(n);
      remaining.splice(remaining.indexOf(n), 1);
    }
  }

  return ordered;
}
