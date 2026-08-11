# ALUMFAB POS — PHASE 0 FINAL DELIVERABLES DOCUMENT

**Document Version:** 3.0.0 (Phase 0 Deliverables Record)  
**Project Name:** ALUMFAB POS  
**Target Operating Environment:** Windows Desktop (100% Offline Application)  
**Target Architecture Stack:** Electron + React + TypeScript + Tailwind CSS + Prisma ORM + SQLite  

---

# DELIVERABLE 1: FINAL REQUIREMENTS SUMMARY
* **Zero Cloud Mandate**: 100% offline Windows desktop application.
* **AppData Storage Hierarchy**: Production SQLite DB saved strictly in `%APPDATA%\ALUMFAB-POS\database\pos.db` (NEVER in `Program Files`). Separate directories for `backups/` and `logs/`.
* **Local Currency**: Default currency **INR (₹)** stored locally.
* **Decoupled Printing Reliability Rule**: If printing fails AFTER a sale is saved, the valid ACID database transaction is **NOT** rolled back. The sale is saved successfully, a printer warning is shown, and reprinting from Sales History is enabled.

---

# DELIVERABLE 2: FEATURE SCOPE (VERSION 1 VS FUTURE VERSIONS)
* **Version 1 (In-Scope)**: Admin Authentication, Product/Category Master, Excel/CSV Data Import Validation, Multi-Unit Inventory (`KG`, `PCS`, `FT`, `METER`, `LENGTH`, `SET`), Opening Stock & Movement Ledger, Zero Negative Stock Block, POS Counter Billing, Manual Discounting (%, ₹), Reverse GST Paise Calculation, Cash & Cheque Payment (Mandatory Cheque #), A4 Dual-Copy Print (`CUSTOMER COPY` & `COMPANY COPY`), Sales History & Reprinting, Company Settings, Manual & Auto Daily Backup, Pre-Restore Safety Snapshot, Windows Offline Electron Desktop Deployment.
* **Future Versions (Out-of-Scope)**: Quotation Module UI, Customer Credit Limits & Khata, Outstanding Balances, Partial Payments, Digital Payments (UPI, Cards, Net Banking), Sales Returns & Cancellations, Multi-User Permissions, Cloud Sync, Mobile App.

---

# DELIVERABLE 3: BUSINESS RULES MATRIX
* **Integer Paise Arithmetic**: All monetary fields stored in integer paise ($1\text{ INR} = 100\text{ paise}$).
* **GST Taxes**: Product GST rates configured per item (e.g. 5%, 12%, 18%, 28%). Reverse taxable calculation for GST-inclusive prices. Intra-State = 50% CGST + 50% SGST; Inter-State = 100% IGST.
* **Inventory Control**: Zero Negative Stock rule ($\text{Stock} - \text{Sale Qty} \ge 0$). Append-only movement ledger (`OPENING_STOCK`, `PURCHASE`, `SALE`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`).
* **Payments**: Cash & Cheque only. `chequeNumber` is **MANDATORY** for Cheque sales.
* **Invoices**: Non-duplicating sequence (`ALF-INV-000001`). Dual A4 prints (`CUSTOMER COPY` & `COMPANY COPY`).
* **Backups**: Manual & Auto Daily Backups. Pre-restore SQLite schema validation + immediate Pre-Restore Safety Snapshot.

---

# DELIVERABLE 4: CORE WORKFLOWS
1. **Login Flow**: Local authentication -> Admin access.
2. **Product Import Validation Flow**: Parse Excel/CSV -> Run validation check -> If errors: generate Validation Report -> If valid: bulk write products.
3. **Inventory Adjustment Flow**: Select product -> Movement type -> Quantity -> Update ledger & current stock.
4. **Sales Counter Flow**: Select customer -> Search product (`F2`) -> Enter qty -> Manual rate/discount adjustment -> Validate stock -> Compute tax -> Checkout (`F8`).
5. **Cash Payment Flow**: Select Cash -> Confirm total -> Commit atomic transaction.
6. **Cheque Payment Flow**: Select Cheque -> Input Cheque # -> If blank: block sale -> If valid: commit atomic transaction.
7. **Atomic Sales Transaction & Invoice Print Flow**: Open SQLite transaction -> Write sale & items -> Write stock movement -> Deduct stock -> Increment invoice counter -> Commit -> Print dual A4 copies.
8. **Backup Flow**: Manual or daily auto -> Copy SQLite file to `%APPDATA%/ALUMFAB-POS/backups/ALUMFAB-POS-YYYY-MM-DD-HHMMSS.db`.
9. **Restore Flow**: Validate backup file -> Create Pre-Restore Safety Snapshot -> Overwrite DB -> Reload connection.

---

# DELIVERABLE 5: DATA ENTITY LIST (PRISMA SCHEMAS)
13 Core Entities defined in Prisma ORM SQLite format (Branch Architecture & Dataset Amendment):
1. `Company` — Central company identity and default logo path.
2. `Branch` — Editable branch profile (Address, GSTIN, Phone, State, Invoice Prefix, Logo path).
3. `BranchInventory` — Per-branch inventory balances (`branchId + productId` unique constraint).
4. `InvoiceSequence` — Branch-aware sequence engine (`branchId + prefix -> nextNumber`).
5. `Category` — Product classification.
6. `Product` — Company-global product catalog (SKU, Name, Price, Unit, GST, Barcode).
7. `Customer` — Customer profile.
8. `Sale` — Invoice header record containing **Immutable Branch & Customer Snapshots** (`branchNameSnapshot`, `branchAddressSnapshot`, `branchGstinSnapshot`, `branchPhoneSnapshot`, `branchStateSnapshot`, `invoicePrefixSnapshot`, `logoSnapshot`).
9. `SaleItem` — Invoice line items.
10. `Payment` — Settlement record (`CASH` / `CHEQUE` with mandatory `chequeNumber`).
11. `StockMovement` — Auditable movement ledger (`branchId`, `productId`, `type`, `quantity`).
12. `BackupMetadata` — Database snapshot log.
13. `AuditLog` — Admin operation audit trail.

---

# DELIVERABLE 6: APPLICATION-LEVEL VALIDATION RULES
Validation rules covering SKU uniqueness, non-negative prices, valid GST rates ($0 \le \text{gstRate} \le 100$), zero negative stock enforcement, positive line quantities, mandatory cheque numbers for cheque sales, dataset import error reporting, and pre-restore SQLite safety snapshots.

---
*End of Deliverables Document.*
