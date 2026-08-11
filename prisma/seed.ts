import { PrismaClient, SellingUnit } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_PRODUCTS = [
  {
    sku: 'AL-1801',
    name: '18mm Window Sliding Top Track',
    profile: '18mm Sliding Track',
    finish: 'Silver Anodized',
    alloy: '6063-T6',
    sellingUnit: SellingUnit.KG,
    sellingPricePaise: 31000, // ₹310.00 / kg
    gstRate: 18.0,
    weightPerPiece: 0.185,
    stockQty: 450
  },
  {
    sku: 'AL-1802',
    name: '18mm Window Sliding Bottom Track',
    profile: '18mm Sliding Track',
    finish: 'Silver Anodized',
    alloy: '6063-T6',
    sellingUnit: SellingUnit.KG,
    sellingPricePaise: 31000, // ₹310.00 / kg
    gstRate: 18.0,
    weightPerPiece: 0.220,
    stockQty: 380
  },
  {
    sku: 'AL-1803',
    name: '18mm Window Handle Section',
    profile: '18mm Handle Section',
    finish: 'Powder Coated Black',
    alloy: '6063-T5',
    sellingUnit: SellingUnit.KG,
    sellingPricePaise: 34000, // ₹340.00 / kg
    gstRate: 18.0,
    weightPerPiece: 0.165,
    stockQty: 290
  },
  {
    sku: 'AL-1804',
    name: '18mm Window Interlock Section',
    profile: '18mm Interlock',
    finish: 'Bronze Anodized',
    alloy: '6063-T6',
    sellingUnit: SellingUnit.KG,
    sellingPricePaise: 32500, // ₹325.00 / kg
    gstRate: 18.0,
    weightPerPiece: 0.190,
    stockQty: 180
  },
  {
    sku: 'HD-8012',
    name: 'Heavy Duty Bearing Roller 18mm',
    finish: 'Stainless Steel / Nylon',
    sellingUnit: SellingUnit.PCS,
    sellingPricePaise: 14500, // ₹145.00 / pc
    gstRate: 18.0,
    stockQty: 600
  },
  {
    sku: 'HD-9044',
    name: 'Concealed Touch Lock (Black)',
    finish: 'Zinc Alloy Matte Black',
    sellingUnit: SellingUnit.PCS,
    sellingPricePaise: 28000, // ₹280.00 / pc
    gstRate: 18.0,
    stockQty: 350
  },
  {
    sku: 'HD-3001',
    name: 'EPDM Rubber Gasket (Window Seal)',
    finish: 'Black EPDM',
    sellingUnit: SellingUnit.METER,
    sellingPricePaise: 1850, // ₹18.50 / meter
    gstRate: 18.0,
    stockQty: 1200
  }
];

async function main() {
  console.log('Seeding ALUMFAB POS Database...');

  // 1. Create Company Master
  const company = await prisma.company.upsert({
    where: { id: 'company-main-001' },
    update: { companyName: 'ALUMFAB' },
    create: {
      id: 'company-main-001',
      companyName: 'ALUMFAB'
    }
  });

  // 2. Create Default Branch (Surat Main Store)
  const branch = await prisma.branch.upsert({
    where: { id: 'branch-surat-001' },
    update: {
      name: 'Surat Main Store',
      address: 'Plot 42, Industrial Area, Surat, Gujarat',
      gstin: '24AAACA0000A1Z5',
      phone: '+91 98765 43210',
      state: 'Gujarat',
      invoicePrefix: 'SRT-INV-'
    },
    create: {
      id: 'branch-surat-001',
      companyId: company.id,
      name: 'Surat Main Store',
      address: 'Plot 42, Industrial Area, Surat, Gujarat',
      gstin: '24AAACA0000A1Z5',
      phone: '+91 98765 43210',
      state: 'Gujarat',
      invoicePrefix: 'SRT-INV-'
    }
  });

  // 3. Create Invoice Sequence Counter for Surat Branch
  await prisma.invoiceSequence.upsert({
    where: {
      branchId_prefix: {
        branchId: branch.id,
        prefix: 'SRT-INV-'
      }
    },
    update: {},
    create: {
      branchId: branch.id,
      prefix: 'SRT-INV-',
      nextNumber: 1
    }
  });

  // 4. Seed Products & Branch Inventory
  for (const item of SEED_PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { sku: item.sku },
      update: {
        name: item.name,
        profile: item.profile,
        finish: item.finish,
        alloy: item.alloy,
        sellingUnit: item.sellingUnit,
        sellingPricePaise: item.sellingPricePaise,
        gstRate: item.gstRate,
        weightPerPiece: item.weightPerPiece
      },
      create: {
        sku: item.sku,
        name: item.name,
        profile: item.profile,
        finish: item.finish,
        alloy: item.alloy,
        sellingUnit: item.sellingUnit,
        sellingPricePaise: item.sellingPricePaise,
        gstRate: item.gstRate,
        weightPerPiece: item.weightPerPiece
      }
    });

    await prisma.branchInventory.upsert({
      where: {
        branchId_productId: {
          branchId: branch.id,
          productId: product.id
        }
      },
      update: {
        quantity: item.stockQty
      },
      create: {
        branchId: branch.id,
        productId: product.id,
        quantity: item.stockQty
      }
    });
  }

  // 5. Seed Default Cash Customer
  await prisma.customer.upsert({
    where: { id: 'cust-counter-001' },
    update: {},
    create: {
      id: 'cust-counter-001',
      name: 'Counter Retail Cash Sale',
      phone: '0000000000',
      address: 'Surat Counter',
      state: 'Gujarat'
    }
  });

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
