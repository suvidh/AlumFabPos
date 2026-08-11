# ALUMFAB POS — PHASE 2 IMPLEMENTATION SPECIFICATION

**Document Version:** 2.0.0 (Phase 2 Database & Domain Foundation)  
**Date:** August 2026  
**Status:** COMPLETE & VERIFIED  
**Application Name:** ALUMFAB POS  
**Target Operating System:** Windows Desktop (100% Offline Application)  

---

## 1. PHASE 2 OBJECTIVES & SCOPE
Phase 2 establishes the core SQLite database models, domain services, unit normalization engine, branch-scoped stock balance rules, and typed IPC communication channels for ALUMFAB POS.

---

## 2. DATABASE DOMAIN MODELS (`prisma/schema.prisma`)

* **`AppMeta`**: Schema versioning (schemaVersion = 2) and initialization timestamp.
* **`Company`**: Single company profile model (`name`, `legalName`, `taxId`/GSTIN, `phone`, `email`, `state`, `address`, `logoPath`, `defaultBranchId`).
* **`Branch`**: Multi-branch support (`code`, `name`, `address`, `gstin`, `phone`, `state`, `invoicePrefix`, `logoPath`, `isActive`).
* **`Product`**: Master product catalog (`sku`, `name`, `category`, `sellingPrice`, `sellingUnit`, `sourceUnit`, `barcode`, `isActive`).
* **`BranchInventory`**: Branch-scoped stock balance (`branchId`, `productId`, `quantity`, `minStockLevel`, `lastRestockedAt`).
* **`Customer`**: Customer directory (`name`, `phone`, `gstin`, `state`, `address`, `creditLimit`, `currentBalance`).
* **`InvoiceSequence`**: Per-branch sequential invoice numbering (`branchId`, `financialYear`, `nextNumber`).
* **`Sale`**: Historical invoice ledger with snapshot fields (`invoiceNumber`, `branchId`, `customerId`, `subtotal`, `discountAmount`, `discountType`, `taxAmount`, `totalAmount`, `paymentMode`, `snapshotBranchName`, `snapshotBranchGstin`, `snapshotBranchAddress`, `snapshotBranchPhone`, `snapshotBranchState`).
* **`SaleItem`**: Historical invoice line items snapshot (`saleId`, `productId`, `productName`, `productSku`, `unitPrice`, `quantity`, `sellingUnit`, `taxRate`, `taxAmount`, `lineTotal`).
* **`StockMovement`**: Stock movement audit log (`branchId`, `productId`, `type`, `quantity`, `referenceId`, `notes`).
* **`AuditLog`**: System audit trail (`branchId`, `entity`, `action`, `details`, `timestamp`).

---

## 3. UNIT NORMALIZATION RULES (`UnitNormalizer`)
* Supported application domain units: `Pcs`, `FT`, `Meter`, `Kg`, `Box`.
* `RFT` (Running Feet) is explicitly mapped to `FT` (Feet).
* Original raw source string is preserved in `sourceUnit` while application domain uses `sellingUnit`.

---

## 4. ZERO NEGATIVE STOCK ENFORCEMENT
* Inventory deductions check available stock balance before executing transactions.
* Attempting to adjust or sell quantities greater than available branch balance throws an explicit error: `"Insufficient stock in branch... Negative stock balance prohibited."`

---

## 5. TYPED IPC DOMAIN CHANNELS (`window.alumfab`)

| Channel | Method | Description |
| :--- | :--- | :--- |
| `company:get` | `getCompany()` | Query single company profile & default branch |
| `company:update` | `updateCompany(id, data)` | Update company profile attributes |
| `branch:get-all` | `getAllBranches()` | List all company branches |
| `branch:create` | `createBranch(data)` | Create new branch & log AuditLog |
| `branch:update` | `updateBranch(id, data)` | Update branch GSTIN, phone, state, or prefix |
| `product:get-all` | `getAllProducts()` | Query master product catalog |
| `product:create` | `createProduct(data)` | Create product with unit normalization |
| `inventory:get-branch` | `getBranchInventory(branchId)` | Query branch-scoped stock balances |
| `inventory:adjust` | `adjustStock(...)` | Adjust stock balance with zero negative stock check |
| `customer:get-all` | `getAllCustomers()` | Query customer directory |
| `customer:create` | `createCustomer(data)` | Create customer profile |
| `sale:create` | `createSale(data)` | Create sale invoice with branch & item snapshots |
| `sale:get-all` | `getAllSales(branchId)` | Query historical sales ledger |
