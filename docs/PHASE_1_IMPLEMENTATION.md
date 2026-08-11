# ALUMFAB POS — PHASE 1 IMPLEMENTATION SPECIFICATION

**Document Version:** 1.0.0 (Phase 1 Technical Foundation)  
**Date:** August 2026  
**Status:** COMPLETE & VERIFIED  
**Application Name:** ALUMFAB POS  
**Target Operating System:** Windows Desktop (100% Offline Application)  
**Target Stack:** Electron + React + TypeScript + Vite + Tailwind CSS + Prisma ORM + SQLite  

---

## 1. OBJECTIVE & ARCHITECTURE OVERVIEW
Phase 1 establishes the production-ready technical foundation for ALUMFAB POS. It implements an offline-first Windows desktop application shell with isolated context bridges, typed IPC handlers, deterministic AppData directory management, SQLite persistence via Prisma ORM, and local file logging.

---

## 2. REFACTORED FOLDER STRUCTURE

```text
hardware_app/
├── electron/
│   ├── main/
│   │   ├── index.ts        # Main process entry & bootstrap orchestrator
│   │   ├── window.ts       # BrowserWindow creation & security options
│   │   ├── app-paths.ts    # %APPDATA%\ALUMFAB-POS path resolver
│   │   └── lifecycle.ts    # Uncaught error logging & graceful shutdown
│   ├── preload/
│   │   ├── index.ts        # Preload script exposing window.alumfab
│   │   └── api.ts          # Typed contextBridge API implementation
│   ├── ipc/
│   │   ├── channels.ts     # Centralized typed IPC channel constants
│   │   ├── handlers.ts     # Main process IPC request handlers
│   │   └── contracts.ts    # Typed IPC request/response data contracts
│   ├── services/
│   │   ├── database.service.ts # Prisma SQLite lifecycle & health check
│   │   ├── logger.service.ts   # Local app.log file logger service
│   │   └── system.service.ts   # App info and system paths service
│   └── types/
│       └── electron.d.ts   # Global window.alumfab TypeScript declarations
├── src/
│   ├── app/
│   ├── components/
│   │   └── ErrorBoundary.tsx # React error boundary component
│   ├── layouts/
│   │   └── MainLayout.tsx    # Sidebar & navigation application shell
│   ├── pages/
│   │   ├── DashboardPage.tsx # Foundation readiness & system status view
│   │   ├── BillingPage.tsx   # Placeholder for Phase 2 billing desk
│   │   ├── ProductsPage.tsx  # Placeholder for Phase 2 product catalog
│   │   ├── InventoryPage.tsx # Placeholder for Phase 2 stock management
│   │   ├── CustomersPage.tsx # Placeholder for Phase 2 customer directory
│   │   ├── SalesPage.tsx     # Placeholder for Phase 2 sales history
│   │   ├── ReportsPage.tsx   # Placeholder for Phase 2 business reports
│   │   └── SettingsPage.tsx  # System status & paths diagnostic view
│   └── types/
│       └── vite-env.d.ts     # Vite environment & CSS module types
│   ├── main.tsx              # React entry point
│   └── index.css             # Tailwind CSS & neutral business styles
├── prisma/
│   └── schema.prisma         # Minimal Phase 1 AppMeta SQLite schema
├── package.json              # Scripts & electron-builder configuration
├── tsconfig.json             # TypeScript strict compiler options
└── vite.config.js            # Vite + Electron + React build configuration
```

---

## 3. SECURITY CONFIGURATION
* **IPC Isolation**: `nodeIntegration: false`, `contextIsolation: true`.
* **No Direct Node Access**: React renderer process cannot access `fs`, `child_process`, `net`, or `prisma` directly.
* **Controlled API Exposure**: Only the strongly-typed `window.alumfab` object is exposed via `contextBridge`.
* **No Generic IPC**: Generic `ipcRenderer.send()` or `ipcRenderer.on()` methods are NOT exposed to the window object.
* **External Navigation Protection**: Arbitrary remote URLs and external web views are blocked.

---

## 4. TYPED IPC ENDPOINTS (`window.alumfab`)

| IPC Method | Channel | Return Type | Description |
| :--- | :--- | :--- | :--- |
| `getAppInfo()` | `app:get-info` | `Promise<AppInfoResult>` | Returns application name, version, platform |
| `getAppPaths()` | `app:get-paths` | `Promise<AppPathsResult>` | Returns resolved AppData storage directories |
| `checkDatabaseHealth()` | `db:health-check` | `Promise<DatabaseHealthResult>` | Queries SQLite database connection status |
| `ping()` | `app:ping` | `Promise<PingResult>` | Health check pong timestamp |

---

## 5. APPDATA DIRECTORY STRUCTURE
On application launch, the `AppPathsService` auto-creates directory paths in Windows AppData:
* **Root Directory**: `%APPDATA%\ALUMFAB-POS`
* **Database Directory**: `%APPDATA%\ALUMFAB-POS\database` (contains `pos.db`)
* **Backups Directory**: `%APPDATA%\ALUMFAB-POS\backups`
* **Logs Directory**: `%APPDATA%\ALUMFAB-POS\logs` (contains `app.log`)
* **Logos Directory**: `%APPDATA%\ALUMFAB-POS\assets\logos`

---

## 6. LOGGING FOUNDATION
* Local file logger writes structured logs to `%APPDATA%\ALUMFAB-POS\logs\app.log`.
* Log levels supported: `INFO`, `WARN`, `ERROR`.
* Logs startup paths, database bootstrap, health checks, uncaught exceptions, and shutdown cleanup. Zero cloud logging.

---

## 7. DEVELOPMENT & PRODUCTION BUILD COMMANDS

```powershell
# Development Launch:
npm run dev           # Starts Vite dev server and launches Electron desktop shell

# Type Checking:
npm run typecheck     # Executes tsc --noEmit across electron/ and src/

# Database Operations:
npm run db:generate   # Generates Prisma Client v6.4.0
npm run db:push       # Synchronizes SQLite pos.db schema

# Production Build:
npm run build         # Compiles TypeScript and builds React & Electron bundles

# Windows Desktop Packaging:
npm run package       # Builds bundles and runs electron-builder to generate NSIS .exe installer
```

---

## 8. KNOWN LIMITATIONS & FUTURE BOUNDARIES
* **Phase 1 Limitations**: Business modules (Billing, Product CRUD, Customer CRUD, Inventory Stock Balances, GST calculations, Invoice Printing) are strictly deferred to Phase 2+.
* **Placeholder Screens**: Navigation tabs render clean Phase 1 placeholder screens.
