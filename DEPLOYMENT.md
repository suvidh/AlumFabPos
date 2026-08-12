# ALUMFAB POS — Build & Release Runbook

Windows installer, deployment, and update engineering for the ALUMFAB POS
desktop application.

| | |
|---|---|
| **Packager** | electron-builder 26 → NSIS 3 |
| **Artifact** | `release/ALUMFAB-POS-Setup-<version>-x64.exe` |
| **Install scope** | Per-machine, `C:\Program Files\ALUMFAB POS` |
| **Data location** | Per-user, `%APPDATA%\ALUMFAB-POS` |
| **Backend API** | Embedded in the Electron main process, `http://0.0.0.0:3333` |
| **Updates** | electron-updater, generic HTTPS feed, deferred install |
| **Signing** | Unsigned (hooks staged in `electron-builder.yml`) |

---

## 1. Files in this setup

| Path | Purpose |
|---|---|
| `electron-builder.yml` | The whole packaging configuration. Replaces the old inline `build` block in `package.json`. |
| `build/installer.nsh` | Custom NSIS logic: prerequisite gate, firewall rule, auto-start, uninstall data prompt, opt-in NSSM service. |
| `build/icon.ico` | App + installer icon (16→256 px). |
| `build/installerSidebar.bmp`, `build/installerHeader.bmp` | Installer branding. |
| `build/license.txt` | EULA shown on the licence page. |
| `build/prereq/` | Drop `VC_redist.x64.exe` here for an offline-capable installer. |
| `electron/services/updater.service.ts` | Auto-update state machine. |
| `dev-app-update.yml` | Local update feed for testing without cutting a release. |
| `vite.ebcheck.mjs` + `scripts/verify-bundle.mjs` | `npm run verify:bundle` — packaging pre-flight, see §3. |

---

## 2. Build machine prerequisites

- **Windows 10/11 x64** — building the NSIS target on Linux/macOS requires Wine
  and is not supported for this project.
- **Node 20+** and npm.
- Nothing else. electron-builder downloads its own NSIS 3 toolchain and the
  Electron binaries into `%LOCALAPPDATA%\electron-builder\Cache` on first run
  (allow ~1.5 GB and one slow first build).

```powershell
git clone <repo> hardware_app
cd hardware_app
npm ci
npx prisma generate          # MUST run before packaging — see §7
```

> **Seed database gotcha.** `.gitignore` contains `*.db`, so `prisma/pos.db`
> is not in the repo, but `electron-builder.yml` lists it under
> `extraResources`. On a fresh clone, create it first:
> `npx prisma db push` then `npx tsx prisma/seed.ts`. The build fails loudly if
> it is missing, which is the behaviour you want.

---

## 3. Building

```powershell
npm run dist:dir     # unpacked app in release/win-unpacked — fastest smoke test
npm run dist:win     # full installer, nothing published
npm run release:win  # full installer + upload to the update feed
```

`dist:dir` is the loop to use while iterating: it skips NSIS compilation
entirely and drops a runnable `release\win-unpacked\ALUMFAB POS.exe`. Use it to
confirm Prisma resolves before you spend two minutes on `compression: maximum`.

### Pre-flight check (run before every release)

```powershell
npm run verify:bundle
```

Builds main + preload to a temp directory and asserts the packaging invariants:

- nothing but the Prisma native engine resolves from `node_modules` at runtime;
- the single-instance lock, `--autostart` flag, updater channels and the
  `PRISMA_QUERY_ENGINE_LIBRARY` override all survived bundling;
- every asset referenced by `electron-builder.yml` exists;
- **no `MessageBox` in `installer.nsh` is missing `/SD`** — the classic way to
  make a `/S` fleet rollout hang forever on an invisible dialog.

Exits non-zero, so it can gate CI.

### Verifying an installer before it ships

```powershell
# 1. Contents — is the Prisma engine really unpacked?
dir "release\win-unpacked\resources\app.asar.unpacked\node_modules\.prisma\client\"
#    expect query_engine-windows.dll.node

# 2. Seed DB and schema landed in resources
dir "release\win-unpacked\resources\pos.db"

# 3. Silent install on a clean VM
.\release\ALUMFAB-POS-Setup-1.0.0-x64.exe /S

# 4. Post-install assertions
Get-ItemProperty "HKLM:\SOFTWARE\ALUMFAB\POS"
Get-NetFirewallRule -DisplayName "ALUMFAB POS API (TCP 3333)"
Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "ALUMFAB POS"
Invoke-RestMethod http://localhost:3333/api/ping
```

Always test on a **clean VM snapshot**, never on the dev box — the dev box
already has every runtime, so the prerequisite path never executes there.

---

## 4. What the installer does

### Install (`customInit` → `customInstall`)

1. **Blocks 32-bit Windows** and **anything older than Windows 10**, with a
   readable message instead of a `0xc000007b` crash on first launch.
2. **Checks free disk space** on the target drive (700 MB) and asks before
   continuing if it is tight.
3. **Visual C++ 2015-2022 x64 runtime** — reads
   `HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64`. If missing:
   installs the bundled `build\prereq\VC_redist.x64.exe` with
   `/install /quiet /norestart`, or downloads it over TLS 1.2 via PowerShell
   when nothing was bundled. Required by the Prisma query engine.
4. **.NET Framework 4.8** — advisory only. Electron does not need it; some OPOS
   printer and cash-drawer driver packs do.
5. **Copies the app** to `C:\Program Files\ALUMFAB POS` (one UAC prompt).
6. **Writes support keys** to `HKLM\SOFTWARE\ALUMFAB\POS` (install path,
   version, data directory, API port) so field scripts never have to guess.
7. **Adds a firewall rule** for TCP 3333, scoped to Private + Domain profiles
   only — a till must never accept inbound traffic on a Public network.
8. **Registers auto-start**: `HKLM\...\Run` → `"ALUMFAB POS.exe" --autostart`.
9. **Creates the data tree** under `%APPDATA%\ALUMFAB-POS`.
10. Desktop shortcut + Start Menu entry under the **ALUMFAB** folder.

### Uninstall (`customUnInstall`)

1. Stops any registered service, then `taskkill /F /T` on the app to release
   the port and the SQLite file handle.
2. Removes both firewall rules, the Run entry, and the support registry keys.
3. **Asks about business data** — two deliberate confirmations, defaulting to
   *keep*. Deleting `%APPDATA%\ALUMFAB-POS` destroys the sales ledger, customer
   balances, invoice history and every local backup, which may be legally
   required records.
4. Clears the electron-updater staging cache.

Everything destructive is skipped when `${isUpdated}` is true, so an
auto-update never touches shop data.

### Silent switches

```powershell
# Fleet rollout defaults: auto-start on, firewall rule on, prereqs checked
ALUMFAB-POS-Setup-1.0.0-x64.exe /S

ALUMFAB-POS-Setup-1.0.0-x64.exe /S /AUTOSTART=0      # no launch at login
ALUMFAB-POS-Setup-1.0.0-x64.exe /S /FIREWALL=0       # standalone till, no LAN
ALUMFAB-POS-Setup-1.0.0-x64.exe /S /SKIPPREREQ=1     # golden image, runtimes known good
ALUMFAB-POS-Setup-1.0.0-x64.exe /S /D=D:\POS\ALUMFAB # custom dir — MUST be last, unquoted

"C:\Program Files\ALUMFAB POS\Uninstall ALUMFAB POS.exe" /S                # keeps data
"C:\Program Files\ALUMFAB POS\Uninstall ALUMFAB POS.exe" /S /PURGEDATA=1   # deletes data
```

---

## 5. Why the app is not a Windows Service

The Express REST API runs **inside the Electron main process**
(`electron/services/http.service.ts`), so "the API auto-starts" is delivered by
the HKLM `Run` entry, not by the Service Control Manager. For a single-till
shop this is the right trade: one process, one SQLite writer, no Session 0
isolation problems, and the operator can see the app is alive.

Move to a real service when any of these become true:

- A second terminal needs the API up while till #1 is closed.
- You want the API reachable during the Windows lock screen.
- You need the backend to survive a renderer crash.

`build/installer.nsh` already contains the full registration, written and
commented, behind `!define ENABLE_NSSM_SERVICE 0`. Turning it on requires:

1. Extract a headless entry point — `electron/services/http.service.ts` minus
   the `electron` imports — built to `resources/server/service-main.js`.
2. Ship a Node runtime at `resources/node.exe` (or compile with `pkg`).
3. Place `nssm.exe` (x64) at `build/bin/nssm.exe`.
4. Flip the define to `1` and rebuild.

The service is registered with `Start SERVICE_AUTO_START`, log rotation at
16 MB, and this recovery policy:

```
nssm set AlumfabPosApi AppThrottle 5000        # crash-loop guard
nssm set AlumfabPosApi AppExit Default Restart
nssm set AlumfabPosApi AppRestartDelay 5000    # restart 5s after failure
sc failure AlumfabPosApi reset= 86400 actions= restart/5000/restart/5000/restart/5000
```

Both layers are set on purpose: NSSM restarts the Node process when it exits,
the SCM restarts NSSM itself if the wrapper dies.

---

## 6. Auto-updates

### Server layout

```
https://updates.alumfab.example.com/pos/
├── latest.yml                                  # version manifest
├── ALUMFAB-POS-Setup-1.0.1-x64.exe
└── ALUMFAB-POS-Setup-1.0.1-x64.exe.blockmap    # enables differential download
```

Serve over **HTTPS** with correct `Content-Length` and byte-range support
(`Accept-Ranges: bytes`). Without ranges, `differentialPackage` silently falls
back to a full download, and a 120 MB pull over shop 4G during trading hours is
exactly what this setup exists to avoid.

### Release procedure

```powershell
npm version patch          # or minor / major — bumps package.json
npm run release:win        # builds and uploads
git push --follow-tags
```

Then verify from a till that is still on the old version:

```powershell
Get-Content "$env:APPDATA\ALUMFAB-POS\logs\*.log" -Tail 50 | Select-String Updater
```

### Client behaviour

| When | What happens |
|---|---|
| 45 s after launch | First feed check — never competes with boot. |
| Every 4 hours | Re-check, unless a package is already staged. |
| Update found | Downloaded silently in the background. |
| Download complete | State becomes `ready`; renderer shows a discreet chip. |
| App closed normally | `autoInstallOnAppQuit` applies it. Shop opens on the new build. |
| Operator clicks "Restart now" | `installUpdateNow()` → `quitAndInstall(true, true)`. |

The main process deliberately **never restarts on its own**. It cannot know
whether a customer is standing at the counter mid-transaction, so the decision
belongs to the renderer.

### Renderer integration

```tsx
import { useEffect, useState } from 'react';
import { api } from '@/api';
import type { UpdateState } from '../electron/ipc/contracts';

export function UpdateChip() {
  const [update, setUpdate] = useState<UpdateState | null>(null);

  useEffect(() => {
    void api.getUpdateState().then(setUpdate);
    return api.onUpdateEvent(setUpdate);   // returns its own unsubscribe
  }, []);

  if (!update?.updateReadyToInstall) return null;

  return (
    <button
      // Gate on your own state: no open cart, no open cash shift.
      onClick={() => void api.installUpdateNow()}
      className="rounded bg-amber-500 px-3 py-1 text-sm text-slate-900"
    >
      Version {update.availableVersion} ready — restart to update
    </button>
  );
}
```

### Testing updates without publishing

1. Bump `package.json` to `1.0.1` and run `npm run dist:win`.
2. `npx http-server ./release -p 8000 --cors`
3. Confirm `dev-app-update.yml` points at `http://127.0.0.1:8000/`.
4. Run the installed `1.0.0` build, or `npm run dev`, and watch the log for
   `[Updater] Development feed active`.

---

## 7. Prisma packaging — read this before changing `files`

`query_engine-windows.dll.node` is a native addon. Native addons **cannot** be
loaded from inside an asar archive, so:

- `electron-builder.yml` lists `node_modules/.prisma/**` under `asarUnpack`,
  which mirrors the engine to `resources\app.asar.unpacked\...`.
- `DatabaseService.resolveQueryEngine()` sets `PRISMA_QUERY_ENGINE_LIBRARY` to
  that unpacked path when `app.isPackaged`, because Prisma's own resolver looks
  beside the asar-packed client and fails.

Symptom when this breaks: the window opens fine and every database call throws
`Unable to load Node-API Library`. Check the log line
`Prisma query engine resolved: ...` on startup.

`npx prisma generate` must run on the build machine before packaging — the
generated client is not in git.

---

## 7b. Database schema drift

### The failure this prevents

`DatabaseService.bootstrap()` copies the template `pos.db` to `%APPDATA%` only
when the file is **missing**. Every launch after that, the runtime database is
whatever the shop already had. Add a column to `schema.prisma`, `db push` it on
the dev box, ship the build — and the shop's database still has the old shape.

Prisma then fails at the worst possible moment. It is not only writes: after
`product.update()` Prisma reads the row back with an explicit column list, so a
query that never mentions the new column still throws

```
P2022: The column `costPricePaise` does not exist in the current database
```

mid-transaction, and the entire ODS bulk ingestion rolls back.

### The guard

`electron/services/schema-guard.service.ts` runs on every startup, before any
domain query, and compares the live database against `Prisma.dmmf` — the
datamodel embedded in the generated client, so it cannot fall out of sync with
`schema.prisma` the way a hand-maintained list would.

| Drift | Policy |
|---|---|
| Missing column, nullable or with a default | Back up, `ALTER TABLE ADD COLUMN`, verify, continue |
| Missing column, `@unique` | As above, plus `CREATE UNIQUE INDEX` |
| Missing column, required with no usable default | **Blocking** — needs a data plan |
| Missing table, DDL recorded in `prisma/migrations` | Replay the recorded `CREATE TABLE` + indexes verbatim |
| Missing table, no recorded DDL | **Blocking** — nothing to replay, and nothing worth guessing |
| Type change | **Blocking** — SQLite requires a table rebuild |
| Extra column not in the schema | Informational, ignored |

Blocking drift shows an error dialog naming the exact tables and columns, then
exits. A till that opens with a partially readable database will take payments
and silently lose line items — worse than one that says "call support".

Repairs are never attempted without a snapshot first (`.db` plus `-wal`/`-shm`,
because a plain `.db` copy can miss committed transactions still in the
write-ahead log). Snapshots land in
`%APPDATA%\ALUMFAB-POS\backups\PRE-SCHEMA-REPAIR-<timestamp>.db`.

### Where missing-table DDL comes from

A `CREATE TABLE` needs exact column order, constraints, defaults, and every
foreign key with the right `ON DELETE`/`ON UPDATE` action. Deriving that from
the datamodel means re-implementing Prisma's SQLite DDL generator and hoping it
matches — so the guard doesn't. `electron/services/schema-ddl.ts` indexes the
statements Prisma already wrote to `prisma/migrations/` and replays them
verbatim.

The Prisma CLI is a devDependency and cannot run inside a packaged build, so
`prisma/migrations` ships as an `extraResource` (~30 KB) and resolves at
`resources/migrations/`. **If that resource is missing from a build, missing
tables become blocking again** — `verify:bundle` does not catch this, so check
`resources/migrations/0_baseline/migration.sql` exists in `win-unpacked`.

Tables are created in foreign-key dependency order, with `foreign_keys=OFF` for
the DDL and a `PRAGMA foreign_key_check` immediately after. Creating a missing
table cannot orphan a row, so a violation there means the database was already
damaged — the guard reports it and refuses rather than opening the till.

### Manual tooling

```powershell
npm run db:repair                    # report drift on the runtime DB, change nothing
npm run db:repair -- --apply         # back up, then apply additive fixes
npm run db:drift                     # also check the shipped template prisma/pos.db
npm run db:repair -- --db "D:\pos.db"

npm run db:force-migrate             # full schema sync via `prisma migrate diff`, dry run
npm run db:force-migrate -- --apply  # back up, apply, FK-check, verify, resolve baseline
npm run db:force-migrate -- --apply --fallback-push   # use db push if the schema engine fails

npm run test:drift                   # 44-check regression suite for the guard itself
```

`db:repair` uses only the app's own logic and needs no Prisma CLI — it works on
a terminal in the field. `db:force-migrate` asks Prisma's schema engine for the
authoritative SQL, so it is the better choice on a machine with the toolchain,
and it also repairs `_prisma_migrations` afterwards.

`db:force-migrate` refuses to apply SQL containing `DROP TABLE`, `DROP COLUMN`,
`DELETE FROM`, or Prisma's `new_<table>` rebuild idiom unless you pass
`--allow-destructive`. Additive drift never produces those; if you see them, the
schema and that database have diverged in a way that needs a decision about
existing rows, not a convenience command.

`test:drift` builds deliberately-broken copies of the template — including the
full field state of 10 dropped tables plus 5 dropped columns with live product
rows — and asserts the guard detects, classifies, repairs, restores foreign keys
and composite primary keys, and preserves every row. It backs the raw SQL with
`node:sqlite` instead of Prisma, so it runs on any platform with no query engine.

### Migrations from here on

`prisma/migrations/0_baseline/` captures the schema as it exists in every build
up to now. **Databases that already exist must be told it is applied**, or
`migrate deploy` will try to `CREATE TABLE` over live data:

```powershell
npx prisma migrate resolve --applied 0_baseline
```

Then use migrations rather than `db push` for every future change:

```powershell
npm run db:migrate -- --name add_supplier_lead_time   # dev: write the migration
npm run db:deploy                                     # CI/release: apply it
```

The baseline was captured from the template database's own DDL. To regenerate it
canonically from the Prisma schema engine on a Windows build machine:

```powershell
npx prisma migrate diff --from-empty `
    --to-schema-datamodel prisma/schema.prisma `
    --script > prisma/migrations/0_baseline/migration.sql
```

The startup guard stays regardless of migrations — it is the safety net for
terminals that skip a release, restore an old backup, or get a database copied
between machines.

---

## 8. Code signing

The build is currently unsigned. SmartScreen will warn on first run of each new
release until the file accrues reputation.

When the certificate arrives, uncomment the `signtoolOptions` block in
`electron-builder.yml` and supply credentials via environment variables only:

```powershell
$env:CSC_LINK = "C:\secure\alumfab-codesign.pfx"   # or a base64 blob in CI
$env:CSC_KEY_PASSWORD = "<from the secret store>"
npm run release:win
```

An **EV certificate** clears SmartScreen immediately and is worth the extra cost
for retail software; an OV certificate still needs to build reputation. Always
timestamp (`rfc3161TimeStampServer`) so installers keep validating after the
certificate expires.

Once signing is live, set `verifyUpdateCodeSignature: true` — that is what stops
a hijacked update feed from delivering an unsigned payload.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| App starts, every DB call fails | Prisma engine still inside the asar | Check `asarUnpack`; confirm `app.asar.unpacked\node_modules\.prisma\client\` exists |
| `P2022: column ... does not exist`, import rolls back | Runtime DB behind the schema | `npm run db:repair -- --apply`. The startup guard now fixes this class automatically — see §7b |
| "Database needs attention" dialog on launch | Blocking drift the guard won't guess at | `npm run db:repair -- --check` for the detail; write a migration |
| `EADDRINUSE :3333` | Second instance, or an orphaned process | Single-instance lock handles the normal case; otherwise `taskkill /F /IM "ALUMFAB POS.exe"` |
| Installer needs a runtime the shop can't download | No bundled redistributable | Put `VC_redist.x64.exe` in `build/prereq/` and rebuild |
| Update never applies | Feed unreachable, or no byte-range support | Check the `[Updater]` lines in `%APPDATA%\ALUMFAB-POS\logs\` |
| Data "disappeared" after reinstall | Different Windows user account | Data is per-user under `%APPDATA%`. Copy `ALUMFAB-POS\` between profiles |
| Silent install hangs | A `MessageBox` without `/SD` was added | Every dialog in `installer.nsh` must carry `/SD` |
| Uninstall left the service behind | Registered outside the installer | `sc delete AlumfabPosApi` |

**Support bundle** — ask the shop for:

```
%APPDATA%\ALUMFAB-POS\logs\
HKLM\SOFTWARE\ALUMFAB\POS          (reg export)
```

---

## 10. Multi-user caveat

Business data lives in the **roaming profile of the Windows user who runs the
till** (`%APPDATA%\ALUMFAB-POS`). The application binary is shared per-machine,
the data is not.

If a shop rotates operators across separate Windows accounts, each one gets its
own empty database. Standardise on a single shared Windows account per terminal
— the usual retail practice — or move the data root to `%PROGRAMDATA%` in
`electron/main/app-paths.ts` and grant the Users group write access to it from
`customInstall`.

The uninstaller's purge step only removes the invoking user's copy for the same
reason.
