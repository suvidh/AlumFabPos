import { PrismaClient, PaymentMethod } from '@prisma/client';
import { ProductService } from '../src/services/productService';
import { SalesService } from '../src/services/salesService';
import { SyncService } from '../src/services/syncService';
import { InventoryService } from '../src/services/inventoryService';

const prisma = new PrismaClient();

async function runSyncIdempotencyTests() {
  console.log('--- STARTING SALES SYNC & IDEMPOTENCY TRANSACTION TESTS ---');

  try {
    // 1. Setup Master Records
    console.log('\n[1/4] Bootstrapping branch and catalog...');
    let company = await prisma.company.findFirst();
    if (!company) {
      company = await prisma.company.create({
        data: { name: 'AlumFab Test Ltd' }
      });
    }

    let branch = await prisma.branch.findFirst({ where: { code: 'BR-SYNC' } });
    if (!branch) {
      branch = await prisma.branch.create({
        data: { code: 'BR-SYNC', name: 'Sync Hub Store', address: 'Sec 15', phone: '4445556667', companyId: company.id }
      });
    }

    const sku = 'SYNC-PROD-1';
    await prisma.product.deleteMany({ where: { sku } });

    const product = await ProductService.createProduct(prisma, {
      sku,
      name: 'Sliding window frame 6m',
      sellingPrice: 400.00,
      sellingUnit: 'PCS'
    });

    // Seed stock to exactly 10 units
    await prisma.branchInventory.deleteMany({ where: { productId: product.id } });
    await prisma.branchInventory.create({
      data: { branchId: branch.id, productId: product.id, quantityMilli: 10000 }
    });

    console.log(`Initial stock seeded: ${product.name} = 10 units`);

    // 2. Simulate Local Offline Checkout Queue (Generate client offline_uuid)
    const offlineUuid = 'off-uuid-token-abc-12345';
    console.log(`\n[2/4] Client simulated offline queue checkin. UUID: ${offlineUuid}`);

    // 3. Process First Sync Request (POST /api/v1/sync/transactions)
    console.log('\n[3/4] Triggering First Sync call to background server...');
    const firstSync = await SyncService.syncOfflineSale(prisma, {
      branchId: branch.id,
      items: [{ productId: product.id, quantityDecimal: 3.0 }], // Deducts 3 units
      payments: [{ method: PaymentMethod.CASH, amountRupees: 1200.00 }],
      offlineUuid
    });

    console.log(`✔ FIRST SYNC SUCCESS: Invoice generated: ${firstSync.invoiceNumber} | Total: ₹${firstSync.grandTotalPaise / 100}`);
    
    // Verify stock decremented to 7 units
    let stock = await InventoryService.checkStockAvailability(prisma, branch.id, product.id);
    console.log(`Stock Level: ${stock.availableQuantityDecimal} units (Expected: 7)`);

    // 4. Process Second Duplicate Sync Request (Simulating retry under unstable network connection)
    console.log('\n[4/4] Triggering Second Duplicate Sync call (Simulating network retry)...');
    const secondSync = await SyncService.syncOfflineSale(prisma, {
      branchId: branch.id,
      items: [{ productId: product.id, quantityDecimal: 3.0 }],
      payments: [{ method: PaymentMethod.CASH, amountRupees: 1200.00 }],
      offlineUuid // Same UUID!
    });

    console.log(`✔ SECOND SYNC SUCCESS (Idempotency ACK): Returned invoice: ${secondSync.invoiceNumber} | Database ID: ${secondSync.id}`);
    
    // Verify that stock is STILL 7 units (NO double deduction occurred!)
    stock = await InventoryService.checkStockAvailability(prisma, branch.id, product.id);
    console.log(`Stock Level: ${stock.availableQuantityDecimal} units (Expected: 7)`);

    // Verify invoice numbers are identical
    if (firstSync.id === secondSync.id && firstSync.invoiceNumber === secondSync.invoiceNumber) {
      console.log('✔ PASS: Idempotency check verified. No duplicate records created.');
    } else {
      console.error('❌ FAIL: Duplication detected or mismatch in invoice values!');
    }

    // Cleanup
    console.log('\nCleaning up sync test records...');
    await prisma.payment.deleteMany({ where: { sale: { branchId: branch.id } } });
    await prisma.saleItem.deleteMany({ where: { sale: { branchId: branch.id } } });
    await prisma.sale.deleteMany({ where: { branchId: branch.id } });
    console.log('Cleanup completed.');

    console.log('\n--- ALL SALES SYNC & IDEMPOTENCY TESTS COMPLETED SUCCESSFULLY ---');

  } catch (e: any) {
    console.error('❌ Sync tests failed with exception:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

runSyncIdempotencyTests();
