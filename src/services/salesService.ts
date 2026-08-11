import { 
  PrismaClient, Sale, SaleItem, Payment, 
  PaymentMethod, DiscountType, StockMovementType 
} from '@prisma/client';
import { BranchService } from './branchService';
import { InventoryService } from './inventoryService';
import { UnitNormalizer } from './unitNormalizer';

export interface CreateSaleItemInput {
  productId: string;
  quantityDecimal: number;
  rateRupees?: number;
  discountRupees?: number;
}

export interface CreateSaleInput {
  branchId: string;
  customerId?: string;
  items: CreateSaleItemInput[];
  discountType?: DiscountType;
  discountValueBasisPoints?: number;
  discountRupees?: number;
  discountNote?: string;
  paymentMethod?: PaymentMethod;
  paymentAmountRupees?: number;
  chequeNumber?: string;
  chequeBank?: string;
  chequeDate?: Date;
}

export class SalesService {
  /**
   * Reusable Payment Validation Primitive
   * Validates Full Payment Rule and Cheque Metadata Rules
   */
  public static validatePayment(
    grandTotalPaise: number,
    method: PaymentMethod,
    paymentAmountPaise: number,
    chequeNumber?: string
  ): void {
    // 1. Full Payment Rule per Section 34
    if (paymentAmountPaise !== grandTotalPaise) {
      const expectedRupees = UnitNormalizer.fromPaise(grandTotalPaise);
      const paidRupees = UnitNormalizer.fromPaise(paymentAmountPaise);
      throw new Error(`Full payment required in V1. Expected: ₹${expectedRupees.toFixed(2)}, Paid: ₹${paidRupees.toFixed(2)}. Partial payments prohibited.`);
    }

    // 2. Cheque Validation Rules per Section 33
    if (method === PaymentMethod.CHEQUE) {
      if (!chequeNumber || chequeNumber.trim().length === 0) {
        throw new Error('Cheque number is required when payment method is CHEQUE.');
      }
    } else {
      // CASH or UPI
      if (chequeNumber && chequeNumber.trim().length > 0) {
        throw new Error(`Cheque number must be empty when payment method is ${method}.`);
      }
    }
  }

  /**
   * Create Sale Invoice within a Single Safe Database Transaction
   */
  public static async createSale(
    prisma: PrismaClient,
    input: CreateSaleInput
  ): Promise<Sale & { items: SaleItem[]; payments: Payment[] }> {
    return prisma.$transaction(async (tx) => {
      // 1. Query Branch Details for Immutable Branch Snapshot
      const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
      if (!branch) throw new Error(`Branch ${input.branchId} not found`);

      // 2. Query Customer Details for Immutable Customer Snapshot
      let customerNameSnapshot = 'Walk-in Retail Customer';
      let customerAddressSnapshot: string | null = null;
      let customerGstinSnapshot: string | null = null;
      let customerStateSnapshot: string | null = null;

      if (input.customerId) {
        const cust = await tx.customer.findUnique({ where: { id: input.customerId } });
        if (cust) {
          customerNameSnapshot = cust.name;
          customerAddressSnapshot = cust.address || null;
          customerGstinSnapshot = cust.gstin || null;
          customerStateSnapshot = cust.state || null;
        }
      }

      // 3. Reserve Next Invoice Number Transactionally
      const { invoiceNumber, sequenceNumber } = await BranchService.reserveNextInvoiceNumber(
        tx as unknown as PrismaClient,
        input.branchId
      );

      // 4. Process Line Items & Deduct Branch Stock
      let subtotalPaise = 0;
      const saleItemsToCreate = [];

      for (const itemInput of input.items) {
        const product = await tx.product.findUnique({ where: { id: itemInput.productId } });
        if (!product) throw new Error(`Product ${itemInput.productId} not found`);

        const reqMilli = UnitNormalizer.toMilliUnits(itemInput.quantityDecimal);

        // Deduct Branch Stock with Negative Stock Validation
        const inv = await tx.branchInventory.findUnique({
          where: { branchId_productId: { branchId: input.branchId, productId: product.id } }
        });
        const currentMilli = inv ? inv.quantityMilli : 0;

        InventoryService.assertSufficientStock(currentMilli, reqMilli, product.name);

        if (inv) {
          await tx.branchInventory.update({
            where: { id: inv.id },
            data: { quantityMilli: currentMilli - reqMilli }
          });
        }

        // Record StockMovement Audit Log
        await tx.stockMovement.create({
          data: {
            branchId: input.branchId,
            productId: product.id,
            type: StockMovementType.SALE,
            quantityMilli: reqMilli, // Positive magnitude per Section 23
            referenceType: 'SALE',
            referenceId: invoiceNumber,
            notes: `Sale Invoice: ${invoiceNumber}`
          }
        });

        const ratePaise = itemInput.rateRupees !== undefined ? UnitNormalizer.toPaise(itemInput.rateRupees) : product.sellingPricePaise;
        const grossPaise = Math.round((ratePaise * reqMilli) / 1000);
        const itemDiscountPaise = itemInput.discountRupees ? UnitNormalizer.toPaise(itemInput.discountRupees) : 0;
        const lineTotalPaise = Math.max(0, grossPaise - itemDiscountPaise);

        subtotalPaise += lineTotalPaise;

        saleItemsToCreate.push({
          productId: product.id,
          skuSnapshot: product.sku,
          productNameSnapshot: product.name,
          profileSnapshot: product.profile || null,
          unitSnapshot: product.sellingUnit,
          quantityMilli: reqMilli,
          ratePaise,
          grossPaise,
          discountPaise: itemDiscountPaise,
          lineTotalPaise
        });
      }

      // 5. Calculate Discount & Grand Total in Paise
      let discountPaise = 0;
      if (input.discountType === DiscountType.PERCENTAGE && input.discountValueBasisPoints) {
        discountPaise = Math.round((subtotalPaise * input.discountValueBasisPoints) / 10000);
      } else if (input.discountRupees) {
        discountPaise = UnitNormalizer.toPaise(input.discountRupees);
      }

      const grandTotalPaise = Math.max(0, subtotalPaise - discountPaise);

      // 6. Validate Payment Method & Full Payment Rule
      const paymentMethod = input.paymentMethod || PaymentMethod.CASH;
      const paymentAmountPaise = input.paymentAmountRupees !== undefined
        ? UnitNormalizer.toPaise(input.paymentAmountRupees)
        : grandTotalPaise;

      this.validatePayment(grandTotalPaise, paymentMethod, paymentAmountPaise, input.chequeNumber);

      // 7. Create Sale & Payment Records with Immutable Snapshots
      const sale = await tx.sale.create({
        data: {
          invoiceNumber,
          invoiceSequence: sequenceNumber,
          branchId: input.branchId,
          customerId: input.customerId || null,
          branchNameSnapshot: branch.name,
          branchAddressSnapshot: branch.address || null,
          branchGstinSnapshot: branch.gstin || null,
          branchPhoneSnapshot: branch.phone || null,
          branchStateSnapshot: branch.state || null,
          customerNameSnapshot,
          customerAddressSnapshot,
          customerGstinSnapshot,
          customerStateSnapshot,
          subtotalPaise,
          discountType: input.discountType || null,
          discountValueBasisPoints: input.discountValueBasisPoints || null,
          discountPaise,
          discountNote: input.discountNote || null,
          grandTotalPaise,
          items: {
            create: saleItemsToCreate
          },
          payments: {
            create: [
              {
                method: paymentMethod,
                amountPaise: paymentAmountPaise,
                chequeNumber: paymentMethod === PaymentMethod.CHEQUE ? input.chequeNumber?.trim() : null
              }
            ]
          }
        },
        include: { items: true, payments: true }
      });

      return sale;
    });
  }

  public static async getAllSales(prisma: PrismaClient, branchId?: string) {
    return prisma.sale.findMany({
      where: branchId ? { branchId } : {},
      include: { items: true, payments: true, branch: true, customer: true },
      orderBy: { createdAt: 'desc' }
    });
  }
}
