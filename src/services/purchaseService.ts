import { PrismaClient, Purchase, PurchaseItem } from '@prisma/client';
import { UnitNormalizer } from './unitNormalizer';

export interface CreatePurchaseInput {
  branchId: string;
  supplierId?: string;
  referenceNumber?: string;
  notes?: string;
  items: {
    productId: string;
    quantityDecimal: number;
    rateRupees: number;
  }[];
}

export class PurchaseService {
  /**
   * Create Purchase, PurchaseItems, increase BranchInventory, and write StockMovements atomically.
   */
  public static async createPurchase(prisma: PrismaClient, input: CreatePurchaseInput): Promise<Purchase> {
    const run = async (tx: any) => {
      let totalPaise = 0;
      const purchaseItemsData = [];

      for (const item of input.items) {
        const qtyMilli = UnitNormalizer.toMilliUnits(item.quantityDecimal);
        const ratePaise = UnitNormalizer.toPaise(item.rateRupees);
        const lineTotalPaise = Math.round((ratePaise * qtyMilli) / 1000);
        totalPaise += lineTotalPaise;

        purchaseItemsData.push({
          productId: item.productId,
          quantityMilli: qtyMilli,
          ratePaise,
          lineTotalPaise
        });
      }

      // 1. Create Purchase & Items
      const purchase = await tx.purchase.create({
        data: {
          branchId: input.branchId,
          supplierId: input.supplierId || null,
          referenceNumber: input.referenceNumber || null,
          totalPaise,
          notes: input.notes || null,
          items: {
            create: purchaseItemsData
          }
        },
        include: {
          items: true
        }
      });

      // 2. Adjust inventories & create stock movements for each item
      for (const item of purchase.items) {
        // Find existing branch inventory or create one
        let inv = await tx.branchInventory.findUnique({
          where: {
            branchId_productId: {
              branchId: input.branchId,
              productId: item.productId
            }
          }
        });

        if (!inv) {
          inv = await tx.branchInventory.create({
            data: {
              branchId: input.branchId,
              productId: item.productId,
              quantityMilli: 0
            }
          });
        }

        const newQtyMilli = inv.quantityMilli + item.quantityMilli;

        // Update branch inventory
        await tx.branchInventory.update({
          where: { id: inv.id },
          data: { quantityMilli: newQtyMilli }
        });

        // Create stock movement ledger entry
        await tx.stockMovement.create({
          data: {
            branchId: input.branchId,
            productId: item.productId,
            type: 'PURCHASE',
            quantityMilli: item.quantityMilli,
            referenceType: 'PURCHASE',
            referenceId: purchase.id,
            notes: `Purchase Ref: ${input.referenceNumber || purchase.id}`.trim()
          }
        });
      }

      return purchase;
    };

    if (typeof (prisma as any).$transaction === 'function') {
      return (prisma as any).$transaction(run);
    } else {
      return run(prisma);
    }
  }

  public static async getAllPurchases(prisma: PrismaClient, branchId?: string): Promise<Purchase[]> {
    return prisma.purchase.findMany({
      where: branchId ? { branchId } : {},
      include: {
        supplier: true,
        items: {
          include: {
            product: true
          }
        }
      },
      orderBy: { date: 'desc' }
    });
  }
}
