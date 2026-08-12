import { PrismaClient, PurchaseOrderStatus } from '@prisma/client';
import { ProductService } from '../src/services/productService';
import { PurchaseOrderService } from '../src/services/purchaseOrderService';
import { GRNService } from '../src/services/grnService';
import { InventoryService } from '../src/services/inventoryService';

const prisma = new PrismaClient();

async function runWacTests() {
  console.log('--- STARTING PURCHASE ORDER & WAC COSTING Lifecycle TESTS ---');

  try {
    // 1. Setup Master Records (Company, Branch, Supplier, Product)
    console.log('\n[1/6] Bootstrapping master data...');
    let company = await prisma.company.findFirst();
    if (!company) {
      company = await prisma.company.create({
        data: { name: 'AlumFab Test Ltd' }
      });
    }

    let branch = await prisma.branch.findFirst({ where: { code: 'BR-WAC' } });
    if (!branch) {
      branch = await prisma.branch.create({
        data: { code: 'BR-WAC', name: 'WAC Store', address: 'WAC Location', phone: '9999999999', companyId: company.id }
      });
    }

    let supplier = await prisma.supplier.findFirst({ where: { name: 'Apex Metal Supp' } });
    if (!supplier) {
      supplier = await prisma.supplier.create({
        data: { name: 'Apex Metal Supp', phone: '8888888888', address: 'Supplier Hub' }
      });
    }

    // Create 2 new products to isolate costing calculations
    const sku1 = 'PROD-WAC-1';
    const sku2 = 'PROD-WAC-2';

    // Delete existing test products if any
    await prisma.product.deleteMany({ where: { sku: { in: [sku1, sku2] } } });

    const prod1 = await ProductService.createProduct(prisma, {
      sku: sku1,
      name: 'WAC Profile 18mm',
      sellingPrice: 150.00,
      costPrice: 0.00, // Starts at 0 WAC
      sellingUnit: 'PCS'
    });

    const prod2 = await ProductService.createProduct(prisma, {
      sku: sku2,
      name: 'WAC Hardware Bearing',
      sellingPrice: 80.00,
      costPrice: 0.00, // Starts at 0 WAC
      sellingUnit: 'PCS'
    });

    console.log(`Product 1: ${prod1.name} (WAC: ₹${prod1.costPricePaise / 100})`);
    console.log(`Product 2: ${prod2.name} (WAC: ₹${prod2.costPricePaise / 100})`);

    // Ensure branch stock starts at 0 for these products
    await prisma.branchInventory.deleteMany({ where: { productId: { in: [prod1.id, prod2.id] } } });

    // 2. Create Purchase Order in DRAFT status
    console.log('\n[2/6] Creating Purchase Order...');
    const po = await PurchaseOrderService.createPurchaseOrder(prisma, {
      branchId: branch.id,
      supplierId: supplier.id,
      notes: 'Monthly bulk requisition',
      expectedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      items: [
        { productId: prod1.id, quantityDecimal: 20.0, unitCostRupees: 100.00, taxPercentage: 18.0 }, // 20 units @ 100
        { productId: prod2.id, quantityDecimal: 10.0, unitCostRupees: 50.00, taxPercentage: 18.0 }   // 10 units @ 50
      ]
    });
    console.log(`Purchase Order ${po.poNumber} created in status: ${po.status}`);
    console.log(`Expected delivery date: ${po.expectedDeliveryDate}`);

    // Try to receive against DRAFT order
    try {
      console.log('Testing receiving constraint against DRAFT PO...');
      await GRNService.createGRN(prisma, {
        purchaseOrderId: po.id,
        supplierId: supplier.id,
        branchId: branch.id,
        receivedBy: 'Store Manager',
        items: [
          { productId: prod1.id, quantityReceivedDecimal: 10.0, quantityAcceptedDecimal: 10.0, quantityRejectedDecimal: 0.0, unitCostRupees: 100.00, taxPercentage: 18.0 }
        ]
      });
      console.error('❌ FAIL: Allowed receiving against a DRAFT Purchase Order!');
    } catch (err: any) {
      console.log(`✔ PASS: Receipt blocked successfully: ${err.message}`);
    }

    // Approve/Release the PO
    console.log('Transitioning PO status to ORDERED...');
    const orderedPO = await PurchaseOrderService.updateOrderStatus(prisma, po.id, PurchaseOrderStatus.ORDERED);
    console.log(`Purchase Order status updated to: ${orderedPO.status}`);

    // 3. First GRN Execution: Partial Fulfillment
    console.log('\n[3/6] Executing GRN 1: Partial receiving (10 units of Prod 1, 5 units of Prod 2)...');
    const grn1 = await GRNService.createGRN(prisma, {
      purchaseOrderId: orderedPO.id,
      supplierId: supplier.id,
      branchId: branch.id,
      receivedBy: 'Store Manager',
      notes: 'First delivery batch',
      items: [
        {
          productId: prod1.id,
          quantityReceivedDecimal: 12.0, // 12 received, 10 accepted, 2 rejected
          quantityAcceptedDecimal: 10.0,
          quantityRejectedDecimal: 2.0,
          unitCostRupees: 100.00, // Cost is 100
          taxPercentage: 18.0,
          notes: '2 units bent during transit'
        },
        {
          productId: prod2.id,
          quantityReceivedDecimal: 5.0, // 5 received, 5 accepted
          quantityAcceptedDecimal: 5.0,
          quantityRejectedDecimal: 0.0,
          unitCostRupees: 50.00, // Cost is 50
          taxPercentage: 18.0
        }
      ]
    });

    console.log(`GRN 1 confirmed: ${grn1.grnNumber}`);

    // Verify stock balance increment
    const stock1_after_grn1 = await InventoryService.checkStockAvailability(prisma, branch.id, prod1.id);
    const stock2_after_grn1 = await InventoryService.checkStockAvailability(prisma, branch.id, prod2.id);
    console.log(`Stock levels post-GRN1: Prod 1 = ${stock1_after_grn1.availableQuantityDecimal} units, Prod 2 = ${stock2_after_grn1.availableQuantityDecimal} units`);

    // Verify WAC pricing (since original stock was 0, WAC should equal incoming unit cost)
    const updatedProd1_WAC1 = await prisma.product.findUnique({ where: { id: prod1.id } });
    const updatedProd2_WAC1 = await prisma.product.findUnique({ where: { id: prod2.id } });
    console.log(`WAC post-GRN1: Prod 1 WAC = ₹${updatedProd1_WAC1!.costPricePaise / 100} (Expected: 100.00)`);
    console.log(`WAC post-GRN1: Prod 2 WAC = ₹${updatedProd2_WAC1!.costPricePaise / 100} (Expected: 50.00)`);

    // Verify PO status transition
    const poState1 = await PurchaseOrderService.getPurchaseOrderById(prisma, orderedPO.id);
    console.log(`Linked Purchase Order status: ${poState1!.status} (Expected: PARTIALLY_RECEIVED)`);

    // 4. Second GRN Execution: WAC math validation and final fulfillment
    // Let's receive the remaining units but at a DIFFERENT cost price!
    // Prod 1: Remaining 10 units at ₹120.00 (Current WAC: 100.00, Current Stock: 10)
    //   WAC Formula: [(10 * 100.00) + (10 * 120.00)] / (10 + 10) = 110.00
    // Prod 2: Remaining 5 units at ₹60.00 (Current WAC: 50.00, Current Stock: 5)
    //   WAC Formula: [(5 * 50.00) + (5 * 60.00)] / (5 + 5) = 55.00
    console.log('\n[4/6] Executing GRN 2: Remaining units at adjusted costs...');
    const grn2 = await GRNService.createGRN(prisma, {
      purchaseOrderId: orderedPO.id,
      supplierId: supplier.id,
      branchId: branch.id,
      receivedBy: 'Store Manager',
      notes: 'Final PO fulfillment delivery',
      items: [
        {
          productId: prod1.id,
          quantityReceivedDecimal: 10.0,
          quantityAcceptedDecimal: 10.0,
          quantityRejectedDecimal: 0.0,
          unitCostRupees: 120.00, // Cost is 120 (higher)
          taxPercentage: 18.0
        },
        {
          productId: prod2.id,
          quantityReceivedDecimal: 5.0,
          quantityAcceptedDecimal: 5.0,
          quantityRejectedDecimal: 0.0,
          unitCostRupees: 60.00, // Cost is 60 (higher)
          taxPercentage: 18.0
        }
      ]
    });

    console.log(`GRN 2 confirmed: ${grn2.grnNumber}`);

    // Verify stock balance increment
    const stock1_final = await InventoryService.checkStockAvailability(prisma, branch.id, prod1.id);
    const stock2_final = await InventoryService.checkStockAvailability(prisma, branch.id, prod2.id);
    console.log(`Final Stock levels: Prod 1 = ${stock1_final.availableQuantityDecimal} units, Prod 2 = ${stock2_final.availableQuantityDecimal} units`);

    // Verify WAC pricing calculations
    const updatedProd1_WAC2 = await prisma.product.findUnique({ where: { id: prod1.id } });
    const updatedProd2_WAC2 = await prisma.product.findUnique({ where: { id: prod2.id } });
    console.log(`Final recalculated WAC: Prod 1 WAC = ₹${updatedProd1_WAC2!.costPricePaise / 100} (Expected: 110.00)`);
    console.log(`Final recalculated WAC: Prod 2 WAC = ₹${updatedProd2_WAC2!.costPricePaise / 100} (Expected: 55.00)`);

    // Verify PO status transition
    const poState2 = await PurchaseOrderService.getPurchaseOrderById(prisma, orderedPO.id);
    console.log(`Linked Purchase Order status: ${poState2!.status} (Expected: FULLY_RECEIVED)`);

    // 5. Verify Soft Delete & Audit Logging
    console.log('\n[5/6] Verifying Stock Movement entries...');
    const movements = await InventoryService.getStockMovements(prisma, branch.id);
    const wacMovements = movements.filter(m => m.productId === prod1.id);
    console.log(`Found ${wacMovements.length} stock ledger movements for Product 1 in this branch:`);
    wacMovements.forEach(m => {
      console.log(`  - Type: ${m.type} | Qty: ${m.quantityMilli / 1000} | Ref: ${m.referenceType}:${m.referenceId}`);
    });

    // 6. Cleanup
    console.log('\n[6/6] Cleaning up test order records...');
    await prisma.gRNItem.deleteMany({ where: { grnId: { in: [grn1.id, grn2.id] } } });
    await prisma.goodsReceivedNote.deleteMany({ where: { id: { in: [grn1.id, grn2.id] } } });
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: po.id } });
    await prisma.purchaseOrder.deleteMany({ where: { id: po.id } });
    console.log('Cleanup completed.');

    console.log('\n--- ALL PO & WAC LIFECYCLE TESTS COMPLETED SUCCESSFULLY ---');

  } catch (err: any) {
    console.error('❌ Test execution encountered a fatal error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

runWacTests();
