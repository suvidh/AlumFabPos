import Dexie from 'dexie';

export const db = new Dexie('AlumFabOfflinePOS');

db.version(3).stores({
  products: '++id, code, name, category, finish, alloy, stockQty',
  customers: '++id, code, name, phone, customerType',
  invoices: '++id, invoiceNo, date, customerId, status, syncStatus',
  customerTransactions: '++id, customerId, date, type',
  settings: 'key'
});

export const INITIAL_PRODUCTS = [
  {
    code: 'AL-1801',
    name: '18mm Window Sliding Top Track',
    category: 'Aluminum Profiles',
    finish: 'Silver Anodized',
    alloy: '6063-T6',
    defaultUnit: 'kg',
    weightPerFt: 0.185,
    ratePerKg: 310,
    ratePerUnit: 57.35,
    stockQty: 450,
    taxRate: 18
  },
  {
    code: 'AL-1802',
    name: '18mm Window Sliding Bottom Track',
    category: 'Aluminum Profiles',
    finish: 'Silver Anodized',
    alloy: '6063-T6',
    defaultUnit: 'kg',
    weightPerFt: 0.220,
    ratePerKg: 310,
    ratePerUnit: 68.20,
    stockQty: 380,
    taxRate: 18
  },
  {
    code: 'AL-1803',
    name: '18mm Window Handle Section',
    category: 'Aluminum Profiles',
    finish: 'Powder Coated Black',
    alloy: '6063-T5',
    defaultUnit: 'kg',
    weightPerFt: 0.165,
    ratePerKg: 340,
    ratePerUnit: 56.10,
    stockQty: 290,
    taxRate: 18
  },
  {
    code: 'AL-2701',
    name: '27mm Heavy Duty Outer Frame',
    category: 'Aluminum Profiles',
    finish: 'Bronze Anodized',
    alloy: '6063-T6',
    defaultUnit: 'kg',
    weightPerFt: 0.420,
    ratePerKg: 325,
    ratePerUnit: 136.50,
    stockQty: 210,
    taxRate: 18
  },
  {
    code: 'AL-4001',
    name: '40mm Door Casement Section',
    category: 'Aluminum Profiles',
    finish: 'Wood Grain Finish',
    alloy: '6061-T6',
    defaultUnit: 'kg',
    weightPerFt: 0.580,
    ratePerKg: 420,
    ratePerUnit: 243.60,
    stockQty: 140,
    taxRate: 18
  },
  {
    code: 'AL-PAR1',
    name: '2" x 1" Partition Tube Profile',
    category: 'Aluminum Profiles',
    finish: 'Mill Finish',
    alloy: '6063-T6',
    defaultUnit: 'kg',
    weightPerFt: 0.310,
    ratePerKg: 285,
    ratePerUnit: 88.35,
    stockQty: 600,
    taxRate: 18
  },
  {
    code: 'HW-ROL18',
    name: 'Heavy Duty Nylon Wheel Roller (18mm)',
    category: 'Hardware & Fittings',
    finish: 'Standard',
    alloy: 'N/A',
    defaultUnit: 'pcs',
    weightPerFt: 0,
    ratePerKg: 0,
    ratePerUnit: 45,
    stockQty: 1200,
    taxRate: 12
  },
  {
    code: 'HW-LCK-TCH',
    name: 'Single Point Touch Lock (Black/Silver)',
    category: 'Hardware & Fittings',
    finish: 'Black',
    alloy: 'Zinc/Alloy',
    defaultUnit: 'pcs',
    weightPerFt: 0,
    ratePerKg: 0,
    ratePerUnit: 185,
    stockQty: 350,
    taxRate: 12
  },
  {
    code: 'HW-FRC-12',
    name: 'Stainless Steel Friction Stay 12 Inch',
    category: 'Hardware & Fittings',
    finish: 'SS 304',
    alloy: 'SS-304',
    defaultUnit: 'pcs',
    weightPerFt: 0,
    ratePerKg: 0,
    ratePerUnit: 260,
    stockQty: 180,
    taxRate: 18
  },
  {
    code: 'ACC-GSK-EPDM',
    name: 'EPDM Rubber Gasket Seal (Roll 100m)',
    category: 'Glass & Accessories',
    finish: 'Black Rubber',
    alloy: 'N/A',
    defaultUnit: 'pcs',
    weightPerFt: 0,
    ratePerKg: 0,
    ratePerUnit: 950,
    stockQty: 45,
    taxRate: 5
  },
  {
    code: 'ACC-SIL-CLR',
    name: 'Neutral Weatherproof Silicone Sealant (Clear)',
    category: 'Glass & Accessories',
    finish: 'Clear Tube',
    alloy: 'N/A',
    defaultUnit: 'pcs',
    weightPerFt: 0,
    ratePerKg: 0,
    ratePerUnit: 220,
    stockQty: 500,
    taxRate: 18
  }
];

export const INITIAL_CUSTOMERS = [
  {
    code: 'CUST-001',
    name: 'Walk-in Retail Customer',
    phone: 'N/A',
    customerType: 'Retail',
    creditLimit: 0,
    outstandingBalance: 0
  },
  {
    code: 'CUST-FAB01',
    name: 'Apex Aluminum Fabricators (Rajesh)',
    phone: '+91 98765 43210',
    customerType: 'Fabricator',
    creditLimit: 150000,
    outstandingBalance: 34500
  },
  {
    code: 'CUST-FAB02',
    name: 'Modern Glass & Glazing Solutions',
    phone: '+91 98123 76543',
    customerType: 'Fabricator',
    creditLimit: 250000,
    outstandingBalance: 82100
  },
  {
    code: 'CUST-ARC01',
    name: 'Skyline Architects & Builders',
    phone: '+91 99001 12233',
    customerType: 'Architect',
    creditLimit: 500000,
    outstandingBalance: 12400
  }
];

export const INITIAL_SETTINGS = [
  { key: 'storeName', value: 'AlumFab Hardware & Profiles' },
  { key: 'storePhone', value: '+91 98765 12345' },
  { key: 'storeAddress', value: 'Plot 42, Industrial Area Phase 1, City' },
  { key: 'gstin', value: '27AAAAA0000A1Z5' },
  { key: 'receiptFooter', value: 'Thank you for doing business with AlumFab!' }
];

export async function seedDatabaseIfEmpty() {
  const productCount = await db.products.count();
  if (productCount === 0) {
    await db.products.bulkAdd(INITIAL_PRODUCTS);
  } else {
    const existing = await db.products.toArray();
    for (const p of existing) {
      if (!p.alloy) {
        const defaultAlloy = p.category === 'Aluminum Profiles' ? '6063-T6' : 'N/A';
        await db.products.update(p.id, { alloy: defaultAlloy });
      }
    }
  }

  const customerCount = await db.customers.count();
  if (customerCount === 0) {
    await db.customers.bulkAdd(INITIAL_CUSTOMERS);
  }

  const settingsCount = await db.settings.count();
  if (settingsCount === 0) {
    await db.settings.bulkAdd(INITIAL_SETTINGS);
  }
}
