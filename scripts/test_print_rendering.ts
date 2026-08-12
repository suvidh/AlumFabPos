import * as fs from 'fs';
import * as path from 'path';
import { PrintService, PrintSaleData } from '../src/services/printService';

const mockSale: PrintSaleData = {
  invoiceNumber: 'ALF-INV-2026-9081',
  invoiceSequence: 9081,
  createdAt: new Date(),
  branchNameSnapshot: 'AlumFab Surat Retail Hub',
  branchAddressSnapshot: 'Plot 42, GIDC Industrial Estate, Surat, Gujarat - 395003',
  branchGstinSnapshot: '24AAAAA1111A1Z1',
  branchPhoneSnapshot: '+91 98765 43210',
  branchStateSnapshot: 'Gujarat (24)',
  customerNameSnapshot: 'Vertex Infrastructure Ltd',
  customerAddressSnapshot: 'A-601, Commercial Center, Ring Road, Surat, Gujarat - 395002',
  customerGstinSnapshot: '24BBBBB2222B2Z2',
  customerStateSnapshot: 'Gujarat (24)',
  subtotalPaise: 275000, // ₹2,750.00
  discountPaise: 25000,   // ₹250.00 (discount)
  grandTotalPaise: 295000, // ₹2,750 - ₹250 + ₹450 (GST 18% on ₹2500) = ₹2,950.00
  items: [
    {
      skuSnapshot: 'AL-SEC-SLD-12',
      productNameSnapshot: 'Aluminum Sliding Window Section 12ft',
      quantityMilli: 5000, // 5 pieces
      ratePaise: 40000,    // ₹400.00 each
      grossPaise: 200000,
      discountPaise: 15000, // ₹150.00 discount
      lineTotalPaise: 185000,
      unitSnapshot: 'PCS'
    },
    {
      skuSnapshot: 'HDW-RLR-DBL',
      productNameSnapshot: 'Heavy Duty Double Roller Bearings',
      quantityMilli: 15000, // 15 pieces
      ratePaise: 5000,     // ₹50.00 each
      grossPaise: 75000,
      discountPaise: 10000, // ₹100.00 discount
      lineTotalPaise: 65000,
      unitSnapshot: 'PCS'
    }
  ],
  payments: [
    {
      method: 'CASH',
      amountPaise: 95000 // ₹950.00 cash paid
    },
    {
      method: 'CARD',
      amountPaise: 200000 // ₹2,000.00 card paid
    }
  ]
};

async function testRendering() {
  console.log('--- STARTING INVOICE PRINT TEMPLATE RENDERING TEST ---');
  
  const artifactDir = path.join('C:', 'Users', 'Suvidh', '.gemini', 'antigravity', 'brain', 'ca19a859-c614-4a23-9c5d-b7567333c65d', 'scratch');
  
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }

  // 1. Generate A4 HTML Invoice
  const a4Html = PrintService.generateA4InvoiceHTML(mockSale);
  const a4Path = path.join(artifactDir, 'mock_a4_invoice.html');
  fs.writeFileSync(a4Path, a4Html, 'utf8');
  console.log(`✔ A4 Commercial Invoice successfully rendered to: ${a4Path}`);

  // 2. Generate 80mm Thermal Receipt
  const thermal80Html = PrintService.generateThermalHTML(mockSale, '80mm');
  const thermal80Path = path.join(artifactDir, 'mock_thermal_80mm.html');
  fs.writeFileSync(thermal80Path, thermal80Html, 'utf8');
  console.log(`✔ 80mm Thermal Receipt successfully rendered to: ${thermal80Path}`);

  // 3. Generate 58mm Thermal Receipt
  const thermal58Html = PrintService.generateThermalHTML(mockSale, '58mm');
  const thermal58Path = path.join(artifactDir, 'mock_thermal_58mm.html');
  fs.writeFileSync(thermal58Path, thermal58Html, 'utf8');
  console.log(`✔ 58mm Thermal Receipt successfully rendered to: ${thermal58Path}`);

  console.log('\n--- TEMPLATE RENDERING TEST COMPLETED SUCCESSFULLY ---');
}

testRendering();
