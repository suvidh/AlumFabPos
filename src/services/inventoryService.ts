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

  /**
   * Fetch all inventories in a branch
   */
  public static async getBranchInventory(prisma: PrismaClient, branchId: string) {
    return prisma.branchInventory.findMany({
      where: {
        branchId,
        product: {
          isDeleted: false,
          isActive: true
        }
      },
      include: { product: true },
      orderBy: { product: { name: 'asc' } }
    });
  }

  /**
   * Check stock availability for a product at a specific branch
   */
  public static async checkStockAvailability(
    prisma: PrismaClient,
    branchId: string,
    productId: string
  ): Promise<{ availableQuantityDecimal: number; availableQuantityMilli: number }> {
    const inv = await prisma.branchInventory.findFirst({
      where: {
        branchId,
        productId,
        product: {
          isDeleted: false,
          isActive: true
        }
      }
    });

    const qtyMilli = inv ? inv.quantityMilli : 0;
    return {
      availableQuantityDecimal: UnitNormalizer.fromMilliUnits(qtyMilli),
      availableQuantityMilli: qtyMilli
    };
  }

  /**
   * Transactional Stock Adjustment Primitive (Relative adjustment)
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

      if (!inv || inv.product.isDeleted) {
        const prod = await tx.product.findFirst({ where: { id: productId, isDeleted: false } });
        if (!prod) throw new Error(`Product ${productId} not found or deleted.`);

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
          quantityMilli: magnitudeMilli, // Stored as positive magnitude
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

  /**
   * Update/Adjust stock based on a physical audit count (Absolute adjustment)
   * Logs reasons like 'Damaged', 'Audit Variance', 'Initial Stock'
   */
  public static async manualStockAdjustment(
    prisma: PrismaClient,
    branchId: string,
    productId: string,
    physicalQuantityDecimal: number,
    reason: 'Damaged' | 'Audit Variance' | 'Initial Stock' | string,
    notes?: string
  ): Promise<{ inventory: BranchInventory; movement: StockMovement | null }> {
    const run = async (tx: any) => {
      const product = await tx.product.findFirst({
        where: { id: productId, isDeleted: false }
      });
      if (!product) {
        throw new Error(`Product ${productId} not found or has been soft-deleted.`);
      }

      let inv = await tx.branchInventory.findUnique({
        where: {
          branchId_productId: { branchId, productId }
        }
      });

      if (!inv) {
        inv = await tx.branchInventory.create({
          data: {
            branchId,
            productId,
            quantityMilli: 0
          }
        });
      }

      const targetQtyMilli = UnitNormalizer.toMilliUnits(physicalQuantityDecimal);
      if (targetQtyMilli < 0) {
        throw new Error(`Manual adjustments cannot result in negative stock: ${physicalQuantityDecimal}`);
      }

      const deltaMilli = targetQtyMilli - inv.quantityMilli;
      if (deltaMilli === 0) {
        return { inventory: inv, movement: null };
      }

      // Update branch inventory
      const updatedInv = await tx.branchInventory.update({
        where: { id: inv.id },
        data: { quantityMilli: targetQtyMilli }
      });

      const isDeduction = deltaMilli < 0;
      const type = isDeduction ? StockMovementType.ADJUSTMENT_OUT : StockMovementType.ADJUSTMENT_IN;

      // Log stock movement audit entry
      const movement = await tx.stockMovement.create({
        data: {
          branchId,
          productId,
          type,
          quantityMilli: Math.abs(deltaMilli),
          referenceType: 'MANUAL_AUDIT',
          referenceId: reason,
          notes: notes || `Manual stock audit adjustment reason: ${reason}`
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

  /**
   * Inter-Branch Transfer (IBT) workflow: moves stock between two branches atomically
   */
  public static async transferStock(
    prisma: PrismaClient,
    fromBranchId: string,
    toBranchId: string,
    productId: string,
    quantityDecimal: number,
    notes?: string
  ): Promise<{ fromInventory: BranchInventory; toInventory: BranchInventory }> {
    if (fromBranchId === toBranchId) {
      throw new Error("Source and destination branches cannot be the same.");
    }

    const transferQtyMilli = UnitNormalizer.toMilliUnits(quantityDecimal);
    if (transferQtyMilli <= 0) {
      throw new Error("Transfer quantity must be greater than zero.");
    }

    const run = async (tx: any) => {
      const product = await tx.product.findFirst({
        where: { id: productId, isDeleted: false }
      });
      if (!product) {
        throw new Error(`Product ${productId} not found or deleted.`);
      }

      // 1. Fetch and assert stock at source branch
      const fromInv = await tx.branchInventory.findUnique({
        where: {
          branchId_productId: { branchId: fromBranchId, productId }
        }
      });

      const fromStockMilli = fromInv ? fromInv.quantityMilli : 0;
      this.assertSufficientStock(fromStockMilli, transferQtyMilli, product.name);

      // 2. Fetch or create destination stock record
      let toInv = await tx.branchInventory.findUnique({
        where: {
          branchId_productId: { branchId: toBranchId, productId }
        }
      });

      if (!toInv) {
        toInv = await tx.branchInventory.create({
          data: {
            branchId: toBranchId,
            productId,
            quantityMilli: 0
          }
        });
      }

      // 3. Atomically update inventories
      const updatedFromInv = await tx.branchInventory.update({
        where: { id: fromInv!.id },
        data: {
          quantityMilli: fromInv!.quantityMilli - transferQtyMilli
        }
      });

      const updatedToInv = await tx.branchInventory.update({
        where: { id: toInv.id },
        data: {
          quantityMilli: toInv.quantityMilli + transferQtyMilli
        }
      });

      // 4. Create outbound stock movement
      await tx.stockMovement.create({
        data: {
          branchId: fromBranchId,
          productId,
          type: StockMovementType.ADJUSTMENT_OUT,
          quantityMilli: transferQtyMilli,
          referenceType: 'IBT',
          referenceId: toBranchId,
          notes: notes || `Inter-Branch Transfer: Outbound to branch ${toBranchId}`
        }
      });

      // 5. Create inbound stock movement
      await tx.stockMovement.create({
        data: {
          branchId: toBranchId,
          productId,
          type: StockMovementType.ADJUSTMENT_IN,
          quantityMilli: transferQtyMilli,
          referenceType: 'IBT',
          referenceId: fromBranchId,
          notes: notes || `Inter-Branch Transfer: Inbound from branch ${fromBranchId}`
        }
      });

      return { fromInventory: updatedFromInv, toInventory: updatedToInv };
    };

    if (typeof (prisma as any).$transaction === 'function') {
      return (prisma as any).$transaction(run);
    } else {
      return run(prisma);
    }
  }

  /**
   * Optimized raw SQLite query to retrieve all products at a specific branch where stock <= reorder level
   */
  public static async getLowStockAlerts(prisma: PrismaClient, branchId: string) {
    // Run optimized SQLite query directly comparing columns
    const results = await prisma.$queryRaw<any[]>`
      SELECT 
        bi.id,
        bi.branchId,
        bi.productId,
        bi.quantityMilli,
        bi.reorderThresholdMilli,
        p.name AS productName,
        p.sku AS productSku,
        COALESCE(bi.reorderThresholdMilli, p.minimumStockMilli) AS computedThreshold
      FROM BranchInventory bi
      JOIN Product p ON bi.productId = p.id
      WHERE bi.branchId = ${branchId}
        AND p.isDeleted = 0
        AND p.isActive = 1
        AND bi.quantityMilli <= COALESCE(bi.reorderThresholdMilli, p.minimumStockMilli)
    `;

    // Map rows to clean client presentation schema
    return results.map(row => ({
      id: row.id,
      branchId: row.branchId,
      productId: row.productId,
      currentStockDecimal: UnitNormalizer.fromMilliUnits(Number(row.quantityMilli)),
      reorderThresholdDecimal: UnitNormalizer.fromMilliUnits(Number(row.computedThreshold)),
      product: {
        sku: row.productSku,
        name: row.productName
      }
    }));
  }

  public static async getStockMovements(prisma: PrismaClient, branchId?: string): Promise<StockMovement[]> {
    return prisma.stockMovement.findMany({
      where: branchId ? { branchId } : {},
      include: { product: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  public static async seedDefaultBranchInventory(prisma: PrismaClient, branchId: string): Promise<number> {
    const products = await prisma.product.findMany({ where: { isDeleted: false, isActive: true } });
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
