/**
 * odsParser.ts
 *
 * ODS file parser for the ALUMFAB POS product import pipeline.
 *
 * Architecture contract:
 *   - This module runs EXCLUSIVELY in the Electron main process.
 *   - It reads the ODS file as READ-ONLY. The source file is NEVER modified.
 *   - It returns plain structured data objects; no Prisma/DB access here.
 *   - The ODS format is a ZIP archive containing content.xml (ODF standard).
 *
 * Dependency: adm-zip (already installed as dev-dependency).
 */

import * as path from 'path';
import * as fs from 'fs';
import AdmZip from 'adm-zip';

// ============================================================
// Types
// ============================================================

export interface RawOdsRow {
  /** 1-based row number in the source file (excluding header = row 1) */
  rowNumber: number;
  hardwareName: string;
  productCode: string;
  priceRaw: string;
  perRaw: string;
  barcode: string;
}

export interface OdsParseResult {
  sheetName: string;
  totalDataRows: number;
  rows: RawOdsRow[];
}

// ============================================================
// Column index constants (0-based, validated against actual header)
// ============================================================

const EXPECTED_HEADERS = ['HardwareName', 'ProductCode', 'Price', 'Per', 'Barcode'] as const;
const COL_NAME    = 0;
const COL_SKU     = 1;
const COL_PRICE   = 2;
const COL_PER     = 3;
const COL_BARCODE = 4;

// ============================================================
// Internal XML helpers
// ============================================================

/**
 * Parse an ODS content.xml string into a 2D array of string values.
 * Handles table:number-columns-repeated for blank cells.
 * Returns { sheetName, rows } where rows[0] is the header row.
 */
function parseOdsXml(xml: string): { sheetName: string; allRows: string[][] } {
  // Extract first table element
  const tableMatch = /<table:table\b[^>]*?table:name="([^"]*)"[^>]*>([\s\S]*?)<\/table:table>/.exec(xml);
  if (!tableMatch) {
    throw new Error('ODS content.xml: no table:table element found');
  }

  const sheetName = tableMatch[1];
  const tableBody = tableMatch[2];

  const allRows: string[][] = [];

  // Iterate over table:table-row elements
  const rowRegex = /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(tableBody)) !== null) {
    const rowXml = rowMatch[1];
    const cells: string[] = [];

    // Iterate over table:table-cell elements (self-closing or with content)
    const cellRegex = /<table:table-cell\b([^>]*)>([\s\S]*?)<\/table:table-cell>|<table:table-cell\b([^>]*)\/>/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
      const attrs   = cellMatch[1] || cellMatch[3] || '';
      const inner   = cellMatch[2] || '';

      // Parse number-columns-repeated
      const repMatch = /table:number-columns-repeated="(\d+)"/.exec(attrs);
      const repeat   = repMatch ? parseInt(repMatch[1], 10) : 1;

      // Extract text content (strip any child tags like text:span)
      const textMatch = /<text:p[^>]*>([\s\S]*?)<\/text:p>/.exec(inner);
      const val = textMatch ? textMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      // Expand repeated blank cells up to a safe limit to avoid memory issues
      // Real data cells are never repeated (repeat > 1 only happens for trailing blanks)
      const expandCount = (val === '') ? Math.min(repeat, 20) : repeat;
      for (let i = 0; i < expandCount; i++) {
        cells.push(val);
      }
    }

    // Trim trailing empty cells
    while (cells.length > 0 && cells[cells.length - 1] === '') {
      cells.pop();
    }

    if (cells.length > 0) {
      allRows.push(cells);
    }
  }

  return { sheetName, allRows };
}

// ============================================================
// Public API
// ============================================================

/**
 * Parse the hardware.ods file and return all raw data rows.
 *
 * @param odsFilePath - Absolute path to the ODS file (READ-ONLY).
 * @throws Error if the file is missing, not a valid ODS, or has unexpected structure.
 */
export function parseOdsFile(odsFilePath: string): OdsParseResult {
  // --- Safety: verify file exists and is readable ---
  if (!fs.existsSync(odsFilePath)) {
    throw new Error(`ODS file not found: ${odsFilePath}`);
  }

  const stat = fs.statSync(odsFilePath);
  if (!stat.isFile()) {
    throw new Error(`ODS path is not a file: ${odsFilePath}`);
  }

  // --- Extract ZIP (ODS is a ZIP archive) ---
  let zip: AdmZip;
  try {
    zip = new AdmZip(odsFilePath);
  } catch (err: any) {
    throw new Error(`Failed to open ODS as ZIP archive: ${err.message}`);
  }

  const contentXml = zip.readAsText('content.xml');
  if (!contentXml) {
    throw new Error('ODS archive does not contain content.xml');
  }

  // --- Parse XML ---
  const { sheetName, allRows } = parseOdsXml(contentXml);

  if (allRows.length === 0) {
    throw new Error('ODS file contains no rows');
  }

  // --- Validate header ---
  const header = allRows[0];
  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    const expected = EXPECTED_HEADERS[i];
    const actual = (header[i] || '').trim();
    if (actual !== expected) {
      throw new Error(
        `ODS header mismatch at column ${i}: expected "${expected}", found "${actual}". ` +
        `Full header: ${JSON.stringify(header)}`
      );
    }
  }

  // --- Map data rows ---
  const dataRows = allRows.slice(1); // skip header
  const rows: RawOdsRow[] = dataRows.map((cells, idx) => ({
    rowNumber: idx + 2, // 1-based; row 1 = header, so data starts at 2
    hardwareName: (cells[COL_NAME]    || '').trim(),
    productCode:  (cells[COL_SKU]     || '').trim(),
    priceRaw:     (cells[COL_PRICE]   || '').trim(),
    perRaw:       (cells[COL_PER]     || '').trim(),
    barcode:      (cells[COL_BARCODE] || '').trim(),
  }));

  return {
    sheetName,
    totalDataRows: rows.length,
    rows,
  };
}
