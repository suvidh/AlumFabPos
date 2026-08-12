import { PrismaClient, GoodsReceivedNote, GRNItem, GRNStatus, PurchaseOrderStatus } from '@prisma/client';
import { UnitNormalizer } from './unitNormalizer';

export interface CreateGRNInput {
  purchaseOrderId?: string;
  supplierId: string;
  branchId: string;
  receivedBy: string;
  notes?: string;
  items: {
    productId: string;
    quantityReceivedDecimal: number;
    quantityAcceptedDecimal: number;
    quantityRejectedDecimal: number;
    unitCostRupees: number;
    taxPercentage: number;
    notes?: string;
  }[];
}

export class GRNService {
  /**
   * Helper to generate a unique GRN Number in format: GRN-YYYYMMDD-XXXX
   */
  private static async generateGRNNumber(prisma: PrismaClient): Promise<string> {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;

    // Find the count of GRNs created today to get the next index
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    const count = await prisma.goodsReceivedNote.count({
      where: {
        createdAt: {
          gte: startOfDay,
          lte: endOfDay
        }
      }
    });

    const nextSeq = String(count + 1).padStart(4, '0');
    return `GRN-${dateStr}-${nextSeq}`;
  }

  /**
   * Creates a Goods Received Note, increases branch inventory, logs stock ledger movements,
   * updates the Product's WAC cost price, and updates Purchase Order statuses atomically.
   */
  public static async createGRN(prisma: PrismaClient, input: CreateGRNInput): Promise<GoodsReceivedNote> {
    const grnNumber = await this.generateGRNNumber(prisma);

    const run = async (tx: any) => {
      // 1. If a PO is linked, assert that it is in an open/receivable state
      if (input.purchaseOrderId) {
        const po = await tx.purchaseOrder.findUnique({
          where: { id: input.purchaseOrderId }
        });
        if (!po) {
          throw new Error(`Linked Purchase Order with ID ${input.purchaseOrderId} not found.`);
        }
        if (po.status === PurchaseOrderStatus.DRAFT) {
          throw new Error(`Cannot receive goods against a DRAFT Purchase Order. Please approve/order the PO first.`);
        }
        if (po.status === PurchaseOrderStatus.CANCELLED) {
          throw new Error(`Cannot receive goods against a CANCELLED Purchase Order.`);
        }
        if (po.status === PurchaseOrderStatus.FULLY_RECEIVED) {
          throw new Error(`Purchase Order ${po.poNumber} has already been FULLY_RECEIVED.`);
        }
      }

      const grnItemsData = [];

      // 2. Process and validate incoming line items
      for (const item of input.items) {
        const qtyReceivedMilli = UnitNormalizer.toMilliUnits(item.quantityReceivedDecimal);
        const qtyAcceptedMilli = UnitNormalizer.toMilliUnits(item.quantityAcceptedDecimal);
        const qtyRejectedMilli = UnitNormalizer.toMilliUnits(item.quantityRejectedDecimal);
        const costPaise = UnitNormalizer.toPaise(item.unitCostRupees);

        // Core business constraint check
        if (qtyReceivedMilli !== qtyAcceptedMilli + qtyRejectedMilli) {
          throw new Error(
            `Quantity mismatch for product ${item.productId}. Received (${item.quantityReceivedDecimal}) must equal Accepted (${item.quantityAcceptedDecimal}) + Rejected (${item.quantityRejectedDecimal}).`
          );
        }

        const lineSubtotalPaise = Math.round((costPaise * qtyAcceptedMilli) / 1000);
        const lineTaxPaise = Math.round(lineSubtotalPaise * (item.taxPercentage / 100));
        const lineTotalPaise = lineSubtotalPaise + lineTaxPaise;

        grnItemsData.push({
          productId: item.productId,
          quantityReceivedMilli: qtyReceivedMilli,
          quantityAcceptedMilli: qtyAcceptedMilli,
          quantityRejectedMilli: qtyRejectedMilli,
          unitCostPaise: costPaise,
          taxPercentage: item.taxPercentage,
          taxAmountPaise: lineTaxPaise,
          lineTotalPaise,
          notes: item.notes || null
        });
      }

      // 3. Create GRN Header and Line Items
      const grn = await tx.goodsReceivedNote.create({
        data: {
          grnNumber,
          purchaseOrderId: input.purchaseOrderId || null,
          supplierId: input.supplierId,
          branchId: input.branchId,
          receivedBy: input.receivedBy,
          status: 'COMPLETED',
          notes: input.notes || null,
          items: {
            create: grnItemsData
          }
        },
        include: {
          items: true
        }
      });

      // 4. Update WAC, stock levels, and write ledger movements for accepted items
      for (const grnItem of grn.items) {
        if (grnItem.quantityAcceptedMilli > 0) {
          const product = await tx.product.findUnique({
            where: { id: grnItem.productId }
          });
          if (!product || product.isDeleted) {
            throw new Error(`Product ${grnItem.productId} not found or has been soft-deleted.`);
          }

          // A. Calculate Weighted Average Cost (WAC) before updating the stock quantity
          // Sum the product's current stock across all branches to get global current stock
          const globalStockRes = await tx.branchInventory.aggregate({
            _sum: { quantityMilli: true },
            where: { productId: grnItem.productId }
          });

          const currentQtyMilli = globalStockRes._sum.quantityMilli || 0;
          const currentCostPaise = product.costPricePaise;
          const receivedQtyMilli = grnItem.quantityAcceptedMilli;
          const purchaseCostPaise = grnItem.unitCostPaise;

          let newCostPaise = currentCostPaise;

          if (currentQtyMilli <= 0) {
            // Handle negative or zero stock gracefully: new cost is simply the purchase cost
            newCostPaise = purchaseCostPaise;
          } else {
            // WAC Formula: New Cost = [(Current Qty * Current Cost) + (Received Qty * Purchase Cost)] / (Current Qty + Received Qty)
            // Using BigInt calculations to prevent integer multiplications overflow
            const currentVal = BigInt(currentQtyMilli) * BigInt(currentCostPaise);
            const incomingVal = BigInt(receivedQtyMilli) * BigInt(purchaseCostPaise);
            const totalQty = BigInt(currentQtyMilli) + BigInt(receivedQtyMilli);
            
            newCostPaise = Number((currentVal + incomingVal) / totalQty);
          }

          // Save the recalculated WAC back to the Product catalog entry
          await tx.product.update({
            where: { id: grnItem.productId },
            data: { costPricePaise: newCostPaise }
          });

          // B. Live Inventory Update
          let inv = await tx.branchInventory.findUnique({
            where: {
              branchId_productId: {
                branchId: input.branchId,
                productId: grnItem.productId
              }
            }
          });

          if (!inv) {
            inv = await tx.branchInventory.create({
              data: {
                branchId: input.branchId,
                productId: grnItem.productId,
                quantityMilli: 0
              }
            });
          }

          await tx.branchInventory.update({
            where: { id: inv.id },
            data: {
              quantityMilli: inv.quantityMilli + grnItem.quantityAcceptedMilli
            }
          });

          // C. Log Stock Movement Audit Ledger
          await tx.stockMovement.create({
            data: {
              branchId: input.branchId,
              productId: grnItem.productId,
              type: 'PURCHASE',
              quantityMilli: grnItem.quantityAcceptedMilli,
              referenceType: 'GRN',
              referenceId: grn.id,
              notes: `Goods Received Note: ${grn.grnNumber}`
            }
          });
        }
      }

      // 5. Update Purchase Order Status transitions if linked
      if (input.purchaseOrderId) {
        const po = await tx.purchaseOrder.findUnique({
          where: { id: input.purchaseOrderId },
          include: {
            items: true,
            grns: {
              where: { status: 'COMPLETED' },
              include: { items: true }
            }
          }
        });

        if (po) {
          // Compute cumulative accepted quantities per product across all completed GRNs
          const acceptedQuantities: Record<string, number> = {};
          
          for (const associatedGrn of po.grns) {
            for (const associatedGrnItem of associatedGrn.items) {
              const prodId = associatedGrnItem.productId;
              acceptedQuantities[prodId] = (acceptedQuantities[prodId] || 0) + associatedGrnItem.quantityAcceptedMilli;
            }
          }

          // Compare PO quantities vs cumulative accepted quantities
          let allFulfilled = true;
          let anyFulfilled = false;

          for (const poItem of po.items) {
            const acceptedMilli = acceptedQuantities[poItem.productId] || 0;
            if (acceptedMilli < poItem.quantityOrderedMilli) {
              allFulfilled = false;
            }
            if (acceptedMilli > 0) {
              anyFulfilled = true;
            }
          }

          let newStatus: PurchaseOrderStatus = PurchaseOrderStatus.ORDERED;
          if (allFulfilled) {
            newStatus = PurchaseOrderStatus.FULLY_RECEIVED;
          } else if (anyFulfilled) {
            newStatus = PurchaseOrderStatus.PARTIALLY_RECEIVED;
          }

          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: { status: newStatus }
          });
        }
      }

      return grn;
    };

    if (typeof (prisma as any).$transaction === 'function') {
      return (prisma as any).$transaction(run);
    } else {
      return run(prisma);
    }
  }

  /**
   * Retrieves GRN records
   */
  public static async getGRNs(
    prisma: PrismaClient,
    filters?: { branchId?: string; supplierId?: string }
  ): Promise<GoodsReceivedNote[]> {
    return prisma.goodsReceivedNote.findMany({
      where: {
        ...(filters?.branchId && { branchId: filters.branchId }),
        ...(filters?.supplierId && { supplierId: filters.supplierId })
      },
      include: {
        supplier: true,
        branch: true,
        purchaseOrder: true,
        items: {
          include: {
            product: true
          }
        }
      },
      orderBy: { receivedDate: 'desc' }
    });
  }

  /**
   * Retrieves a single GRN details by ID
   */
  public static async getGRNById(prisma: PrismaClient, id: string): Promise<GoodsReceivedNote | null> {
    return prisma.goodsReceivedNote.findUnique({
      where: { id },
      include: {
        supplier: true,
        branch: true,
        purchaseOrder: true,
        items: {
          include: {
            product: true
          }
        }
      }
    });
  }
}
