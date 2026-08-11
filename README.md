# ALUMFAB POS — Offline Desktop POS for Bulk Aluminum Products

**Phase Status:** PHASE 0 SCOPE, REQUIREMENTS & AMENDMENTS LOCKED  
**Target Operating Environment:** Windows Desktop Application (100% Offline)  
**Production Tech Stack:** Electron + React + TypeScript + Tailwind CSS + Electron Preload IPC + Service Layer + Prisma ORM + SQLite  
**Production Database Location:** `%APPDATA%\ALUMFAB-POS\database\pos.db`  

---

## 📖 Single Source of Truth Documentation (`docs/`)

All Phase 0 business requirements, scope boundaries, database schemas, validation rules, and amendments are formally locked in the following master specification documents:

1. 📄 [`docs/PHASE_0_AMENDMENT_BRANCH_AND_DATASET.md`](./docs/PHASE_0_AMENDMENT_BRANCH_AND_DATASET.md) — *Branch Architecture & Product Dataset Amendment*
2. 📄 [`docs/PHASE_0_REQUIREMENTS_SPECIFICATION.md`](./docs/PHASE_0_REQUIREMENTS_SPECIFICATION.md) — *System Architecture & Business Requirements Specification*
3. 📄 [`docs/PHASE_0_FINAL_DELIVERABLES.md`](./docs/PHASE_0_FINAL_DELIVERABLES.md) — *Detailed Deliverables 1 through 6 (Schemas, Workflows, Validation)*
4. 📄 [`docs/VERSION_1_SCOPE.md`](./docs/VERSION_1_SCOPE.md) — *Version 1 Scope Definition & Boundaries*
5. 📄 [`docs/ARCHITECTURE_DECISIONS.md`](./docs/ARCHITECTURE_DECISIONS.md) — *Architecture Decision Records (ADRs 01-08)*
6. 📄 [`docs/PHASE_0_COMPLIANCE_AUDIT.md`](./docs/PHASE_0_COMPLIANCE_AUDIT.md) — *Phase 0 Compliance Audit Report*

---

## 📁 Repository Directory Structure

```
hardware_app/
├── docs/                                # Single Source of Truth Documentation Folder
│   ├── PHASE_0_AMENDMENT_BRANCH_AND_DATASET.md
│   ├── PHASE_0_REQUIREMENTS_SPECIFICATION.md
│   ├── PHASE_0_FINAL_DELIVERABLES.md
│   ├── VERSION_1_SCOPE.md
│   ├── ARCHITECTURE_DECISIONS.md
│   └── PHASE_0_COMPLIANCE_AUDIT.md
├── legacy_prototype/                    # Isolated Phase 0 Web Prototype (Dexie.js / IndexedDB)
├── CODEBASE_AUDIT_REPORT.md             # Audit Report detailing architecture & scope compliance
├── PHASE_0_FINAL_OUTPUT.md              # Master Phase 0 Final Output Document (Sections A-J)
├── hardware.ods                         # Company Hardware Product Dataset (182 Items)
├── src/                                 # Prototype UI views
├── dist/                                # Prototype build artifacts
└── package.json                         # Project dependencies & scripts
```

---

## 🔒 Version 1 Locked Business Scope & Rules

### ✅ Included in Version 1:
* Single `ADMIN` Role with full system access.
* Excel / CSV / ODS Product Dataset Import & Error Validation.
* Multi-Unit Inventory Engine (`KG`, `PCS`, `FT`, `METER`, `LENGTH`, `SET`).
* Opening Stock Setup & Stock Movements Ledger.
* Zero Negative Stock Control ($\text{Stock} - \text{Sale Qty} \ge 0$).
* POS Billing Counter Terminal (`F2` search, `F8` checkout, hotkeys).
* Manual Discounting (%, ₹) stored with invoice audit.
* Integer Paise GST Tax Calculations ($1\text{ INR} = 100\text{ paise}$) with reverse GST calculation.
* Cash & Cheque Payments ONLY (Mandatory Cheque Number validation).
* Dual-Copy A4 Tax Invoice Printing (`CUSTOMER COPY` & `COMPANY COPY`).
* Sales History Register & Dual Invoice Reprinting.
* Local Settings (Default Currency INR / ₹, Local Backup directory, Invoice Prefix `ALF-INV-`).
* Manual & Auto Daily Database Backup + Pre-Restore Safety Snapshot Protection.

### 🛑 Excluded from Version 1:
* No Quotation Module UI (Architecture decoupled for future addition).
* No Customer Credit Limits, Outstanding Balances, Partial Payments, or Khata Ledgers.
* No Digital Payments (UPI, QR Codes, Cards, Net Banking, Wallets).
* No Sales Returns or Invoice Cancellations in V1.
* No Multi-User Role Permissions.
* No Cloud Synchronization, Cloud Databases, Online Auth, or Remote APIs.

---

## ⚠️ Standby Protocol
Phase 1 implementation will **NOT** begin automatically. The codebase is audited, cleaned, isolated, amended, and standing by for formal Phase 0 approval.
