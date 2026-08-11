# ALUMFAB POS — PHASE 1 ARCHITECTURE DECISIONS RECORD (ADR)

**Document Version:** 1.0.0 (Technical Foundation ADRs)  
**Status:** Approved Architectural Standard  

---

## ADR-14: Electron Process Isolation & Secure Context Bridge
* **Decision**: Enforce `nodeIntegration = false`, `contextIsolation = true` in `BrowserWindow`. Expose IPC functions strictly through a single namespaced API (`window.alumfab`) using `contextBridge`.
* **Rationale**: Protects the React renderer process against arbitrary Remote Code Execution (RCE) and prevents direct access to Node.js file system primitives or database connections from the UI layer.

---

## ADR-15: Main-Process-Only Database Service Lifecycle
* **Decision**: Prisma ORM and SQLite database connections are executed exclusively within the Electron main process and service layer (`DatabaseService`).
* **Rationale**: Prevents multi-process SQLite lock contention and avoids exposing database query primitives or credentials to the renderer process.

---

## ADR-16: AppData Deterministic Directory Resolver Strategy
* **Decision**: Store production database (`pos.db`), backups, log files (`app.log`), and logo assets in a deterministic Windows AppData directory (`%APPDATA%\ALUMFAB-POS`).
* **Rationale**: Ensures installer updates in `Program Files` never overwrite or erase business database records, log files, or brand assets.

---

## ADR-17: Phase 1 Minimal Technical Schema (`AppMeta`)
* **Decision**: Define a minimal Phase 1 database schema consisting of `AppMeta` (tracking schema version, app version, and initialization timestamp) rather than pre-building premature business models.
* **Rationale**: Validates SQLite connection health, Prisma generation, and migration pipelines cleanly without introducing premature or unverified business assumptions.

---

## ADR-18: Zero Business Logic in Technical Foundation
* **Decision**: Strictly exclude Product CRUD, Customer CRUD, Billing desk logic, GST calculations, Discounts, Payment settlement, and Invoice printing from Phase 1.
* **Rationale**: Preserves architectural purity and ensures Phase 1 focuses 100% on technical foundation readiness before business workflows are implemented in Phase 2+.

---

## ADR-19: Local Structured File Logging Protocol (`app.log`)
* **Decision**: Implement a local file logging service (`LoggerService`) writing `INFO`, `WARN`, and `ERROR` logs to `%APPDATA%\ALUMFAB-POS\logs\app.log`.
* **Rationale**: Provides technical diagnostic logs for desktop app troubleshooting while ensuring zero cloud telemetry or sensitive customer data exposure.

---

## ADR-20: React Error Boundary Defensive Renderer Strategy
* **Decision**: Wrap the root React application in an `ErrorBoundary` component that catches uncaught component render exceptions gracefully.
* **Rationale**: Prevents a blank white screen crash, displaying a user-friendly error card ("Something went wrong. Please restart ALUMFAB POS") with a manual reload trigger.

---

## ADR-21: Windows Desktop Packaging Foundation via electron-builder
* **Decision**: Use `electron-builder` to configure NSIS executable packaging (`ALUMFAB POS.exe`) producing a standalone Windows x64 binary in `release/`.
* **Rationale**: Establishes a verified packaging pipeline ensuring Prisma runtime engines and Electron binaries bundle correctly into a production desktop installer.
