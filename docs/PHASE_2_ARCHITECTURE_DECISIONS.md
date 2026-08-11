# ALUMFAB POS — PHASE 2 ARCHITECTURE DECISIONS RECORD (ADR)

**Document Version:** 2.0.0 (Phase 2 Domain ADRs)  
**Status:** Approved Architectural Standard  

---

## ADR-22: Complete Relational Schema for Bulk Aluminium POS Domain
* **Decision**: Define a comprehensive Prisma SQLite schema containing `Company`, `Branch`, `Product`, `BranchInventory`, `Customer`, `InvoiceSequence`, `Sale`, `SaleItem`, `StockMovement`, and `AuditLog`.
* **Rationale**: Establishes strict foreign key constraints and type safety across all multi-branch business entities.

---

## ADR-23: Branch-Scoped Stock Isolation with Global Product Catalog
* **Decision**: Products remain globally defined in master catalog (`Product`), while inventory quantities (`BranchInventory`) are strictly isolated per `branchId`.
* **Rationale**: Enables bulk hardware pricing consistency across branches while maintaining real-time branch-scoped stock balance tracking.

---

## ADR-24: Historical Invoice Snapshot Immutability Protocol
* **Decision**: Sales invoices (`Sale` & `SaleItem`) copy and freeze branch attributes (`snapshotBranchName`, `snapshotBranchGstin`, `snapshotBranchAddress`, `snapshotBranchPhone`, `snapshotBranchState`) and product details (`productName`, `productSku`, `unitPrice`, `sellingUnit`) at invoice creation time.
* **Rationale**: Guarantees historical invoice reprints remain 100% immutable and accurate, unaffected by future branch address, phone, or master catalog edits.

---

## ADR-25: Explicit Unit Normalization Mapping Rules (RFT -> FT)
* **Decision**: Standardize application units to `Pcs`, `FT`, `Meter`, `Kg`, `Box`. Explicitly map raw `RFT` (Running Feet) inputs to `FT` while preserving original raw strings in `sourceUnit`.
* **Rationale**: Prevents unit mapping confusion across aluminium profiles while auditing original source data.

---

## ADR-26: Strict Zero Negative Stock Enforcement Policy
* **Decision**: Inventory deductions validate available stock balance before executing transactions. If deduction would drop stock below zero, the transaction is rejected with an explicit error.
* **Rationale**: Maintains accurate physical inventory balances and prevents phantom stock counts.

---

## ADR-27: Automated Seed Bootstrap for Single Company & Default Outlets
* **Decision**: `DatabaseService.bootstrap()` automatically seeds default Single Company profile, Main Branch, master product catalog, branch stock levels, and Walk-in customer on first database launch if records do not exist.
* **Rationale**: Ensures immediate application usability and provides realistic test data for desktop installation.

---

## ADR-28: Structured Audit Trail Engine for Branch Master Data Modifications
* **Decision**: Record `AuditLog` entries whenever branch address, GSTIN, phone, state, invoice prefix, or logo attributes change.
* **Rationale**: Provides clear operational compliance logging for multi-branch store operations.
