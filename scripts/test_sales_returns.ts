import { PrismaClient, PaymentMethod, SaleStatus } from '@prisma/client';
import { ProductService } from '../src/services/productService';
import { CustomerService } from '../src/services/customerService';
import { SalesService } from '../src/services/salesService';
import { InventoryService } from '../src/services/inventoryService';

const prisma = new PrismaClient();

async function runReturnsAndVoidsTests() {
  console.log('--- STARTING SALES RETURNS & INVOICE VOIDS VERIFICATION TESTS ---');

  try {
    // 1. Setup Master Records
    console.log('\n[1/6] Bootstrapping master data...');
    let company = await prisma.company.findFirst();
    if (!company) {
      company = await prisma.company.create({
        data: { name: 'AlumFab Test Ltd' }
      });
    }

    let branch = await prisma.branch.findFirst({ where: { code: 'BR-RET' } });
    if (!branch) {
      branch = await prisma.branch.create({
        data: { code: 'BR-RET', name: 'Returns Dept Store', address: 'Sec 9', phone: '2223334445', companyId: company.id }
      });
    }

    // Register a test customer with credit limit
    const customer = await CustomerService.createCustomer(prisma, {
      name: 'Alpha Contractors',
      phone: '555-9000',
      email: 'alpha@contractors.com',
      defaultBranchId: branch.id,
      creditLimitRupees: 5000.00,
      outstandingBalanceRupees: 0.00
    });
    console.log(`Customer Created: ${customer.name} | Credit Limit: ₹${customer.creditLimitPaise / 100}`);

    // Create products
    const sku1 = 'PROD-RET-1';
    const sku2 = 'PROD-RET-2';

    await prisma.product.deleteMany({ where: { sku: { in: [sku1, sku2] } } });

    const prod1 = await ProductService.createProduct(prisma, {
      sku: sku1,
      name: 'Sliding Frame 12ft',
      sellingPrice: 200.00,
      sellingUnit: 'PCS'
    });

    const prod2 = await ProductService.createProduct(prisma, {
      sku: sku2,
      name: 'Heavy Double Lock',
      sellingPrice: 400.00,
      sellingUnit: 'PCS'
    });

    // Seed stock: Prod 1 = 10 units, Prod 2 = 10 units
    await prisma.branchInventory.deleteMany({ where: { productId: { in: [prod1.id, prod2.id] } } });
    
    await prisma.branchInventory.create({ data: { branchId: branch.id, productId: prod1.id, quantityMilli: 10000 } });
    await prisma.branchInventory.create({ data: { branchId: branch.id, productId: prod2.id, quantityMilli: 10000 } });

    console.log(`Initial stock levels seeded: Prod 1 = 10, Prod 2 = 10`);

    // 2. Process original sale: 5 units of Prod 1 (₹1,000) + 5 units of Prod 2 (₹2,000) = ₹3,000.00.
    // Billed 100% on CREDIT/Store Credit.
    console.log('\n[2/6] Processing original sale of ₹3,000 on CREDIT...');
    const sale = await SalesService.createSale(prisma, {
      branchId: branch.id,
      customerId: customer.id,
      items: [
        { productId: prod1.id, quantityDecimal: 5 },
        { productId: prod2.id, quantityDecimal: 5 }
      ],
      payments: [
        { method: PaymentMethod.CREDIT, amountRupees: 3000.00 }
      ]
    });
    console.log(`✔ Sale Created: ${sale.invoiceNumber} | Grand Total: ₹${sale.grandTotalPaise / 100}`);

    // Verify stock and customer outstanding balance
    let customerData = await CustomerService.getCustomerById(prisma, customer.id);
    console.log(`Customer debt outstanding balance: ₹${customerData!.outstandingBalancePaise / 100} (Expected: ₹3000.00)`);
    let stock1 = await InventoryService.checkStockAvailability(prisma, branch.id, prod1.id);
    let stock2 = await InventoryService.checkStockAvailability(prisma, branch.id, prod2.id);
    console.log(`Stock level post-sale: Prod 1 = ${stock1.availableQuantityDecimal} (Expected: 5), Prod 2 = ${stock2.availableQuantityDecimal} (Expected: 5)`);

    // 3. Process partial return: return 2 units of Prod 1 (₹400) via Store Credit/CREDIT
    console.log('\n[3/6] Processing partial return of 2 units of Product 1...');
    const returnResult = await SalesService.processReturn(prisma, {
      saleId: sale.id,
      items: [
        { productId: prod1.id, quantityDecimal: 2 }
      ],
      refundMethod: PaymentMethod.CREDIT,
      reason: 'Wrong length delivered'
    });

    console.log(`✔ Return Processed: ${returnResult.returnNumber} | Refund Issued: ₹${returnResult.refundAmountPaise / 100}`);
    
    // Verify invoice status updated to PARTIALLY_REFUNDED
    const updatedSale = await prisma.sale.findUnique({ where: { id: sale.id } });
    console.log(`Original invoice status: ${updatedSale!.status} (Expected: PARTIALLY_REFUNDED)`);

    // Verify stock restocked (Prod 1 should be 5 + 2 = 7)
    stock1 = await InventoryService.checkStockAvailability(prisma, branch.id, prod1.id);
    console.log(`Product 1 stock: ${stock1.availableQuantityDecimal} (Expected: 7)`);

    // Verify customer outstanding debt decreased by ₹400
    customerData = await CustomerService.getCustomerById(prisma, customer.id);
    console.log(`Customer outstanding balance: ₹${customerData!.outstandingBalancePaise / 100} (Expected: ₹2600.00)`);

    // Check ledger contains CREDIT_REFUND entry
    const ledger = await prisma.customerLedger.findFirst({
      where: { customerId: customer.id, transactionType: 'CREDIT_REFUND' }
    });
    console.log(`Ledger entry found: Type: ${ledger!.transactionType} | Amount: ₹${ledger!.amountPaise / 100} (Expected: -₹400)`);

    // 4. Test Over-Return Eligibility Validation
    // Prod 1 has 5 ordered, 2 returned, remaining = 3. Attempt returning 4 more of Prod 1.
    console.log('\n[4/6] Testing over-return block...');
    try {
      await SalesService.processReturn(prisma, {
        saleId: sale.id,
        items: [
          { productId: prod1.id, quantityDecimal: 4 }
        ],
        refundMethod: PaymentMethod.CREDIT
      });
      console.error('❌ FAIL: Allowed returning more items than purchased!');
    } catch (err: any) {
      console.log(`✔ PASS: Over-return blocked: ${err.message}`);
    }

    // 5. Test Sales History Query & Filters
    console.log('\n[5/6] Testing sales history filtering...');
    const history = await SalesService.getSalesHistory(prisma, {
      branchId: branch.id,
      status: SaleStatus.PARTIALLY_REFUNDED,
      receiptSearch: sale.invoiceNumber.slice(0, 8),
      page: 1,
      pageSize: 10
    });
    console.log(`✔ Sales History returns count: ${history.totalCount} (Expected: 1)`);
    console.log(`Filter invoice match: ${history.sales[0].invoiceNumber}`);

    // 6. Test Void Transaction (Create a fresh sale first, void it)
    console.log('\n[6/6] Testing Invoice Void transaction...');
    const saleToVoid = await SalesService.createSale(prisma, {
      branchId: branch.id,
      customerId: customer.id,
      items: [
        { productId: prod2.id, quantityDecimal: 2 } // 2 * 400 = ₹800.00
      ],
      payments: [
        { method: PaymentMethod.CREDIT, amountRupees: 800.00 }
      ]
    });
    console.log(`Billed fresh sale to void: ${saleToVoid.invoiceNumber} | Grand Total: ₹${saleToVoid.grandTotalPaise / 100}`);

    // Customer balance should be 2600 + 800 = 3400. Stock of Prod 2 should be 5 - 2 = 3.
    customerData = await CustomerService.getCustomerById(prisma, customer.id);
    console.log(`Customer balance pre-void: ₹${customerData!.outstandingBalancePaise / 100} (Expected: ₹3400)`);
    stock2 = await InventoryService.checkStockAvailability(prisma, branch.id, prod2.id);
    console.log(`Prod 2 stock pre-void: ${stock2.availableQuantityDecimal} units`);

    // Process void
    const voidLog = await SalesService.voidSale(prisma, {
      saleId: saleToVoid.id,
      reason: 'Customer duplicate transaction entry',
      voidedBy: 'manager-user-007'
    });
    console.log(`✔ Void Audit Recorded: Reason: "${voidLog.reason}" | Voided By: ${voidLog.voidedBy}`);

    // Invoice status should be VOID
    const voidedSale = await prisma.sale.findUnique({ where: { id: saleToVoid.id } });
    console.log(`Voided invoice status: ${voidedSale!.status} (Expected: VOID)`);

    // Customer balance should revert to 2600. Stock of Prod 2 should revert to 5.
    customerData = await CustomerService.getCustomerById(prisma, customer.id);
    console.log(`Customer balance post-void: ₹${customerData!.outstandingBalancePaise / 100} (Expected: ₹2600)`);
    stock2 = await InventoryService.checkStockAvailability(prisma, branch.id, prod2.id);
    console.log(`Prod 2 stock post-void: ${stock2.availableQuantityDecimal} units (Expected: 5)`);

    // Cannot void an already voided sale
    try {
      await SalesService.voidSale(prisma, {
        saleId: saleToVoid.id,
        reason: 'Double void test',
        voidedBy: 'manager-user-007'
      });
      console.error('❌ FAIL: Allowed double voiding invoice!');
    } catch (err: any) {
      console.log(`✔ PASS: Double void rejected: ${err.message}`);
    }

    // Cleanup
    console.log('\nCleaning up returns test records...');
    await prisma.salesReturnItem.deleteMany({ where: { salesReturn: { sale: { branchId: branch.id } } } });
    await prisma.salesReturn.deleteMany({ where: { sale: { branchId: branch.id } } });
    await prisma.voidAuditLog.deleteMany({ where: { sale: { branchId: branch.id } } });
    await prisma.customerLedger.deleteMany({ where: { customerId: customer.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    await prisma.payment.deleteMany({ where: { sale: { branchId: branch.id } } });
    await prisma.saleItem.deleteMany({ where: { sale: { branchId: branch.id } } });
    await prisma.sale.deleteMany({ where: { branchId: branch.id } });
    console.log('Cleanup completed.');

    console.log('\n--- ALL RETURNS & VOID AUDITS TESTS COMPLETED SUCCESSFULLY ---');

  } catch (err: any) {
    console.error('❌ Test execution failed with error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

runReturnsAndVoidsTests();
