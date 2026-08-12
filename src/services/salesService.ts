import { 
  PrismaClient, Sale, SaleItem, Payment, 
  PaymentMethod, DiscountType, StockMovementType, SaleStatus, SalesReturn, SalesReturnItem, VoidAuditLog
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

export interface PaymentInput {
  method: PaymentMethod;
  amountRupees: number;
  chequeNumber?: string;
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
  payments?: PaymentInput[];
  offlineUuid?: string;
  syncStatus?: string;
}

export interface SalesHistoryFilters {
  startDate?: Date | string;
  endDate?: Date | string;
  branchId?: string;
  cashierId?: string;
  status?: SaleStatus;
  customerId?: string;
  receiptSearch?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'createdAt' | 'invoiceNumber' | 'grandTotalPaise';
  sortOrder?: 'asc' | 'desc';
}

export interface ReturnItemInput {
  productId: string;
  quantityDecimal: number;
}

export interface ProcessReturnInput {
  saleId: string;
  items: ReturnItemInput[];
  refundMethod: PaymentMethod;
  reason?: string;
}

export interface ProcessVoidInput {
  saleId: string;
  reason: string;
  voidedBy: string;
}

export class SalesService {
  /**
   * Reusable Payment Validation Primitive
   * Validates Split Payments and Cheque Metadata Rules
   */
  public static validatePayments(
    grandTotalPaise: number,
    payments: PaymentInput[]
  ): void {
    let totalPaymentsPaise = 0;

    for (const p of payments) {
      const amtPaise = UnitNormalizer.toPaise(p.amountRupees);
      if (amtPaise <= 0) {
        throw new Error(`Payment amount must be greater than zero. Received ₹${p.amountRupees} for ${p.method}.`);
      }
      totalPaymentsPaise += amtPaise;

      // Cheque validation rule
      if (p.method === PaymentMethod.CHEQUE) {
        if (!p.chequeNumber || p.chequeNumber.trim().length === 0) {
          throw new Error('Cheque number is required when payment method is CHEQUE.');
        }
      }
    }

    // Split payment total check
    if (totalPaymentsPaise !== grandTotalPaise) {
      const expectedRupees = UnitNormalizer.fromPaise(grandTotalPaise);
      const paidRupees = UnitNormalizer.fromPaise(totalPaymentsPaise);
      throw new Error(
        `Payment total mismatch. Total expected: ₹${expectedRupees.toFixed(2)}, total paid: ₹${paidRupees.toFixed(2)}.`
      );
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

      // 3. Reserve Next Invoice Number Transactionally (Acquires sequence lock)
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
            quantityMilli: reqMilli,
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

      // 6. Map and Normalize Split Payments input
      let payments: PaymentInput[] = [];
      if (input.payments && input.payments.length > 0) {
        payments = input.payments;
      } else {
        // Fallback for backward compatibility
        payments = [
          {
            method: input.paymentMethod || PaymentMethod.CASH,
            amountRupees: input.paymentAmountRupees !== undefined 
              ? input.paymentAmountRupees 
              : UnitNormalizer.fromPaise(grandTotalPaise),
            chequeNumber: input.chequeNumber
          }
        ];
      }

      // 7. Validate Payment Sum matches invoice Total
      this.validatePayments(grandTotalPaise, payments);

      // 8. Process On-Account Credit limits and Customer Ledger writes
      const creditPayment = payments.find(p => p.method === PaymentMethod.CREDIT);
      if (creditPayment) {
        if (!input.customerId) {
          throw new Error("Customer profile is required for On-Account/Credit payments.");
        }
        const customer = await tx.customer.findFirst({
          where: { id: input.customerId, isDeleted: false }
        });
        if (!customer) {
          throw new Error(`Customer with ID ${input.customerId} not found.`);
        }

        const creditAmountPaise = UnitNormalizer.toPaise(creditPayment.amountRupees);
        const potentialBalancePaise = customer.outstandingBalancePaise + creditAmountPaise;

        if (potentialBalancePaise > customer.creditLimitPaise) {
          const excessRupees = UnitNormalizer.fromPaise(potentialBalancePaise - customer.creditLimitPaise);
          throw new Error(
            `Credit limit exceeded. Limit: ₹${UnitNormalizer.fromPaise(customer.creditLimitPaise)}, Potential Balance: ₹${UnitNormalizer.fromPaise(potentialBalancePaise)} (Exceeds limit by ₹${excessRupees}).`
          );
        }

        // Increment outstanding debt
        await tx.customer.update({
          where: { id: customer.id },
          data: { outstandingBalancePaise: potentialBalancePaise }
        });

        // Record credit sale ledger audit
        await tx.customerLedger.create({
          data: {
            customerId: customer.id,
            transactionType: 'CREDIT_SALE',
            amountPaise: creditAmountPaise,
            referenceId: invoiceNumber,
            notes: `Credit Sale Invoice: ${invoiceNumber}`
          }
        });
      }

      // 9. Save Sale & Payments linked records
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
          status: SaleStatus.PAID,
          offlineUuid: input.offlineUuid || null,
          syncStatus: input.syncStatus || 'SYNCED',
          items: {
            create: saleItemsToCreate
          },
          payments: {
            create: payments.map(p => ({
              method: p.method,
              amountPaise: UnitNormalizer.toPaise(p.amountRupees),
              chequeNumber: p.method === PaymentMethod.CHEQUE ? p.chequeNumber?.trim() : null
            }))
          }
        },
        include: { items: true, payments: true }
      });

      return sale;
    });
  }

  /**
   * Retrieves paginated, sorted, and filtered sales history records
   */
  public static async getSalesHistory(
    prisma: PrismaClient,
    filters: SalesHistoryFilters
  ): Promise<{ sales: any[]; totalCount: number }> {
    const where: any = {};

    if (filters.branchId) {
      where.branchId = filters.branchId;
    }

    if (filters.customerId) {
      where.customerId = filters.customerId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        where.createdAt.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        where.createdAt.lte = new Date(filters.endDate);
      }
    }

    if (filters.receiptSearch) {
      where.invoiceNumber = {
        contains: filters.receiptSearch
      };
    }

    const page = filters.page || 1;
    const pageSize = filters.pageSize || 50;
    const skip = (page - 1) * pageSize;

    const sortBy = filters.sortBy || 'createdAt';
    const sortOrder = filters.sortOrder || 'desc';

    const [sales, totalCount] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: {
          items: true,
          payments: true,
          returns: {
            include: {
              items: true
            }
          },
          voidLog: true,
          customer: true
        },
        orderBy: {
          [sortBy]: sortOrder
        },
        skip,
        take: pageSize
      }),
      prisma.sale.count({ where })
    ]);

    return { sales, totalCount };
  }

  /**
   * Process product returns and partial refunds atomically
   */
  public static async processReturn(
    prisma: PrismaClient,
    input: ProcessReturnInput
  ): Promise<SalesReturn & { items: SalesReturnItem[] }> {
    return prisma.$transaction(async (tx) => {
      // 1. Fetch original sale metadata including existing returns
      const sale = await tx.sale.findUnique({
        where: { id: input.saleId },
        include: { items: true, returns: { include: { items: true } } }
      });

      if (!sale) throw new Error(`Sale invoice with ID ${input.saleId} not found.`);
      if (sale.status === SaleStatus.VOID) {
        throw new Error('Cannot process returns or refunds against a VOID invoice.');
      }

      const returnItemsToCreate = [];
      let totalRefundPaise = 0;

      // 2. Validate line item eligibility & calculate refund amounts
      for (const itemInput of input.items) {
        const saleItem = sale.items.find(i => i.productId === itemInput.productId);
        if (!saleItem) {
          throw new Error(`Product ${itemInput.productId} was not part of the original sale invoice.`);
        }

        // Calculate quantity historically returned
        let historicallyReturnedMilli = 0;
        for (const ret of sale.returns) {
          for (const retItem of ret.items) {
            if (retItem.productId === itemInput.productId) {
              historicallyReturnedMilli += retItem.quantityMilli;
            }
          }
        }

        const orderedMilli = saleItem.quantityMilli;
        const requestedMilli = UnitNormalizer.toMilliUnits(itemInput.quantityDecimal);

        if (historicallyReturnedMilli + requestedMilli > orderedMilli) {
          const remainingEligible = (orderedMilli - historicallyReturnedMilli) / 1000;
          throw new Error(
            `Invalid return quantity for product ${saleItem.productNameSnapshot}. ` +
            `Ordered: ${orderedMilli / 1000}, Already Returned: ${historicallyReturnedMilli / 1000}, ` +
            `Requested: ${itemInput.quantityDecimal}. Max eligible to return is: ${remainingEligible}.`
          );
        }

        // Proportional net rate refund math
        const refundRatePaise = saleItem.ratePaise;
        const refundItemTotalPaise = Math.round((refundRatePaise * requestedMilli) / 1000);

        totalRefundPaise += refundItemTotalPaise;

        returnItemsToCreate.push({
          productId: itemInput.productId,
          quantityMilli: requestedMilli,
          ratePaise: refundRatePaise,
          totalPaise: refundItemTotalPaise
        });
      }

      // Generate sequence return voucher reference
      const returnCount = await tx.salesReturn.count();
      const returnNumber = `RET-${(returnCount + 1).toString().padStart(5, '0')}`;

      // 3. Update customer outstanding credit balance if store credit/CREDIT option chosen
      if (input.refundMethod === PaymentMethod.CREDIT) {
        if (!sale.customerId) {
          throw new Error("Credit refund method is only allowed for sales bound to a customer profile.");
        }
        const customer = await tx.customer.findUnique({ where: { id: sale.customerId } });
        if (!customer) throw new Error("Customer profile not found.");

        const newBalance = Math.max(0, customer.outstandingBalancePaise - totalRefundPaise);
        await tx.customer.update({
          where: { id: customer.id },
          data: { outstandingBalancePaise: newBalance }
        });

        // Record credit reduction ledger log
        await tx.customerLedger.create({
          data: {
            customerId: customer.id,
            transactionType: 'CREDIT_REFUND',
            amountPaise: -totalRefundPaise, // Negative to offset credit debt
            referenceId: returnNumber,
            notes: `Credit Refund Voucher: ${returnNumber} | Ref Invoice: ${sale.invoiceNumber}`
          }
        });
      }

      // 4. Restock branch inventory and record movements
      for (const itemInput of input.items) {
        const reqMilli = UnitNormalizer.toMilliUnits(itemInput.quantityDecimal);
        const inv = await tx.branchInventory.findUnique({
          where: { branchId_productId: { branchId: sale.branchId, productId: itemInput.productId } }
        });

        if (inv) {
          await tx.branchInventory.update({
            where: { id: inv.id },
            data: { quantityMilli: inv.quantityMilli + reqMilli }
          });
        } else {
          await tx.branchInventory.create({
            data: { branchId: sale.branchId, productId: itemInput.productId, quantityMilli: reqMilli }
          });
        }

        await tx.stockMovement.create({
          data: {
            branchId: sale.branchId,
            productId: itemInput.productId,
            type: StockMovementType.ADJUSTMENT_IN,
            quantityMilli: reqMilli,
            referenceType: 'RETURN',
            referenceId: returnNumber,
            notes: `Restocked via return voucher: ${returnNumber}`
          }
        });
      }

      // 5. Calculate new sales invoice status
      let totalOrderedMilli = 0;
      let totalReturnedMilli = 0;

      for (const saleItem of sale.items) {
        totalOrderedMilli += saleItem.quantityMilli;

        // Sum previous returns for this item
        let itemReturnedMilli = 0;
        for (const ret of sale.returns) {
          for (const retItem of ret.items) {
            if (retItem.productId === saleItem.productId) {
              itemReturnedMilli += retItem.quantityMilli;
            }
          }
        }

        // Add current return quantity if this item was in the input list
        const currentReturn = input.items.find(i => i.productId === saleItem.productId);
        if (currentReturn) {
          itemReturnedMilli += UnitNormalizer.toMilliUnits(currentReturn.quantityDecimal);
        }

        totalReturnedMilli += itemReturnedMilli;
      }

      let newStatus: SaleStatus = SaleStatus.PARTIALLY_REFUNDED;
      if (totalReturnedMilli >= totalOrderedMilli) {
        newStatus = SaleStatus.FULLY_REFUNDED;
      }

      await tx.sale.update({
        where: { id: sale.id },
        data: { status: newStatus }
      });

      // 6. Save return records
      const salesReturn = await tx.salesReturn.create({
        data: {
          returnNumber,
          saleId: sale.id,
          refundAmountPaise: totalRefundPaise,
          refundMethod: input.refundMethod,
          reason: input.reason || null,
          items: {
            create: returnItemsToCreate
          }
        },
        include: { items: true }
      });

      return salesReturn;
    });
  }

  /**
   * Voids a sales invoice, reverts inventory deductions, and logs audit reports
   */
  public static async voidSale(
    prisma: PrismaClient,
    input: ProcessVoidInput
  ): Promise<VoidAuditLog> {
    return prisma.$transaction(async (tx) => {
      // 1. Fetch invoice data
      const sale = await tx.sale.findUnique({
        where: { id: input.saleId },
        include: { items: true, payments: true, returns: true }
      });

      if (!sale) throw new Error(`Sale invoice with ID ${input.saleId} not found.`);
      if (sale.status === SaleStatus.VOID) {
        throw new Error('Invoice is already VOID.');
      }
      if (sale.returns.length > 0) {
        throw new Error('Cannot void a sales invoice that contains active product returns.');
      }

      // 2. Restock inventory for all items in the invoice
      for (const item of sale.items) {
        if (!item.productId) continue;

        const inv = await tx.branchInventory.findUnique({
          where: { branchId_productId: { branchId: sale.branchId, productId: item.productId } }
        });

        if (inv) {
          await tx.branchInventory.update({
            where: { id: inv.id },
            data: { quantityMilli: inv.quantityMilli + item.quantityMilli }
          });
        } else {
          await tx.branchInventory.create({
            data: { branchId: sale.branchId, productId: item.productId, quantityMilli: item.quantityMilli }
          });
        }

        // Record stock audit log
        await tx.stockMovement.create({
          data: {
            branchId: sale.branchId,
            productId: item.productId,
            type: StockMovementType.ADJUSTMENT_IN,
            quantityMilli: item.quantityMilli,
            referenceType: 'VOID',
            referenceId: sale.invoiceNumber,
            notes: `Stock reverted from Void Invoice: ${sale.invoiceNumber}`
          }
        });
      }

      // 3. Revert customer ledger balance if CREDIT/On-Account was used
      const creditPayment = sale.payments.find(p => p.method === PaymentMethod.CREDIT);
      if (creditPayment && sale.customerId) {
        const customer = await tx.customer.findUnique({ where: { id: sale.customerId } });
        if (customer) {
          const newBalance = Math.max(0, customer.outstandingBalancePaise - creditPayment.amountPaise);
          await tx.customer.update({
            where: { id: customer.id },
            data: { outstandingBalancePaise: newBalance }
          });

          // Ledger log
          await tx.customerLedger.create({
            data: {
              customerId: customer.id,
              transactionType: 'VOID_CREDIT',
              amountPaise: -creditPayment.amountPaise,
              referenceId: sale.invoiceNumber,
              notes: `Void Invoice: ${sale.invoiceNumber} | Reverted credit amount`
            }
          });
        }
      }

      // 4. Mark invoice status as VOID
      await tx.sale.update({
        where: { id: sale.id },
        data: { status: SaleStatus.VOID }
      });

      // 5. Record void audit trail log
      const auditLog = await tx.voidAuditLog.create({
        data: {
          saleId: sale.id,
          reason: input.reason,
          voidedBy: input.voidedBy
        }
      });

      return auditLog;
    });
  }

  public static async getAllSales(prisma: PrismaClient, branchId?: string) {
    return prisma.sale.findMany({
      where: branchId ? { branchId } : {},
      include: { items: true, payments: true, branch: true, customer: true, returns: true, voidLog: true },
      orderBy: { createdAt: 'desc' }
    });
  }
}
