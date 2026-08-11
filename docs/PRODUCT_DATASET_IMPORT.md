# ALUMFAB POS — Product Dataset Import

**Document version:** 1.0.0  
**Date:** August 2026  
**Status:** IMPLEMENTED & TESTED

---

## 1. Source File

| Field | Value |
|---|---|
| **Filename** | `hardware.ods` |
| **Format** | OpenDocument Spreadsheet (ODS / ZIP + XML) |
| **Sheet name** | `hardware` |
| **Total data rows** | **181 products** |
| **Header row** | `HardwareName`, `ProductCode`, `Price`, `Per`, `Barcode` |
| **Access policy** | **READ-ONLY** — the source file is never modified or overwritten |

---

## 2. Column Mapping

| ODS Column | Target Model Field | Data Type | Notes |
|---|---|---|---|
| `HardwareName` | `Product.name` | String | Required. Trimmed. |
| `ProductCode` | `Product.sku` | String | Required. Unique. Used as upsert key. |
| `Price` | `Product.sellingPricePaise` | Integer (paise) | Required. See §4. |
| `Per` | `Product.sellingUnit` + `Product.sourceUnit` | Enum + String | Required. See §5. |
| `Barcode` | `Product.barcode` | String? | Optional per schema. All 181 rows have values. |

**Fields NOT imported** (left `null`): `categoryId`, `brand`, `profile`, `size`, `finish`, `weightPerPieceMilli`, `lengthMilli`, `minimumStockMilli`.  
These are not present in the source file and must never be invented.

---

## 3. GST-Inclusive Pricing Rule

> **All source prices are FINAL GST-INCLUSIVE prices.**

The source `Price` column represents the final selling price already inclusive of GST.  
The importer stores this price directly as paise **without any GST reverse-calculation**.

**What this means on invoices:**  
Invoice line items will carry the wording **"GST Included in Product Price"** — no separate CGST/SGST/IGST breakdown is computed from the import data.

**What is strictly forbidden:**
- Do NOT compute taxable value (`Price ÷ 1.18`)
- Do NOT compute CGST, SGST, IGST amounts
- Do NOT add a GST rate field to imported products
- Do NOT modify imported prices for any GST reason

---

## 4. Price-to-Paise Conversion

```
paise = ROUND(source_price_rupees × 100)
```

| Source (₹) | Stored (paise) |
|---|---|
| 18 | 1800 |
| 26 | 2600 |
| 160 | 16000 |
| 2200 | 220000 |
| 0 | 0 (zero-price warning) |

The conversion uses `Math.round()` to avoid floating-point errors.

---

## 5. Unit Mapping & RFT Preservation

### Dataset distribution
| Unit in ODS | Count | Normalized enum |
|---|---|---|
| `Pcs` | 180 | `SellingUnit.PCS` |
| `RFT` | 1 | `SellingUnit.RFT` |

### Normalization rules
- Case-insensitive: `Pcs`, `pcs`, `PCS` → `PCS`
- `RFT` (Running Feet) → **`RFT`** — preserved exactly as-is
- `RFT` is **NOT** converted to `FT`; it is a separate supported enum value

### RFT product
| SKU | Name | Price | Unit |
|---|---|---|---|
| `H162` | EURO GROOVE POLYAMIDE ROD | ₹160 | RFT |

### sourceUnit field
The raw Per value from the ODS (e.g. `Pcs`, `RFT`) is preserved in `Product.sourceUnit` to prevent data loss even for known units.

---

## 6. Zero-Price Warning Rule

One product has a selling price of ₹0:

| SKU | Name | Price |
|---|---|---|
| `H103` | R-40 CONNECTOR | ₹0 |

**Behaviour:**
- Zero price is **NOT** an error — the product is importable
- A **WARNING** is generated: _"H103 - R-40 CONNECTOR has selling price ₹0. Verify this is intentional before committing."_
- The Admin sees this warning in the dry-run preview
- The Admin must explicitly confirm before the import is committed

---

## 7. Validation Rules

Every row is validated for the following before any database write:

| Check | Severity | Description |
|---|---|---|
| Missing `HardwareName` | ERROR | Row rejected |
| Missing `ProductCode` | ERROR | Row rejected |
| Non-numeric `Price` | ERROR | Row rejected |
| Negative `Price` | ERROR | Row rejected |
| Missing `Per` unit | ERROR | Row rejected |
| `Price = 0` | WARNING | Importable with explicit admin confirmation |
| Unknown unit string | WARNING | Defaulted to PCS; admin must review |
| Duplicate SKU (within file) | ERROR | Row rejected |
| Duplicate Barcode (within file) | ERROR | Row rejected |
| SKU exists in DB | WARNING + conflict strategy required | See §8 |
| Barcode belongs to different DB SKU | ERROR | Conflict must be corrected |

---

## 8. Database Conflict Handling

Existing products are **NEVER silently overwritten**.

When an import SKU already exists in the database, Admin must choose one of:

| Strategy | Behaviour |
|---|---|
| **SKIP** (default) | Rows with existing SKU are skipped — DB record unchanged |
| **UPDATE_EXISTING** | `name`, `sellingPricePaise`, `sellingUnit`, `sourceUnit`, `barcode` updated; all other fields preserved |
| **CANCEL_IMPORT** | Entire import is aborted — zero writes to database |

For a barcode collision where the barcode already belongs to a **different SKU** in the database, the row is rejected as a hard ERROR regardless of strategy (manual correction required).

---

## 9. Dry-Run Workflow

The import pipeline follows a mandatory dry-run preview before any commit:

```
1. Admin selects ODS file path
       ↓
2. IPC: product:import-dry-run
       ↓
3. Electron main: parseOdsFile()
   → Reads hardware.ods (READ-ONLY)
   → Validates header
   → Maps 181 rows
       ↓
4. validateRawRows()
   → Intra-file validation (no DB)
   → Per-row: name, SKU, price, unit checks
   → Intra-file duplicate SKU / barcode detection
       ↓
5. DB conflict check
   → Reads existing Product SKUs and barcodes
   → Marks existingSkuConflicts / barcodeConflicts
       ↓
6. Return ImportDryRunResult to renderer
   → totalRows, validRows, warningRows, errorRows
   → newProducts, existingSkuConflicts, barcodeConflicts
   → Per-row: status, warnings[], errors[]
       ↓
7. Admin reviews preview in UI
   → Sees zero-price warning for H103
   → Sees any SKU conflicts
   → Chooses conflict strategy: SKIP | UPDATE_EXISTING | CANCEL_IMPORT
       ↓
8. Admin confirms → IPC: product:import-commit
```

**Expected dry-run result for hardware.ods against empty Product table:**

| Metric | Expected |
|---|---|
| Total rows | 181 |
| Valid rows | 181 |
| Warning rows | 1 (H103 zero-price) |
| Error rows | 0 |
| New products | 181 |
| Existing SKU conflicts | 0 |
| Barcode conflicts | 0 |

These values are derived from the file dynamically — not hard-coded.

---

## 10. Transaction Safety

The commit step uses a single **Prisma `$transaction()`** block:

- All product writes execute inside one atomic transaction
- If **any single write fails**, the entire transaction rolls back
- The database is left in the **exact state it was before the import started**
- Partial imports are architecturally impossible
- Error rows are excluded before the transaction begins
- The transaction re-reads the DB state internally to prevent TOCTOU race conditions

---

## 11. Architecture Boundaries

```
[Renderer / React UI]
       │  IPC only — no direct DB/FS access
       │  Typed via AlumfabAPI contract
       ↓
[Electron Preload — api.ts]
       │  ipcRenderer.invoke()
       ↓
[Electron Main — handlers.ts]
       │  registerIpcHandlers()
       ↓
[productImportService.ts]      ← validation, conflict strategy, commit
[odsParser.ts]                 ← ODS ZIP extraction, XML parsing, header validation
       ↓
[Prisma Client]
       ↓
[SQLite: pos.db]
```

**React must NOT directly access:** Prisma, SQLite, filesystem, or ODS files.

---

## 12. Files Created / Modified

| File | Action | Purpose |
|---|---|---|
| `electron/services/odsParser.ts` | Created | ODS ZIP + XML parser (READ-ONLY on source) |
| `electron/services/productImportService.ts` | Created | Validation, dry-run, commit service |
| `electron/ipc/channels.ts` | Modified | 3 new import channel constants |
| `electron/ipc/contracts.ts` | Modified | Import types + 3 AlumfabAPI methods |
| `electron/ipc/handlers.ts` | Modified | 3 registered IPC import handlers |
| `electron/preload/api.ts` | Modified | Import methods wired to ipcRenderer |
| `scripts/productImport.test.js` | Created | 33 test cases (all passing) |
| `docs/PRODUCT_DATASET_IMPORT.md` | Created | This document |

---

## 13. Test Coverage

33 tests, 0 failures:

| Group | Tests | Coverage |
|---|---|---|
| Dataset size & structure | T01–T04 | 181 rows, sheet name, header, file integrity |
| Unit normalization | T05–T09 | 180 PCS, 1 RFT, RFT≠FT, case-insensitive |
| Price conversion | T10–T14 | H101/H162/max paise, no negatives, all numeric |
| Zero-price warning | T15–T18 | H103 warning not error, 1 zero-price, no GST reverse |
| Duplicate SKU | T19–T20 | No dups in file, intra-file detection flagged as error |
| Duplicate barcode | T21–T22 | No dups in file, intra-file detection flagged as error |
| DB conflict handling | T23–T26 | Warning not overwrite, cross-SKU barcode error, CANCEL/SKIP strategy |
| Transaction safety | T27–T28 | Rollback on failure, error rows excluded |
| GST contract | T29–T30 | No GST fields, price as-is × 100 |
| No BranchInventory | T31–T33 | No stock fields, all 181 rows complete, file unmodified |
