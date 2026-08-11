# ALUMFAB POS — VERSION 1 SCOPE DEFINITION

**Document Version:** 1.0.0  
**Status:** Frozen Scope Lock  
**Application Type:** 100% Offline Windows Desktop Application  

---

## 1. IN-SCOPE FEATURES FOR VERSION 1

### 1.1 Product & Category Master
* Category and Brand management.
* Product Master catalog containing SKUs (unique), Product Names, Brands, Profiles, Sizes, Alloys, Finishes, Selling Units (`KG`, `PCS`, `FT`, `METER`, `LENGTH`, `SET`), Selling Prices, GST Rates, Price Includes GST flags, Weight Per Piece specs, and Length specs.
* Primary Product Search by Product Name, SKU, Profile, and Size.

### 1.2 Excel / CSV Product Dataset Import
* Bulk dataset import with dry-run validation and error reporting (highlighting duplicate SKUs, missing names, invalid prices/GST rates/units).

### 1.3 Multi-Unit Inventory Engine & Stock Ledger
* Multi-unit stock management (`KG`, `PCS`, `FT`, `METER`, `LENGTH`, `SET`).
* Theoretical weight conversion metadata ($\text{PCS} \times \text{weightPerPiece} = \text{Total Weight}$) where product metadata exists.
* Opening Stock setup and manual stock adjustments.
* **Zero Negative Stock Rule**: Block transactions attempting to exceed available stock levels.
* **Append-Only Stock Movement Ledger**: Tracking `OPENING_STOCK`, `PURCHASE`, `SALE`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`.

### 1.4 POS Counter Billing Terminal
* High-speed billing interface with `F2` search focus, `F8` checkout modal, and keyboard hotkeys.
* Manual Rate Adjustments during billing (without altering Master Catalog prices).
* Manual Discounts (Percentage % or Fixed Amount ₹) applied per sale and saved with invoice audit logs.
* Integer Paise GST Tax Calculation ($1\text{ INR} = 100\text{ paise}$) with reverse GST taxable value calculation.

### 1.5 Payment Settlement
* **CASH** and **CHEQUE** payment modes ONLY.
* Mandatory `chequeNumber` validation for Cheque sales (checkout blocked if cheque number is missing).

### 1.6 A4 Dual-Copy Tax Invoicing
* Standard **A4** paper printing.
* Single print action generates two copies: `CUSTOMER COPY` & `COMPANY COPY`.
* Itemized product table, tax breakup (CGST 9% + SGST 9% vs IGST 18%), and payment info.

### 1.7 Sequential Unique Invoice Numbering
* Configurable sequence prefix (`ALF-INV-000001`).
* Unique, non-duplicating, non-reusable, non-recyclable sequence counter.

### 1.8 Sales History Register
* Immutable sales audit history searchable by Invoice Number, Customer Name, Date, Product, and Payment Method.
* Dual A4 invoice reprinting from Sales History.

### 1.9 Offline Backup, Restore & Data Safety Engine
* Manual Backup + Automatic Daily Backup (`ALUMFAB-POS-YYYY-MM-DD-HHMMSS.db`).
* Schema-validated restore protocol with automatic creation of a **Pre-Restore Safety Snapshot** of the active production database.

### 1.10 Company Settings
* Store Trade Name, Address, GSTIN, Phone, State, Company Logo asset path, Invoice Prefix (`ALF-INV-`), Default Currency (**INR / ₹**), and Backup Directory.

---

## 2. EXPLICITLY OUT-OF-SCOPE FEATURES FOR VERSION 1

* 🛑 **Login / Authentication**: No login screen or password gate. The app launches directly into the POS interface (single-machine, single-operator local desktop use case).
* 🛑 **Quotation Module**: Quotation UI screens, forms, tables, and conversion workflows are EXCLUDED in V1 (architecture decoupled for future implementation).
* 🛑 **Customer Credit / Khata**: Customer credit limits, outstanding balances, partial payments, payment installments, and credit ledgers are EXCLUDED in V1.
* 🛑 **Digital Payments**: UPI, QR codes, Credit/Debit Cards, Net Banking, and Wallets are EXCLUDED in V1.
* 🛑 **Sales Returns & Cancellations**: Sales returns (`SALE_RETURN`) UI and invoice cancellation workflows are EXCLUDED in V1.
* 🛑 **Multi-User Permissions**: Multi-role permission matrices (`CASHIER`, `ACCOUNTANT`) are EXCLUDED in V1.
* 🛑 **Cloud Sync & Remote Databases**: Firebase, Supabase, PostgreSQL, online auth, multi-company, multi-branch, mobile apps, and cloud syncing are EXCLUDED.
