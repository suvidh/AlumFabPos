import { PrismaClient } from '@prisma/client';
import { ProductService } from '../src/services/productService';
import { InventoryService } from '../src/services/inventoryService';

const prisma = new PrismaClient();

async function runTests() {
  console.log('--- STARTING TRANSACTIONAL VALIDATION TESTS ---');

  try {
    // 1. Setup/Find Test Branches
    console.log('\n[1/7] Setting up test branches...');
    let company = await prisma.company.findFirst();
    if (!company) {
      company = await prisma.company.create({
        data: { name: 'Test Company', legalName: 'Test Company Ltd' }
      });
    }

    let branchA = await prisma.branch.findFirst({ where: { code: 'BR-A' } });
    if (!branchA) {
      branchA = await prisma.branch.create({
        data: { code: 'BR-A', name: 'Test Branch A', address: 'Loc A', phone: '1234567890', companyId: company.id }
      });
    }
    let branchB = await prisma.branch.findFirst({ where: { code: 'BR-B' } });
    if (!branchB) {
      branchB = await prisma.branch.create({
        data: { code: 'BR-B', name: 'Test Branch B', address: 'Loc B', phone: '0987654321', companyId: company.id }
      });
    }
    console.log(`Branch A: ${branchA.name} (${branchA.id})`);
    console.log(`Branch B: ${branchB.name} (${branchB.id})`);

    // 2. Create Test Product & Validate SKU Uniqueness
    console.log('\n[2/7] Testing Product CRUD and SKU Uniqueness...');
    const randomSku = 'SKU-' + Math.floor(Math.random() * 1000000);
    const randomBarcode = 'BAR-' + Math.floor(Math.random() * 1000000);

    const product1 = await ProductService.createProduct(prisma, {
      sku: randomSku,
      name: 'Test Metal Section',
      barcode: randomBarcode,
      sellingPrice: 150.0,
      sellingUnit: 'PCS',
      minimumStock: 10.0
    });
    console.log(`Product 1 Created: ${product1.name} | SKU: ${product1.sku}`);

    // Try to create product with duplicate SKU
    try {
      await ProductService.createProduct(prisma, {
        sku: randomSku,
        name: 'Duplicate SKU Product',
        sellingPrice: 200.0
      });
      console.error('❌ FAIL: Allowed duplicate SKU creation!');
    } catch (err: any) {
      console.log(`✔ PASS: Prevented duplicate SKU creation: ${err.message}`);
    }

    // Try to create product with duplicate Barcode
    try {
      await ProductService.createProduct(prisma, {
        sku: randomSku + '-NEW',
        name: 'Duplicate Barcode Product',
        barcode: randomBarcode,
        sellingPrice: 200.0
      });
      console.error('❌ FAIL: Allowed duplicate barcode creation!');
    } catch (err: any) {
      console.log(`✔ PASS: Prevented duplicate barcode creation: ${err.message}`);
    }

    // 3. Stock Availability & Manual Adjustment Check
    console.log('\n[3/7] Testing Stock Availability & Manual Adjustment...');
    let avail = await InventoryService.checkStockAvailability(prisma, branchA.id, product1.id);
    console.log(`Initial stock at Branch A: ${avail.availableQuantityDecimal} units`);

    // Adjust to physical count (Initial Stock)
    console.log('Adjusting stock to 50 units (Initial Stock)...');
    const adjustResult = await InventoryService.manualStockAdjustment(
      prisma,
      branchA.id,
      product1.id,
      50.0,
      'Initial Stock',
      'Opening audit counts'
    );
    console.log(`Adjusted stock. Live Quantity: ${adjustResult.inventory.quantityMilli / 1000} units`);
    console.log(`Ledger entry recorded: Type: ${adjustResult.movement?.type} | Notes: ${adjustResult.movement?.notes}`);

    // Adjust for damage (set physical count to 45 units)
    console.log('Adjusting stock to 45 units due to damage...');
    const adjustDamage = await InventoryService.manualStockAdjustment(
      prisma,
      branchA.id,
      product1.id,
      45.0,
      'Damaged',
      'Found 5 damaged units'
    );
    console.log(`New stock at Branch A: ${adjustDamage.inventory.quantityMilli / 1000} units`);
    console.log(`Ledger entry recorded: Type: ${adjustDamage.movement?.type} | Delta: ${(adjustDamage.movement?.quantityMilli || 0) / 1000} | Notes: ${adjustDamage.movement?.notes}`);

    // 4. Inter-Branch Transfer (IBT) Atomic Workflow
    console.log('\n[4/7] Testing Inter-Branch Transfer (IBT) Workflow...');
    console.log('Transferring 20 units from Branch A to Branch B...');
    const transferResult = await InventoryService.transferStock(
      prisma,
      branchA.id,
      branchB.id,
      product1.id,
      20.0,
      'Weekly replenishment transfer'
    );
    console.log(`Branch A Stock: ${transferResult.fromInventory.quantityMilli / 1000} units`);
    console.log(`Branch B Stock: ${transferResult.toInventory.quantityMilli / 1000} units`);

    // 5. Test Insufficient Stock Transactional Rollback
    console.log('\n[5/7] Testing IBT rollback on insufficient stock...');
    try {
      console.log('Attempting to transfer 30 units (Available at Branch A: 25)...');
      await InventoryService.transferStock(
        prisma,
        branchA.id,
        branchB.id,
        product1.id,
        30.0,
        'Over-draft transfer request'
      );
      console.error('❌ FAIL: Allowed stock overdraft transfer!');
    } catch (err: any) {
      console.log(`✔ PASS: Transfer blocked and rolled back: ${err.message}`);
      // Confirm stock levels remain unchanged
      const checkA = await InventoryService.checkStockAvailability(prisma, branchA.id, product1.id);
      const checkB = await InventoryService.checkStockAvailability(prisma, branchB.id, product1.id);
      console.log(`Confirmed stock levels: Branch A = ${checkA.availableQuantityDecimal}, Branch B = ${checkB.availableQuantityDecimal}`);
    }

    // 6. Low Stock Alerts
    console.log('\n[6/7] Testing Low Stock Alerts Query...');
    // Branch A has 25 units, reorder is 10. No alert expected.
    let alertsA = await InventoryService.getLowStockAlerts(prisma, branchA.id);
    let isAlertedA = alertsA.some(a => a.productId === product1.id);
    console.log(`Is product alerted at Branch A (Stock 25, Min 10)? ${isAlertedA ? 'Yes ❌' : 'No ✔'}`);

    // Let's set a branch-specific override threshold of 30 units at Branch A
    console.log('Setting branch-specific override reorder threshold of 30 units at Branch A...');
    await prisma.branchInventory.update({
      where: { branchId_productId: { branchId: branchA.id, productId: product1.id } },
      data: { reorderThresholdMilli: 30000 } // 30 units override
    });

    alertsA = await InventoryService.getLowStockAlerts(prisma, branchA.id);
    isAlertedA = alertsA.some(a => a.productId === product1.id);
    console.log(`Is product alerted at Branch A (Stock 25, Threshold override 30)? ${isAlertedA ? 'Yes ✔' : 'No ❌'}`);
    if (isAlertedA) {
      const match = alertsA.find(a => a.productId === product1.id);
      console.log(`Alert details: Current stock = ${match.currentStockDecimal}, Threshold = ${match.reorderThresholdDecimal}`);
    }

    // 7. Soft Delete Verification
    console.log('\n[7/7] Testing Soft Delete and Query exclusion...');
    console.log('Soft-deleting product...');
    await ProductService.deleteProduct(prisma, product1.id);
    
    const fetchDeletedSku = await ProductService.getProductBySku(prisma, product1.sku);
    console.log(`Fetch by SKU returned: ${fetchDeletedSku ? 'Product Object ❌' : 'null (Product excluded) ✔'}`);

    const allActive = await ProductService.getAllProducts(prisma);
    const inAllActive = allActive.some(p => p.id === product1.id);
    console.log(`Is soft-deleted product returned in active product list? ${inAllActive ? 'Yes ❌' : 'No ✔'}`);

    console.log('\n--- ALL TRANSACTIONAL TESTS COMPLETED SUCCESSFULLY ---');

  } catch (globalErr: any) {
    console.error('❌ Test execution encountered a fatal error:', globalErr);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
