import { PrismaClient, PaymentMethod, SaleStatus } from '@prisma/client';
import { ProductService } from '../src/services/productService';
import { CustomerService } from '../src/services/customerService';
import { SalesService } from '../src/services/salesService';
import { ReportService } from '../src/services/reportService';
import { InventoryService } from '../src/services/inventoryService';

const prisma = new PrismaClient();

async function runReportingAndReconciliationTests() {
  console.log('--- STARTING REPORTING & Z-REPORT RECONCILIATION TESTS ---');

  try {
    // 1. Setup Master Records
    console.log('\n[1/6] Bootstrapping branch and catalog...');
    let company = await prisma.company.findFirst();
    if (!company) {
      company = await prisma.company.create({
        data: { name: 'AlumFab Test Ltd' }
      });
    }

    let branch = await prisma.branch.findFirst({ where: { code: 'BR-REP' } });
    if (!branch) {
      branch = await prisma.branch.create({
        data: { code: 'BR-REP', name: 'Reconciliation Hub', address: 'Sec 12', phone: '3334445556', companyId: company.id }
      });
    }

    const cashierId = 'cashier-super-01';

    // Create products with Cost Price and Selling Price to check COGS & Profit margins
    const sku1 = 'REP-PROD-1';
    const sku2 = 'REP-PROD-2';

    await prisma.product.deleteMany({ where: { sku: { in: [sku1, sku2] } } });

    const prod1 = await prisma.product.create({
      data: {
        sku: sku1,
        name: 'Standard sliding roller',
        sellingPricePaise: 10000, // ₹100 selling price
        costPricePaise: 6000,     // ₹60 cost price (40% margin)
        taxPercentage: 18.0,
        sellingUnit: 'PCS'
      }
    });

    const prod2 = await prisma.product.create({
      data: {
        sku: sku2,
        name: 'Heavy profile length 12ft',
        sellingPricePaise: 50000, // ₹500 selling price
        costPricePaise: 30000,    // ₹300 cost price (40% margin)
        taxPercentage: 12.0,
        sellingUnit: 'PCS'
      }
    });

    // Seed stock
    await prisma.branchInventory.deleteMany({ where: { productId: { in: [prod1.id, prod2.id] } } });
    await prisma.branchInventory.create({ data: { branchId: branch.id, productId: prod1.id, quantityMilli: 50000 } }); // 50
    await prisma.branchInventory.create({ data: { branchId: branch.id, productId: prod2.id, quantityMilli: 50000 } }); // 50

    // 2. Open Cash Shift Register Session
    console.log('\n[2/6] Opening register cash drawer shift with ₹1,000 float...');
    const shift = await ReportService.openShift(prisma, branch.id, cashierId, 1000.00);
    console.log(`✔ Cash Shift Opened: ID: ${shift.id} | Starting Float: ₹${shift.startingFloatPaise / 100} | Status: ${shift.status}`);

    // 3. Process Sales under this shift
    // Sale 1: 5 units of Prod 1 (₹500 cash)
    // Sale 2: 2 units of Prod 2 (₹1000 card)
    console.log('\n[3/6] Processing sales under active shift...');
    const sale1 = await SalesService.createSale(prisma, {
      branchId: branch.id,
      items: [{ productId: prod1.id, quantityDecimal: 5 }],
      payments: [{ method: PaymentMethod.CASH, amountRupees: 500.00 }]
    });

    const sale2 = await SalesService.createSale(prisma, {
      branchId: branch.id,
      items: [{ productId: prod2.id, quantityDecimal: 2 }],
      payments: [{ method: PaymentMethod.CARD, amountRupees: 1000.00 }]
    });

    // Link sales to shift
    await prisma.sale.update({ where: { id: sale1.id }, data: { shiftId: shift.id } });
    await prisma.sale.update({ where: { id: sale2.id }, data: { shiftId: shift.id } });

    console.log(`Processed Sale 1: ${sale1.invoiceNumber} (₹500 Cash)`);
    console.log(`Processed Sale 2: ${sale2.invoiceNumber} (₹1,000 Card)`);

    // 4. Close Shift & Generate Z-Report
    // Expected Cash = Float ₹1000 + Cash Sale ₹500 = ₹1500.
    // Cashier inputs Actual Count = ₹1510 (Over by ₹10 variance)
    console.log('\n[4/6] Closing shift and generating Z-Report...');
    const closedShift = await ReportService.closeShift(prisma, {
      shiftId: shift.id,
      actualCashRupees: 1510.00,
      notes: 'Closing cashier shift reconciliation'
    });

    console.log(`✔ Z-Report Closed: ID: ${closedShift.id}`);
    console.log(`  - System Expected Cash: ₹${closedShift.expectedCashPaise / 100}`);
    console.log(`  - Cashier Actual Cash  : ₹${closedShift.actualCashPaise! / 100}`);
    console.log(`  - Variance (Over/Short): ₹${closedShift.variancePaise! / 100} (Expected: +₹10)`);
    console.log(`  - Sales totals by method: Cash: ₹${closedShift.cashSalesPaise / 100}, Card: ₹${closedShift.cardSalesPaise / 100}`);
    console.log(`  - Shift Status: ${closedShift.status}`);

    // Verify terminal session locks further updates on this shift
    try {
      await ReportService.closeShift(prisma, {
        shiftId: shift.id,
        actualCashRupees: 1500.00
      });
      console.error('❌ FAIL: Allowed closing an already closed shift!');
    } catch (err: any) {
      console.log(`✔ PASS: Closing already closed shift blocked: ${err.message}`);
    }

    // 5. Test Sales, Profit, and Tax Compliance Analytics (Time bounds: today)
    console.log('\n[5/6] Generating sales and profit reports (Time-bound query)...');
    const todayStr = new Date().toISOString().split('T')[0];

    const summary = await ReportService.getSalesSummary(prisma, branch.id, {
      startDateStr: todayStr,
      endDateStr: todayStr
    });
    console.log('Daily Sales Summary:');
    console.log(`  - Gross Sales: ₹${summary.grossSales}`);
    console.log(`  - Discounts: ₹${summary.discounts}`);
    console.log(`  - Net Taxable: ₹${summary.netSales}`);
    console.log(`  - Tax Portion (18% Avg): ₹${summary.taxesCollected}`);

    // Margin analysis
    // Sale 1: 5 * 100 = 500 revenue, COGS = 5 * 60 = 300 cogs. Profit = 200.
    // Sale 2: 2 * 500 = 1000 revenue, COGS = 2 * 300 = 600 cogs. Profit = 400.
    // Total Revenue = ₹1500. Total COGS = ₹900. Gross Profit = ₹600. Margin = 40%.
    const margins = await ReportService.getProfitMarginAnalysis(prisma, branch.id, {
      startDateStr: todayStr,
      endDateStr: todayStr
    });
    console.log('Profit Margin Analysis:');
    console.log(`  - Total Revenue: ₹${margins.revenue} (Expected: ₹1500)`);
    console.log(`  - Total COGS: ₹${margins.cogs} (Expected: ₹900)`);
    console.log(`  - Gross Profit: ₹${margins.grossProfit} (Expected: ₹600)`);
    console.log(`  - Profit Margin: ${margins.profitMarginPercent}% (Expected: 40%)`);

    // Tax Liability Report (18% group & 12% group)
    // Roller: Total ₹500 (18%). Tax = 500 - (500/1.18) = ₹76.27
    // Profile: Total ₹1000 (12%). Tax = 1000 - (1000/1.12) = ₹107.14
    console.log('\n[6/6] Generating HSN/GST tax liability compliance report...');
    const taxes = await ReportService.getTaxLiabilityReport(prisma, branch.id, {
      startDateStr: todayStr,
      endDateStr: todayStr
    });
    taxes.forEach(t => {
      console.log(`  - Tax Rate: ${t.taxRate}% | Taxable Amount: ₹${t.taxableAmount.toFixed(2)} | GST Collected: ₹${t.taxAmount.toFixed(2)}`);
    });

    // Top selling products
    const topProd = await ReportService.getTopSellingProducts(prisma, branch.id);
    console.log('Top Selling Products:');
    topProd.forEach(tp => {
      console.log(`  - Product: ${tp.productName} | Qty Sold: ${tp.totalQuantity} | Total Rev: ₹${tp.totalRevenue}`);
    });

    // Cleanup
    console.log('\nCleaning up report test records...');
    await prisma.sale.updateMany({ where: { branchId: branch.id }, data: { shiftId: null } });
    await prisma.cashShift.deleteMany({ where: { branchId: branch.id } });
    await prisma.payment.deleteMany({ where: { sale: { branchId: branch.id } } });
    await prisma.saleItem.deleteMany({ where: { sale: { branchId: branch.id } } });
    await prisma.sale.deleteMany({ where: { branchId: branch.id } });
    console.log('Cleanup completed.');

    console.log('\n--- ALL REPORTING & Z-REPORT TESTS COMPLETED SUCCESSFULLY ---');

  } catch (err: any) {
    console.error('❌ Test execution failed with error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

runReportingAndReconciliationTests();
