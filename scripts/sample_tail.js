const AdmZip = require('adm-zip');
const path = require('path');
const zip = new AdmZip(path.join(__dirname, '..', 'hardware.ods'));
const content = zip.readAsText('content.xml');

const rowRegex = /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g;
let m;
const rows = [];
let count = 0;

while ((m = rowRegex.exec(content)) !== null && count < 185) {
  const rowXml = m[1];
  const cellRegex = /<table:table-cell\b([^>]*)>([\s\S]*?)<\/table:table-cell>|<table:table-cell\b([^>]*)\/>/g;
  let c;
  const cells = [];
  while ((c = cellRegex.exec(rowXml)) !== null) {
    const attrs = c[1] || c[3] || '';
    const inner = c[2] || '';
    const repMatch = /table:number-columns-repeated="(\d+)"/.exec(attrs);
    const rep = repMatch ? parseInt(repMatch[1], 10) : 1;
    const tv = /<text:p[^>]*>([\s\S]*?)<\/text:p>/.exec(inner);
    const val = tv ? tv[1].replace(/<[^>]+>/g, '').trim() : '';
    for (let i = 0; i < Math.min(rep, 5); i++) cells.push(val);
  }
  while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  if (cells.length > 0) { rows.push(cells); count++; }
}

console.log('Rows 155-181:');
rows.slice(155).forEach((r, i) => console.log('[' + (155 + i) + ']', JSON.stringify(r)));
