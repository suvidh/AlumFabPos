import { PrismaClient, PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus } from '@prisma/client';
import { UnitNormalizer } from './unitNormalizer';

export interface CreatePurchaseOrderInput {
  branchId: string;
  supplierId: string;
  notes?: string;
  expectedDeliveryDate?: Date | string;
  items: {
    productId: string;
    quantityDecimal: number;
    unitCostRupees: number;
    taxPercentage: number; // e.g. 18 for 18%
  }[];
}

export class PurchaseOrderService {
  /**
   * Helper to generate a unique PO Number in format: PO-YYYYMMDD-XXXX where XXXX is a sequence number
   */
  private static async generatePONumber(prisma: PrismaClient): Promise<string> {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;

    // Find the count of POs created today to get the next index
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    const count = await prisma.purchaseOrder.count({
      where: {
        createdAt: {
          gte: startOfDay,
          lte: endOfDay
        }
      }
    });

    const nextSeq = String(count + 1).padStart(4, '0');
    return `PO-${dateStr}-${nextSeq}`;
  }

  /**
   * Creates a Purchase Order atomically along with its line items
   */
  public static async createPurchaseOrder(prisma: PrismaClient, input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
    const poNumber = await this.generatePONumber(prisma);

    const run = async (tx: any) => {
      let subtotalPaise = 0;
      let taxAmountPaise = 0;
      let totalAmountPaise = 0;
      const orderItemsData = [];

      for (const item of input.items) {
        const qtyMilli = UnitNormalizer.toMilliUnits(item.quantityDecimal);
        const costPaise = UnitNormalizer.toPaise(item.unitCostRupees);
        
        // Calculate subtotal for line: quantity * cost (converted from milli units)
        const lineSubtotalPaise = Math.round((costPaise * qtyMilli) / 1000);
        // Calculate tax for line: subtotal * taxPercentage / 100
        const lineTaxPaise = Math.round(lineSubtotalPaise * (item.taxPercentage / 100));
        const lineTotalPaise = lineSubtotalPaise + lineTaxPaise;

        subtotalPaise += lineSubtotalPaise;
        taxAmountPaise += lineTaxPaise;
        totalAmountPaise += lineTotalPaise;

        orderItemsData.push({
          productId: item.productId,
          quantityOrderedMilli: qtyMilli,
          unitCostPaise: costPaise,
          taxPercentage: item.taxPercentage,
          taxAmountPaise: lineTaxPaise,
          lineTotalPaise: lineTotalPaise
        });
      }

      return tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId: input.supplierId,
          branchId: input.branchId,
          expectedDeliveryDate: input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : null,
          status: 'DRAFT',
          subtotalPaise,
          taxAmountPaise,
          totalAmountPaise,
          notes: input.notes || null,
          isDeleted: false,
          items: {
            create: orderItemsData
          }
        },
        include: {
          items: true
        }
      });
    };

    if (typeof (prisma as any).$transaction === 'function') {
      return (prisma as any).$transaction(run);
    } else {
      return run(prisma);
    }
  }

  /**
   * Retrieves all non-deleted Purchase Orders, with optional filtering by branch and status
   */
  public static async getPurchaseOrders(
    prisma: PrismaClient,
    filters?: { branchId?: string; status?: PurchaseOrderStatus }
  ): Promise<PurchaseOrder[]> {
    return prisma.purchaseOrder.findMany({
      where: {
        isDeleted: false,
        ...(filters?.branchId && { branchId: filters.branchId }),
        ...(filters?.status && { status: filters.status })
      },
      include: {
        supplier: true,
        branch: true,
        items: {
          include: {
            product: true
          }
        }
      },
      orderBy: { orderDate: 'desc' }
    });
  }

  /**
   * Retrieves a single Purchase Order by ID
   */
  public static async getPurchaseOrderById(prisma: PrismaClient, id: string): Promise<PurchaseOrder | null> {
    return prisma.purchaseOrder.findFirst({
      where: { id, isDeleted: false },
      include: {
        supplier: true,
        branch: true,
        items: {
          include: {
            product: true
          }
        },
        grns: {
          include: {
            items: true
          }
        }
      }
    });
  }

  /**
   * Updates the status of a Purchase Order
   */
  public static async updateOrderStatus(
    prisma: PrismaClient,
    id: string,
    status: PurchaseOrderStatus
  ): Promise<PurchaseOrder> {
    return prisma.purchaseOrder.update({
      where: { id },
      data: { status }
    });
  }

  /**
   * Soft deletes a Purchase Order
   */
  public static async deletePurchaseOrder(prisma: PrismaClient, id: string): Promise<PurchaseOrder> {
    return prisma.purchaseOrder.update({
      where: { id },
      data: { isDeleted: true }
    });
  }
}
