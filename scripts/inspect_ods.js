/**
 * inspect_ods.js - Reads and dumps all product data from hardware.ods
 * Uses AdmZip to extract the ODS ZIP and parses content.xml
 * READ-ONLY: never writes to the ODS file.
 */
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

const ODS_PATH = path.join(__dirname, '..', 'hardware.ods');

if (!fs.existsSync(ODS_PATH)) {
  console.error('ERROR: hardware.ods not found at', ODS_PATH);
  process.exit(1);
}

const zip = new AdmZip(ODS_PATH);
const content = zip.readAsText('content.xml');

/**
 * Parse ODS content.xml into rows of string values.
 * Handles table:number-columns-repeated for blank cells.
 */
function parseOdsContent(xml) {
  const rows = [];

  // Extract just the spreadsheet table body
  const tableMatch = /<table:table [^>]*?table:name="([^"]*)"[^>]*>([\s\S]*?)<\/table:table>/g;
  let tableResult;
  const tables = [];

  while ((tableResult = tableMatch.exec(xml)) !== null) {
    tables.push({ name: tableResult[1], body: tableResult[2] });
  }

  if (tables.length === 0) {
    throw new Error('No tables found in content.xml');
  }

  console.log('Tables found:', tables.map(t => t.name));
  const table = tables[0];
  console.log('Using table:', table.name);

  // Parse rows
  const rowRegex = /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(table.body)) !== null) {
    const rowXml = rowMatch[1];
    const cells = [];

    // Parse individual cells
    const cellRegex = /<table:table-cell\b([^>]*)>([\s\S]*?)<\/table:table-cell>|<table:table-cell\b([^>]*)\/>/g;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
      const attrs = cellMatch[1] || cellMatch[3] || '';
      const inner = cellMatch[2] || '';

      // Get number-columns-repeated attribute
      const repeatMatch = /table:number-columns-repeated="(\d+)"/.exec(attrs);
      const repeat = repeatMatch ? parseInt(repeatMatch[1], 10) : 1;

      // Extract text value
      const textMatch = /<text:p[^>]*>([\s\S]*?)<\/text:p>/.exec(inner);
      let val = '';
      if (textMatch) {
        val = textMatch[1].replace(/<[^>]+>/g, '').trim();
      }

      // Only expand up to 10 repeated blank cells (avoid giant expansions)
      const expandCount = (val === '') ? Math.min(repeat, 10) : repeat;
      for (let i = 0; i < expandCount; i++) {
        cells.push(val);
      }
    }

    // Trim trailing empty cells
    while (cells.length > 0 && cells[cells.length - 1] === '') {
      cells.pop();
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return rows;
}

const rows = parseOdsContent(content);
console.log('\n=== PARSE RESULTS ===');
console.log('Non-empty rows (including header):', rows.length);
console.log('\nHeader row [0]:', JSON.stringify(rows[0]));
console.log('Data row  [1]:', JSON.stringify(rows[1]));
console.log('Data row  [2]:', JSON.stringify(rows[2]));
console.log('Data row  [3]:', JSON.stringify(rows[3]));
console.log('Data row  [5]:', JSON.stringify(rows[5]));
console.log('Last row  [' + (rows.length - 1) + ']:', JSON.stringify(rows[rows.length - 1]));

// Stats
const dataRows = rows.slice(1);
console.log('\n=== DATASET STATS ===');
console.log('Data rows (excluding header):', dataRows.length);

// Column indices - detect from header
const header = rows[0];
console.log('Header columns:', header);
const iName = header.findIndex(h => h.toLowerCase().includes('hardwarename') || h.toLowerCase().includes('name'));
const iSku = header.findIndex(h => h.toLowerCase().includes('productcode') || h.toLowerCase().includes('code'));
const iPrice = header.findIndex(h => h.toLowerCase() === 'price');
const iPer = header.findIndex(h => h.toLowerCase() === 'per');
const iBarcode = header.findIndex(h => h.toLowerCase() === 'barcode');

console.log('Column indices -> Name:', iName, 'SKU:', iSku, 'Price:', iPrice, 'Per:', iPer, 'Barcode:', iBarcode);

// Unit distribution
const units = {};
dataRows.forEach(r => {
  const u = (r[iPer] || '').trim();
  units[u] = (units[u] || 0) + 1;
});
console.log('\nUnit distribution:', units);

// Zero price products
const zeroPrices = dataRows.filter(r => parseFloat(r[iPrice] || '0') === 0);
console.log('\nZero-price rows:', zeroPrices.map(r => ({ sku: r[iSku], name: r[iName], price: r[iPrice] })));

// Price range
const prices = dataRows.map(r => parseFloat(r[iPrice] || '0')).filter(p => !isNaN(p));
console.log('Price range: min=', Math.min(...prices), 'max=', Math.max(...prices));

// Duplicate SKU check
const skus = dataRows.map(r => r[iSku]);
const dupSkus = skus.filter((s, i) => skus.indexOf(s) !== i);
console.log('\nDuplicate SKUs:', dupSkus.length === 0 ? 'NONE' : dupSkus);

// Duplicate barcode check
const barcodes = dataRows.map(r => r[iBarcode]).filter(b => b !== '');
const dupBarcodes = barcodes.filter((b, i) => barcodes.indexOf(b) !== i);
console.log('Duplicate barcodes:', dupBarcodes.length === 0 ? 'NONE' : dupBarcodes);

// RFT products
const rftRows = dataRows.filter(r => (r[iPer] || '').trim().toUpperCase() === 'RFT');
console.log('\nRFT products:', rftRows.map(r => ({ sku: r[iSku], name: r[iName], price: r[iPrice] })));

// Sample price conversion
console.log('\nSample paise conversions:');
[rows[1], rows[2], rows[3]].forEach(r => {
  if (!r) return;
  const priceStr = r[iPrice];
  const priceNum = parseFloat(priceStr);
  const paise = Math.round(priceNum * 100);
  console.log(`  ${r[iSku]} | ${r[iName]} | ₹${priceStr} => ${paise} paise`);
});
