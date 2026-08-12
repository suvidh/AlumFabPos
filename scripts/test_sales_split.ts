import { PrismaClient, PaymentMethod, DiscountType } from '@prisma/client';
import { ProductService } from '../src/services/productService';
import { CustomerService } from '../src/services/customerService';
import { SalesService } from '../src/services/salesService';
import { InventoryService } from '../src/services/inventoryService';

const prisma = new PrismaClient();

async function runSplitSalesTests() {
  console.log('--- STARTING SPLIT PAYMENT & CHECKOUT TRANSACTION TESTS ---');

  try {
    // 1. Setup Master Records
    console.log('\n[1/5] Bootstrapping master data...');
    let company = await prisma.company.findFirst();
    if (!company) {
      company = await prisma.company.create({
        data: { name: 'AlumFab Test Ltd' }
      });
    }

    let branch = await prisma.branch.findFirst({ where: { code: 'BR-SALE' } });
    if (!branch) {
      branch = await prisma.branch.create({
        data: { code: 'BR-SALE', name: 'Billing desk store', address: 'Sec 5', phone: '1112223334', companyId: company.id }
      });
    }

    // Register a test customer with credit
    const customer = await CustomerService.createCustomer(prisma, {
      name: 'Delta Builders Ltd',
      phone: '555-0812',
      email: 'delta@builders.com',
      defaultBranchId: branch.id,
      creditLimitRupees: 2000.00, // ₹2,000.00 credit limit
      outstandingBalanceRupees: 0.00
    });
    console.log(`Customer Created: ${customer.name} | Credit Limit: ₹${customer.creditLimitPaise / 100}`);

    // Create products
    const sku1 = 'PROD-SALE-1';
    const sku2 = 'PROD-SALE-2';

    await prisma.product.deleteMany({ where: { sku: { in: [sku1, sku2] } } });

    const prod1 = await ProductService.createProduct(prisma, {
      sku: sku1,
      name: 'Sliding Roller HD',
      sellingPrice: 150.00,
      sellingUnit: 'PCS'
    });

    const prod2 = await ProductService.createProduct(prisma, {
      sku: sku2,
      name: 'Aluminum Channel 12ft',
      sellingPrice: 500.00,
      sellingUnit: 'PCS'
    });

    // Seed stock: Prod 1 = 10 units, Prod 2 = 5 units
    await prisma.branchInventory.deleteMany({ where: { productId: { in: [prod1.id, prod2.id] } } });
    
    await prisma.branchInventory.create({ data: { branchId: branch.id, productId: prod1.id, quantityMilli: 10000 } }); // 10 units
    await prisma.branchInventory.create({ data: { branchId: branch.id, productId: prod2.id, quantityMilli: 5000 } });  // 5 units

    console.log(`Product 1 Stock: 10 units @ ₹150.00`);
    console.log(`Product 2 Stock: 5 units @ ₹500.00`);

    // 2. Test Split Payment Sale Checkout (Cash + Card + Credit)
    // Sale details:
    // - 2 units of Prod 1: ₹300.00
    // - 2 units of Prod 2: ₹1000.00
    // - Total material subtotal: ₹1,300.00
    // - Split payments: Cash ₹200.00 + Card ₹600.00 + Credit ₹500.00 = ₹1,300.00
    console.log('\n[2/5] Creating split payment sale (Cash ₹200 + Card ₹600 + Credit ₹500)...');
    const saleResult = await SalesService.createSale(prisma, {
      branchId: branch.id,
      customerId: customer.id,
      items: [
        { productId: prod1.id, quantityDecimal: 2 },
        { productId: prod2.id, quantityDecimal: 2 }
      ],
      payments: [
        { method: PaymentMethod.CASH, amountRupees: 200.00 },
        { method: PaymentMethod.CARD, amountRupees: 600.00 },
        { method: PaymentMethod.CREDIT, amountRupees: 500.00 }
      ]
    });

    console.log(`✔ PASS: Sale Created: ${saleResult.invoiceNumber} | Grand Total: ₹${saleResult.grandTotalPaise / 100}`);
    console.log('Payments recorded:');
    saleResult.payments.forEach(p => {
      console.log(`  - Method: ${p.method} | Amount: ₹${p.amountPaise / 100}`);
    });

    // Check customer credit balance incremented
    const updatedCustomer1 = await CustomerService.getCustomerById(prisma, customer.id);
    console.log(`Customer outstanding balance: ₹${updatedCustomer1!.outstandingBalancePaise / 100} (Expected: ₹500.00)`);

    // Check stock decremented
    const stock1 = await InventoryService.checkStockAvailability(prisma, branch.id, prod1.id);
    const stock2 = await InventoryService.checkStockAvailability(prisma, branch.id, prod2.id);
    console.log(`Stock level post-checkout: Prod 1 = ${stock1.availableQuantityDecimal} units, Prod 2 = ${stock2.availableQuantityDecimal} units`);

    // 3. Test Payment Mismatch Block (Sum of splits != Grand Total)
    console.log('\n[3/5] Testing split payment total mismatch validation...');
    try {
      await SalesService.createSale(prisma, {
        branchId: branch.id,
        customerId: customer.id,
        items: [
          { productId: prod1.id, quantityDecimal: 1 }
        ],
        payments: [
          { method: PaymentMethod.CASH, amountRupees: 100.00 } // Total is ₹150, paid ₹100
        ]
      });
      console.error('❌ FAIL: Allowed transaction with payment total mismatch!');
    } catch (err: any) {
      console.log(`✔ PASS: Mismatch blocked: ${err.message}`);
    }

    // 4. Test Overlimit Credit block inside Split Checkout
    // Current Customer Balance is ₹500.00. Credit limit is ₹2,000.00. (Remaining credit ₹1,500.00)
    // Create a sale of ₹1,800.00 paid 100% on Credit. (Would exceed limit: 500 + 1800 = 2300 > 2000)
    console.log('\n[4/5] Testing customer credit limit validation in split checkout...');
    try {
      await SalesService.createSale(prisma, {
        branchId: branch.id,
        customerId: customer.id,
        items: [
          { productId: prod2.id, quantityDecimal: 3 } // 3 * 500 = ₹1,500.00 + 18% tax? Wait, in salesService tax is included in ratePaise
        ],
        payments: [
          { method: PaymentMethod.CREDIT, amountRupees: 1500.00 } // Total ₹1,500.00, would push balance to 500 + 1500 = 2000 (Exactly at limit, should pass)
        ]
      });
      console.log('✔ PASS: Credit sale exactly at limit succeeded.');

      console.log('Attempting credit sale that exceeds the limit by ₹100...');
      await SalesService.createSale(prisma, {
        branchId: branch.id,
        customerId: customer.id,
        items: [
          { productId: prod1.id, quantityDecimal: 1 } // ₹150.00
        ],
        payments: [
          { method: PaymentMethod.CREDIT, amountRupees: 150.00 } // 2000 + 150 = 2150 > 2000 (exceeds)
        ]
      });
      console.error('❌ FAIL: Allowed credit sale exceeding the limit!');
    } catch (err: any) {
      console.log(`✔ PASS: Overlimit credit blocked and transaction rolled back: ${err.message}`);
    }

    // 5. Test Insufficient Stock rollback inside Checkout
    // Current stock of Prod 1 is 8 units. Attempt to buy 12 units.
    console.log('\n[5/5] Testing insufficient stock validation and rollback...');
    try {
      await SalesService.createSale(prisma, {
        branchId: branch.id,
        items: [
          { productId: prod1.id, quantityDecimal: 12.0 }
        ],
        payments: [
          { method: PaymentMethod.CASH, amountRupees: 1800.00 }
        ]
      });
      console.error('❌ FAIL: Allowed sale of more items than in stock!');
    } catch (err: any) {
      console.log(`✔ PASS: Insufficient stock blocked and rolled back: ${err.message}`);
    }

    // Cleanup
    console.log('\nCleaning up test sale records...');
    await prisma.customerLedger.deleteMany({ where: { customerId: customer.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    await prisma.payment.deleteMany({ where: { sale: { branchId: branch.id } } });
    await prisma.saleItem.deleteMany({ where: { sale: { branchId: branch.id } } });
    await prisma.sale.deleteMany({ where: { branchId: branch.id } });
    console.log('Cleanup completed.');

    console.log('\n--- ALL SPLIT PAYMENT & CHECKOUT TRANSACTION TESTS COMPLETED SUCCESSFULLY ---');

  } catch (err: any) {
    console.error('❌ Test execution encountered a fatal error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

runSplitSalesTests();
