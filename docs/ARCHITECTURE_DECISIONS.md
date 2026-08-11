# ALUMFAB POS — ARCHITECTURE DECISIONS RECORD (ADR)

**Document Version:** 1.0.0  
**Status:** Approved Architectural Standard  

---

## ADR-01: Offline Windows Desktop Architecture Stack
* **Decision**: Build ALUMFAB POS as a 100% offline Windows desktop application using **Electron + React + TypeScript + Tailwind CSS**.
* **Rationale**: Eliminates internet dependency, remote API latency, and cloud subscription costs. Guarantees uninterrupted counter billing during network outages.

---

## ADR-02: Local SQLite Persistence Engine
* **Decision**: Use **Prisma ORM** with a local **SQLite database file (`pos.db`)** stored in `%APPDATA%\ALUMFAB-POS\database\pos.db`.
* **Rationale**: Production data is stored in the Windows user application data directory (`%APPDATA%`), completely isolated from the application installation directory (`Program Files`). Installer updates must NEVER overwrite the production `.db` file.

---

## ADR-03: Integer Paise Monetary Storage
* **Decision**: All prices, discount amounts, taxable values, GST taxes, and totals are calculated and stored as integer minor units (paise, $1\text{ INR} = 100\text{ paise}$).
* **Rationale**: Eliminates IEEE-754 floating-point rounding discrepancies across subtotaling, reverse GST calculations, and financial reporting.

---

## ADR-04: Zero Negative Stock & Append-Only Movement Ledger
* **Decision**: Enforce strict validation blocking transactions attempting to sell more than current available stock (`currentStock - saleQty >= 0`). Audit inventory changes via an append-only `stock_movements` ledger table (`OPENING_STOCK`, `PURCHASE`, `SALE`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`).
* **Rationale**: Prevents inventory corruption, ghost stock records, and physical warehouse inventory mismatches.

---

## ADR-05: Payment Settlement & Mandatory Cheque Validation
* **Decision**: Restrict Version 1 payment modes strictly to **CASH** and **CHEQUE**. When payment mode is `CHEQUE`, enforce mandatory non-empty `chequeNumber` validation.
* **Rationale**: Matches target business operation where sales are settled 100% in full via cash or bank cheques without credit debt or digital gateway fees.

---

## ADR-06: Decoupled Printing & Transaction Integrity
* **Decision**: Decouple physical printer engine execution from SQLite ACID database sales transactions. If printing fails AFTER a sale is committed to the database, the transaction is **NOT** rolled back. The sale is saved successfully, a printer warning is displayed, and invoice reprinting is enabled from Sales History.
* **Rationale**: Prevents printer hardware glitches (e.g. out of paper, paper jam) from causing phantom invoice rollbacks or duplicate database entries.

---

## ADR-07: Database Safety Snapshot & Validated Restore Protocol
* **Decision**: Require pre-restore SQLite schema validation and mandatory creation of an automated **Pre-Restore Safety Snapshot** of the active production database before performing any database restore operation.
* **Rationale**: Protects business records against corrupted backup files or accidental data replacement.

---

## ADR-08: Decoupled Data Schemas for Deferred Modules
* **Decision**: Design Prisma schemas and service layer contracts with clean decoupling so deferred modules (Quotations, Sales Returns, Customer Credit Ledgers) can be introduced in future phases without breaking core database schemas or existing sales workflows.
* **Rationale**: Ensures Phase 1 implementation is clean and unencumbered by unused V1 UI screens while preserving long-term extensibility.

---

## ADR-09: Immutable Sale & Invoice Snapshot Integrity
* **Decision**: When a sale is committed, store an immutable snapshot of all customer details, line item rates, product descriptions, tax rates, tax splits, and monetary amounts directly on `Sale` and `SaleItem` records.
* **Rationale**: Future updates to master entities (such as changing a product's price in the master catalog or editing a customer's address in the customer directory) MUST NEVER retroactively alter or mutate historic invoice records. Reprinted invoices from Sales History will always render exact snapshot values captured at billing time.

---

## ADR-10: Single Company / Multi-Branch Domain Model
* **Decision**: Model the business organization as a central `Company` entity with 1-to-N `Branch` entities.
* **Rationale**: Enables branch-wise editable addresses, GSTINs, phone numbers, state tax splits, invoice prefixes, and local logo assets without transforming the desktop app into a multi-tenant cloud application.

---

## ADR-11: Company-Global Product Master / Branch-Specific Inventory
* **Decision**: Product catalog definitions (`Product` entity) are Company-Global, while inventory balances (`quantity`) are maintained per branch via `BranchInventory` (`branchId + productId`).
* **Rationale**: Prevents catalog duplication across branches while guaranteeing per-branch stock balance accuracy and per-branch zero negative stock pre-checks.

---

## ADR-12: Asset-Aware Backup Package Archive
* **Decision**: Database backup services create a bundled **Backup Package Archive** (`.zip`) containing the SQLite database (`pos.db`), application-managed logo files (`%APPDATA%\ALUMFAB-POS\assets\logos\`), and `manifest.json`.
* **Rationale**: Restoring a backup preserves all database records and brand logo files simultaneously, preventing broken logo references on historic invoice reprints.

---

## ADR-13: Branch & Product Soft-Deactivation Strategy
* **Decision**: Branches and Products linked to historic sales, stock movements, or inventory balances MUST NOT be hard-deleted. Set `isActive = false` (**DEACTIVATE, NOT DELETE**).
* **Rationale**: Preserves database referential integrity, historical sales auditing, and invoice reprint reliability.
