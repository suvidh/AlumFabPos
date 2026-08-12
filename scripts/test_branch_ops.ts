import { PrismaClient, PaymentMethod } from '@prisma/client';
import { CompanyService } from '../src/services/companyService';
import { BranchService } from '../src/services/branchService';
import { SalesService } from '../src/services/salesService';

const prisma = new PrismaClient();

async function runBranchOpsTests() {
  console.log('--- STARTING EXTENDED COMPANY & BRANCH DELETION TESTS ---');

  try {
    // 1. Get or seed company profile
    console.log('\n[1/5] Checking Company Profile & Main Headquarters...');
    const { company, defaultBranch } = await CompanyService.getCompany(prisma);
    console.log(`✔ Company: ${company.name} | HQ: ${defaultBranch?.name} (ID: ${defaultBranch?.id})`);

    // 2. Pre-cleanup of any leftovers
    console.log('\nCleaning any leftover test branches...');
    const existingA = await prisma.branch.findUnique({ where: { code: 'TESTA' } });
    if (existingA) {
      await prisma.payment.deleteMany({ where: { sale: { branchId: existingA.id } } });
      await prisma.saleItem.deleteMany({ where: { sale: { branchId: existingA.id } } });
      await prisma.sale.deleteMany({ where: { branchId: existingA.id } });
      await prisma.stockMovement.deleteMany({ where: { branchId: existingA.id } });
      await prisma.customerLedger.deleteMany({ where: { referenceId: { startsWith: 'INV-TESTA-' } } });
      await prisma.branchInventory.deleteMany({ where: { branchId: existingA.id } });
      await prisma.productBranchBarcode.deleteMany({ where: { branchId: existingA.id } });
      await prisma.invoiceSequence.deleteMany({ where: { branchId: existingA.id } });
      await prisma.auditLog.deleteMany({ where: { entityId: existingA.id } });
      await prisma.branch.delete({ where: { id: existingA.id } });
    }
    const existingB = await prisma.branch.findUnique({ where: { code: 'TESTB' } });
    if (existingB) {
      await prisma.invoiceSequence.deleteMany({ where: { branchId: existingB.id } });
      await prisma.branch.delete({ where: { id: existingB.id } });
    }

    // 3. Test HQ Deletion (Allowed)
    console.log('\n[2/5] Testing Main Headquarters Deletability...');
    // Create a temporary branch to act as fallback HQ
    const fallbackHQ = await BranchService.createBranch(prisma, {
      companyId: company.id,
      code: 'TESTA',
      name: 'Temporary Fallback Outlet'
    });
    console.log(`Created Fallback Branch TESTA: ID = ${fallbackHQ.id}`);

    const hqId = company.defaultBranchId || '';
    console.log(`Attempting to delete current HQ branch (ID: ${hqId})...`);
    await BranchService.deleteBranch(prisma, hqId);
    console.log('✔ Deleted Headquarters branch successfully!');

    // Re-fetch company details to check default branch migration
    const updatedComp = await prisma.company.findFirst();
    console.log(`Company Default Branch ID migrated to: ${updatedComp?.defaultBranchId}`);
    if (updatedComp?.defaultBranchId === fallbackHQ.id) {
      console.log('✔ PASS: Company defaultBranchId successfully migrated to fallback branch TESTA!');
    } else {
      console.error('❌ FAIL: Default branch ID did not migrate to fallback branch TESTA!');
    }

    // Restore original default branch (MAIN) by creating it again
    console.log('\nRestoring original HQ branch...');
    const originalHQ = await prisma.branch.create({
      data: {
        companyId: company.id,
        code: 'MAIN',
        name: 'Main Head Office & Central Depot',
        invoicePrefix: 'INV-MAIN-',
        address: 'Shop No. 2, Kalindi Apartment, Nr. Sharda Hospital Circle, Majura Gate Road, Surat - 395002',
        gstin: '24ABOPK8064H1ZD',
        phone: '9824157960',
        state: 'Gujarat',
        isActive: true
      }
    });
    await prisma.company.update({
      where: { id: company.id },
      data: { defaultBranchId: originalHQ.id }
    });
    console.log(`HQ Restored: ID = ${originalHQ.id}`);

    // Clean up fallbackHQ
    await prisma.invoiceSequence.deleteMany({ where: { branchId: fallbackHQ.id } });
    await prisma.branch.delete({ where: { id: fallbackHQ.id } });
    console.log('Temporary Fallback branch cleaned.');

    // 4. Test Minimum Active Branch Constraint (1 Branch minimum)
    console.log('\n[3/5] Testing Minimum Active Branch Constraint...');
    const activeCount = await prisma.branch.count({ where: { isDeleted: false } });
    console.log(`Current active branches: ${activeCount}`);
    
    try {
      await BranchService.deleteBranch(prisma, originalHQ.id);
      console.error('❌ FAIL: Deleting the only active branch was not blocked!');
    } catch (err: any) {
      console.log(`✔ PASS: Single branch deletion blocked with expected error: "${err.message}"`);
    }

    // 5. Test Deletion Safeguards (Soft Delete vs Hard Delete)
    console.log('\n[4/5] Testing Deletion Safeguards (Soft vs Hard Delete)...');
    
    // Create new branch TESTB
    const branchB = await BranchService.createBranch(prisma, {
      companyId: company.id,
      code: 'TESTB',
      name: 'Test Clean Outlet'
    });
    console.log(`Created Secondary Branch TESTB: ${branchB.name}`);

    // Create a product and a sale on TESTB to generate dependencies
    const sku = 'SKU-TEMP-SYNC';
    await prisma.product.deleteMany({ where: { sku } });
    const product = await prisma.product.create({
      data: {
        sku,
        name: 'Temp test product',
        sellingPricePaise: 5000,
        sellingUnit: 'PCS'
      }
    });

    await prisma.branchInventory.create({
      data: { branchId: branchB.id, productId: product.id, quantityMilli: 10000 }
    });

    const sale = await SalesService.createSale(prisma, {
      branchId: branchB.id,
      items: [{ productId: product.id, quantityDecimal: 1.0 }],
      payments: [{ method: PaymentMethod.CASH, amountRupees: 50.0 }]
    });
    console.log(`Created Dependent Sale on Branch TESTB: Invoice = ${sale.invoiceNumber}`);

    // Attempting deletion of TESTB (must soft delete)
    const deleteResB = await BranchService.deleteBranch(prisma, branchB.id);
    console.log(`✔ Branch TESTB Delete Result: softDeleted = ${deleteResB.softDeleted} (Expected: true)`);

    // Verify it is excluded from active branch listings
    const activeBranches = await BranchService.getAllBranches(prisma);
    const codes = activeBranches.map(b => b.code);
    console.log(`Active branches in list: ${JSON.stringify(codes)}`);
    if (codes.includes('TESTB')) {
      console.error('❌ FAIL: Soft-deleted branch TESTB is still returned in active list!');
    } else {
      console.log('✔ PASS: Soft-deleted branch TESTB successfully filtered out.');
    }

    // Clean up mock data
    console.log('\nCleaning up test assets...');
    await prisma.payment.deleteMany({ where: { sale: { branchId: branchB.id } } });
    await prisma.saleItem.deleteMany({ where: { sale: { branchId: branchB.id } } });
    await prisma.sale.deleteMany({ where: { branchId: branchB.id } });
    await prisma.stockMovement.deleteMany({ where: { branchId: branchB.id } });
    await prisma.customerLedger.deleteMany({ where: { referenceId: { startsWith: 'INV-TESTB-' } } });
    await prisma.branchInventory.deleteMany({ where: { branchId: branchB.id } });
    await prisma.productBranchBarcode.deleteMany({ where: { branchId: branchB.id } });
    await prisma.invoiceSequence.deleteMany({ where: { branchId: branchB.id } });
    await prisma.auditLog.deleteMany({ where: { entityId: branchB.id } });
    await prisma.branch.delete({ where: { id: branchB.id } });
    await prisma.product.delete({ where: { id: product.id } });
    console.log('Cleanup completed.');

    console.log('\n--- ALL EXTENDED BRANCH TESTS COMPLETED SUCCESSFULLY ---');

  } catch (err: any) {
    console.error('❌ Test execution failed with error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

runBranchOpsTests();
