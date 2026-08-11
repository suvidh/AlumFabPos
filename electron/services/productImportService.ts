/**
 * productImportService.ts
 *
 * ALUMFAB POS — Product Dataset Import Service (Electron main process only)
 *
 * Architecture contract:
 *   - Runs EXCLUSIVELY in Electron main process.
 *   - React renderer communicates via typed IPC only.
 *   - Source ODS file is READ-ONLY; never modified.
 *   - No GST fields, no BranchInventory, no opening stock.
 *   - Prices are GST-INCLUSIVE; stored as integer paise (₹1 = 100 paise).
 *
 * Import pipeline:
 *   1. parseOdsFile()       → RawOdsRow[]
 *   2. validateRows()       → ImportDryRunResult (per-row status, warnings, errors)
 *   3. User reviews preview → chooses conflict strategy (SKIP | UPDATE | CANCEL)
 *   4. commitImport()       → Prisma transaction, all-or-nothing
 */

import { PrismaClient, SellingUnit } from '@prisma/client';
import { parseOdsFile, RawOdsRow } from './odsParser';

// ============================================================
// Public contract types (also used by IPC layer)
// ============================================================

export type ConflictStrategy = 'SKIP' | 'UPDATE_EXISTING' | 'CANCEL_IMPORT';

export type RowStatus = 'NEW' | 'SKIP' | 'UPDATE' | 'ERROR';

export interface ImportRowResult {
  rowNumber: number;
  sku: string;
  name: string;
  price: number;       // in rupees (display)
  pricePaise: number;  // in paise (storage)
  sellingUnit: SellingUnit;
  sourceUnit: string;
  barcode: string;
  status: RowStatus;
  warnings: string[];
  errors: string[];
}

export interface ImportDryRunResult {
  sourceFile: string;
  sheetName: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  newProducts: number;
  existingSkuConflicts: number;
  barcodeConflicts: number;
  rows: ImportRowResult[];
}

export interface CommitResult {
  success: boolean;
  importedCount: number;
  skippedCount: number;
  updatedCount: number;
  errors: string[];
}

// ============================================================
// Unit normalization
// ============================================================

const SUPPORTED_UNITS: Record<string, SellingUnit> = {
  PCS:     SellingUnit.PCS,
  PC:      SellingUnit.PCS,
  PIECE:   SellingUnit.PCS,
  PIECES:  SellingUnit.PCS,
  RFT:     SellingUnit.RFT,  // Preserved as RFT — NOT converted to FT
  FT:      SellingUnit.FT,
  FEET:    SellingUnit.FT,
  FOOT:    SellingUnit.FT,
  M:       SellingUnit.METER,
  MTR:     SellingUnit.METER,
  METER:   SellingUnit.METER,
  METERS:  SellingUnit.METER,
  KG:      SellingUnit.KG,
  KGS:     SellingUnit.KG,
  LENGTH:  SellingUnit.LENGTH,
  LEN:     SellingUnit.LENGTH,
  SET:     SellingUnit.SET,
  SETS:    SellingUnit.SET,
};

function normalizeUnit(rawPer: string): { sellingUnit: SellingUnit; sourceUnit: string; unknown: boolean } {
  const source = rawPer.trim();
  const upper = source.toUpperCase();
  if (SUPPORTED_UNITS[upper]) {
    return { sellingUnit: SUPPORTED_UNITS[upper], sourceUnit: source, unknown: false };
  }
  return { sellingUnit: SellingUnit.PCS, sourceUnit: source, unknown: true }; // fallback with warning
}

/**
 * Convert rupees string to integer paise.
 * Rule: ₹18 → 1800, ₹160 → 16000, ₹2200 → 220000
 * Returns null if the value is not a valid non-negative number.
 */
function toPaise(priceRaw: string): number | null {
  const cleaned = priceRaw.trim();
  if (cleaned === '' || isNaN(Number(cleaned))) return null;
  const rupees = parseFloat(cleaned);
  if (!isFinite(rupees) || rupees < 0) return null;
  return Math.round(rupees * 100);
}

// ============================================================
// Validation pass (pure — no DB access)
// ============================================================

interface PreValidatedRow {
  rowNumber: number;
  name: string;
  sku: string;
  priceRaw: string;
  pricePaise: number | null;
  priceRupees: number;
  sellingUnit: SellingUnit;
  sourceUnit: string;
  barcode: string;
  warnings: string[];
  errors: string[];
}

function validateRawRows(rawRows: RawOdsRow[]): PreValidatedRow[] {
  const seenSkus    = new Map<string, number>(); // sku → first rowNumber
  const seenBarcodes = new Map<string, number>(); // barcode → first rowNumber

  return rawRows.map((raw) => {
    const warnings: string[] = [];
    const errors: string[]   = [];

    // --- Name validation ---
    if (!raw.hardwareName) {
      errors.push('Missing HardwareName (required)');
    }

    // --- SKU validation ---
    if (!raw.productCode) {
      errors.push('Missing ProductCode/SKU (required)');
    }

    // --- Price validation ---
    const pricePaise = toPaise(raw.priceRaw);
    let priceRupees = 0;

    if (pricePaise === null) {
      errors.push(`Invalid price value: "${raw.priceRaw}" — must be a non-negative number`);
    } else {
      priceRupees = pricePaise / 100;
      // Zero price — WARNING, not error (H103 is a valid known case)
      if (pricePaise === 0) {
        warnings.push(
          `${raw.productCode} - ${raw.hardwareName} has selling price ₹0. ` +
          `Verify this is intentional before committing.`
        );
      }
    }

    // --- Unit validation ---
    const { sellingUnit, sourceUnit, unknown } = normalizeUnit(raw.perRaw);
    if (!raw.perRaw) {
      errors.push('Missing Per/unit value (required)');
    } else if (unknown) {
      warnings.push(
        `Unknown unit "${raw.perRaw}" in row ${raw.rowNumber} — ` +
        `defaulted to PCS. Verify or correct before committing.`
      );
    }

    // --- Intra-file duplicate SKU ---
    if (raw.productCode) {
      const skuUpper = raw.productCode.toUpperCase();
      if (seenSkus.has(skuUpper)) {
        errors.push(
          `Duplicate SKU "${raw.productCode}" — first seen at row ${seenSkus.get(skuUpper)}`
        );
      } else {
        seenSkus.set(skuUpper, raw.rowNumber);
      }
    }

    // --- Intra-file duplicate Barcode ---
    if (raw.barcode) {
      if (seenBarcodes.has(raw.barcode)) {
        errors.push(
          `Duplicate barcode "${raw.barcode}" — first seen at row ${seenBarcodes.get(raw.barcode)}`
        );
      } else {
        seenBarcodes.set(raw.barcode, raw.rowNumber);
      }
    }

    return {
      rowNumber:   raw.rowNumber,
      name:        raw.hardwareName,
      sku:         raw.productCode,
      priceRaw:    raw.priceRaw,
      pricePaise,
      priceRupees,
      sellingUnit,
      sourceUnit,
      barcode:     raw.barcode,
      warnings,
      errors,
    };
  });
}

// ============================================================
// Dry-run (includes DB conflict detection)
// ============================================================

/**
 * Run the full validation pass against the ODS file and the current DB state.
 * Returns a structured ImportDryRunResult — NO writes to the database.
 *
 * @param prisma       - Prisma client (read-only usage here)
 * @param odsFilePath  - Absolute path to the ODS file (READ-ONLY)
 */
export async function runImportDryRun(
  prisma: PrismaClient,
  odsFilePath: string
): Promise<ImportDryRunResult> {
  // 1. Parse ODS
  const { sheetName, totalDataRows, rows: rawRows } = parseOdsFile(odsFilePath);

  // 2. Intra-file validation (pure, no DB)
  const preValidated = validateRawRows(rawRows);

  // 3. DB conflict checks — fetch existing SKUs and barcodes
  const [existingProducts] = await Promise.all([
    prisma.product.findMany({
      select: { id: true, sku: true, barcode: true },
    }),
  ]);

  const dbSkuMap     = new Map(existingProducts.map(p => [p.sku.toUpperCase(), p.id]));
  const dbBarcodeMap = new Map(
    existingProducts
      .filter(p => p.barcode)
      .map(p => [p.barcode as string, p.sku])
  );

  // 4. Build final row results
  let warningRows        = 0;
  let errorRows          = 0;
  let newProducts        = 0;
  let existingSkuConflicts = 0;
  let barcodeConflicts   = 0;

  const resultRows: ImportRowResult[] = preValidated.map((pv) => {
    const warnings = [...pv.warnings];
    const errors   = [...pv.errors];

    // DB SKU conflict
    const skuUpper = pv.sku.toUpperCase();
    let hasSkuConflict = false;
    if (pv.sku && dbSkuMap.has(skuUpper)) {
      hasSkuConflict = true;
      existingSkuConflicts++;
      warnings.push(
        `SKU "${pv.sku}" already exists in the database. ` +
        `Conflict strategy (SKIP/UPDATE/CANCEL) required.`
      );
    }

    // DB Barcode conflict (barcode belongs to a DIFFERENT SKU)
    if (pv.barcode && dbBarcodeMap.has(pv.barcode)) {
      const ownerSku = dbBarcodeMap.get(pv.barcode);
      if (ownerSku && ownerSku.toUpperCase() !== skuUpper) {
        barcodeConflicts++;
        errors.push(
          `Barcode "${pv.barcode}" already belongs to SKU "${ownerSku}" ` +
          `in the database — conflict must be resolved before import.`
        );
      }
    }

    // Determine status
    let status: RowStatus;
    if (errors.length > 0) {
      status = 'ERROR';
      errorRows++;
    } else if (hasSkuConflict) {
      status = 'SKIP'; // default — will be overridden by strategy at commit time
      if (warnings.length > 0) warningRows++;
    } else {
      status = 'NEW';
      newProducts++;
      if (warnings.length > 0) warningRows++;
    }

    return {
      rowNumber:   pv.rowNumber,
      sku:         pv.sku,
      name:        pv.name,
      price:       pv.priceRupees,
      pricePaise:  pv.pricePaise ?? 0,
      sellingUnit: pv.sellingUnit,
      sourceUnit:  pv.sourceUnit,
      barcode:     pv.barcode,
      status,
      warnings,
      errors,
    };
  });

  const validRows = totalDataRows - errorRows;

  return {
    sourceFile:          odsFilePath,
    sheetName,
    totalRows:           totalDataRows,
    validRows,
    warningRows,
    errorRows,
    newProducts,
    existingSkuConflicts,
    barcodeConflicts,
    rows:                resultRows,
  };
}

// ============================================================
// Commit — Prisma transaction (all-or-nothing)
// ============================================================

/**
 * Commit the import inside a single Prisma transaction.
 * If ANY write fails, the entire transaction rolls back — no partial import.
 *
 * Conflict strategy:
 *   SKIP           — skip rows with existing SKU (default, non-destructive)
 *   UPDATE_EXISTING — update name/price/unit/barcode for existing SKU
 *   CANCEL_IMPORT  — abort immediately, return success=false, zero writes
 *
 * DOES NOT:
 *   - Create BranchInventory records
 *   - Set opening stock quantities
 *   - Invent GST/Category/Brand/Profile/Size fields
 *   - Modify the source ODS file
 *
 * @param prisma           - Prisma client
 * @param dryRunResult     - Result from runImportDryRun()
 * @param conflictStrategy - Admin-chosen strategy for SKU conflicts
 */
export async function commitImport(
  prisma: PrismaClient,
  dryRunResult: ImportDryRunResult,
  conflictStrategy: ConflictStrategy
): Promise<CommitResult> {

  // CANCEL_IMPORT — abort immediately, no writes
  if (conflictStrategy === 'CANCEL_IMPORT') {
    return {
      success:       false,
      importedCount: 0,
      skippedCount:  0,
      updatedCount:  0,
      errors:        ['Import cancelled by admin (CANCEL_IMPORT strategy).'],
    };
  }

  // Filter rows eligible for import (no hard errors)
  const eligibleRows = dryRunResult.rows.filter(r => r.errors.length === 0);
  const erroredRows  = dryRunResult.rows.filter(r => r.errors.length > 0);

  if (erroredRows.length > 0 && conflictStrategy !== 'SKIP') {
    // Rows with hard errors can never be imported regardless of strategy
    // Just note them in the result — they are excluded from the transaction
  }

  let importedCount = 0;
  let skippedCount  = 0;
  let updatedCount  = 0;
  const commitErrors: string[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      // Re-fetch DB state inside transaction for consistency
      const existingInDb = await tx.product.findMany({
        select: { id: true, sku: true, barcode: true },
      });
      const dbSkuMap = new Map(existingInDb.map(p => [p.sku.toUpperCase(), p.id]));

      for (const row of eligibleRows) {
        const skuUpper = row.sku.toUpperCase();
        const existsInDb = dbSkuMap.has(skuUpper);

        if (existsInDb) {
          // --- Existing SKU: apply conflict strategy ---
          if (conflictStrategy === 'SKIP') {
            skippedCount++;
            continue;
          }

          if (conflictStrategy === 'UPDATE_EXISTING') {
            const existingId = dbSkuMap.get(skuUpper)!;
            await tx.product.update({
              where: { id: existingId },
              data: {
                name:               row.name,
                sellingPricePaise:  row.pricePaise,
                sellingUnit:        row.sellingUnit,
                sourceUnit:         row.sourceUnit,
                barcode:            row.barcode || null,
                // Intentionally NOT touching: category, brand, profile,
                // size, finish, weight, length, minimumStock — preserve existing values
              },
            });
            updatedCount++;
          }
        } else {
          // --- New product: create ---
          await tx.product.create({
            data: {
              sku:               row.sku,
              name:              row.name,
              sellingPricePaise: row.pricePaise,
              sellingUnit:       row.sellingUnit,
              sourceUnit:        row.sourceUnit,
              barcode:           row.barcode || null,
              isActive:          true,
              // Fields NOT set (null): categoryId, brand, profile, size,
              //   finish, weightPerPieceMilli, lengthMilli, minimumStockMilli
              // No BranchInventory created — this is product master data only
            },
          });
          importedCount++;
        }
      }
    });

    return {
      success:       true,
      importedCount,
      skippedCount:  skippedCount + erroredRows.length, // errored rows always skipped
      updatedCount,
      errors:        commitErrors,
    };

  } catch (err: any) {
    // Transaction rolled back — no partial state in DB
    return {
      success:       false,
      importedCount: 0,
      skippedCount:  0,
      updatedCount:  0,
      errors:        [`Transaction rolled back: ${err.message}`],
    };
  }
}
