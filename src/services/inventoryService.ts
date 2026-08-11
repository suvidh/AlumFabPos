import { PrismaClient, BranchInventory, StockMovement, StockMovementType } from '@prisma/client';
import { UnitNormalizer } from './unitNormalizer';

export class InventoryService {
  /**
   * Reusable Stock Validation Primitive
   * Throws domain error if available stock is insufficient for deduction
   */
  public static assertSufficientStock(currentQuantityMilli: number, requestedQuantityMilli: number, productName: string = 'Item'): void {
    if (currentQuantityMilli - requestedQuantityMilli < 0) {
      const availDec = UnitNormalizer.fromMilliUnits(currentQuantityMilli);
      const reqDec = UnitNormalizer.fromMilliUnits(requestedQuantityMilli);
      throw new Error(`Insufficient stock for '${productName}'. Available: ${availDec}, Requested: ${reqDec}. Negative stock balance prohibited.`);
    }
  }

  public static async getBranchInventory(prisma: PrismaClient, branchId: string) {
    return prisma.branchInventory.findMany({
      where: { branchId },
      include: { product: true },
      orderBy: { product: { name: 'asc' } }
    });
  }

  /**
   * Transactional Stock Adjustment Primitive
   */
  public static async adjustStock(
    prisma: PrismaClient,
    branchId: string,
    productId: string,
    deltaQuantityDecimal: number,
    type: StockMovementType,
    notes?: string,
    referenceId?: string
  ): Promise<{ inventory: BranchInventory; movement: StockMovement }> {
    const magnitudeMilli = Math.abs(UnitNormalizer.toMilliUnits(deltaQuantityDecimal));
    const isDeduction = type === StockMovementType.SALE || type === StockMovementType.ADJUSTMENT_OUT;

    const run = async (tx: any) => {
      let inv = await tx.branchInventory.findUnique({
        where: {
          branchId_productId: { branchId, productId }
        },
        include: { product: true }
      });

      if (!inv) {
        const prod = await tx.product.findUnique({ where: { id: productId } });
        if (!prod) throw new Error(`Product ${productId} not found`);

        inv = await tx.branchInventory.create({
          data: {
            branchId,
            productId,
            quantityMilli: 0
          },
          include: { product: true }
        });
      }

      if (isDeduction) {
        this.assertSufficientStock(inv.quantityMilli, magnitudeMilli, inv.product.name);
      }

      const newQuantityMilli = isDeduction
        ? inv.quantityMilli - magnitudeMilli
        : inv.quantityMilli + magnitudeMilli;

      const updatedInv = await tx.branchInventory.update({
        where: { id: inv.id },
        data: { quantityMilli: newQuantityMilli }
      });

      const movement = await tx.stockMovement.create({
        data: {
          branchId,
          productId,
          type,
          quantityMilli: magnitudeMilli, // Stored as positive magnitude per Section 23
          referenceType: isDeduction ? 'OUTBOUND' : 'INBOUND',
          referenceId,
          notes: notes || `Stock movement: ${type}`
        }
      });

      return { inventory: updatedInv, movement };
    };

    if (typeof (prisma as any).$transaction === 'function') {
      return (prisma as any).$transaction(run);
    } else {
      return run(prisma);
    }
  }

  public static async getStockMovements(prisma: PrismaClient, branchId?: string): Promise<StockMovement[]> {
    return prisma.stockMovement.findMany({
      where: branchId ? { branchId } : {},
      include: { product: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  public static async seedDefaultBranchInventory(prisma: PrismaClient, branchId: string): Promise<number> {
    const products = await prisma.product.findMany({ where: { isActive: true } });
    let count = 0;
    const defaultMilli = UnitNormalizer.toMilliUnits(150); // 150.000 units initial stock

    for (const product of products) {
      const existing = await prisma.branchInventory.findUnique({
        where: { branchId_productId: { branchId, productId: product.id } }
      });

      if (!existing) {
        await prisma.branchInventory.create({
          data: {
            branchId,
            productId: product.id,
            quantityMilli: defaultMilli
          }
        });

        await prisma.stockMovement.create({
          data: {
            branchId,
            productId: product.id,
            type: StockMovementType.OPENING_STOCK,
            quantityMilli: defaultMilli,
            referenceType: 'BOOTSTRAP',
            notes: 'Initial branch stock bootstrap'
          }
        });

        count++;
      }
    }

    return count;
  }
}
