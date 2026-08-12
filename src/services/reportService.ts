import { PrismaClient, PaymentMethod, SaleStatus, CashShift } from '@prisma/client';
import { UnitNormalizer } from './unitNormalizer';

export interface CloseShiftInput {
  shiftId: string;
  actualCashRupees: number;
  notes?: string;
}

export interface DateRangeFilters {
  startDateStr: string; // YYYY-MM-DD
  endDateStr: string;   // YYYY-MM-DD
}

export class ReportService {
  /**
   * Helper to parse date strings into strict boundaries to prevent midnight dropouts
   */
  public static getDateBounds(dateStr: string, isEnd: boolean = false): Date {
    if (isEnd) {
      return new Date(`${dateStr}T23:59:59.999Z`);
    }
    return new Date(`${dateStr}T00:00:00.000Z`);
  }

  /**
   * Opens a new cash register shift
   */
  public static async openShift(
    prisma: PrismaClient,
    branchId: string,
    cashierId: string,
    startingFloatRupees: number
  ): Promise<CashShift> {
    // Ensure no open shifts exist for this branch/cashier to lock session integrity
    const existing = await prisma.cashShift.findFirst({
      where: { branchId, cashierId, status: 'OPEN' }
    });
    if (existing) {
      throw new Error(`An open cash shift already exists for Cashier ${cashierId} at this branch.`);
    }

    return prisma.cashShift.create({
      data: {
        branchId,
        cashierId,
        startingFloatPaise: UnitNormalizer.toPaise(startingFloatRupees),
        status: 'OPEN'
      }
    });
  }

  /**
   * Retrieves the active open shift for a branch & cashier
   */
  public static async getOpenShift(
    prisma: PrismaClient,
    branchId: string,
    cashierId: string
  ): Promise<CashShift | null> {
    return prisma.cashShift.findFirst({
      where: { branchId, cashierId, status: 'OPEN' }
    });
  }

  /**
   * Closes a shift, calculates expected totals/variances, and locks further modifications
   */
  public static async closeShift(
    prisma: PrismaClient,
    input: CloseShiftInput
  ): Promise<CashShift> {
    return prisma.$transaction(async (tx) => {
      const shift = await tx.cashShift.findUnique({
        where: { id: input.shiftId },
        include: { sales: { include: { payments: true, returns: true } } }
      });

      if (!shift) throw new Error(`Cash shift ${input.shiftId} not found.`);
      if (shift.status === 'CLOSED') {
        throw new Error('Shift is already closed.');
      }

      let cashSalesPaise = 0;
      let cardSalesPaise = 0;
      let upiSalesPaise = 0;
      let creditSalesPaise = 0;
      let chequeSalesPaise = 0;
      let totalSalesPaise = 0;
      let refundsPaise = 0;

      // Filter active non-void sales linked to this shift
      const activeSales = shift.sales.filter(s => s.status !== SaleStatus.VOID);

      for (const sale of activeSales) {
        totalSalesPaise += sale.grandTotalPaise;

        // Sum payment methods
        for (const payment of sale.payments) {
          if (payment.method === PaymentMethod.CASH) cashSalesPaise += payment.amountPaise;
          else if (payment.method === PaymentMethod.CARD) cardSalesPaise += payment.amountPaise;
          else if (payment.method === PaymentMethod.UPI) upiSalesPaise += payment.amountPaise;
          else if (payment.method === PaymentMethod.CREDIT) creditSalesPaise += payment.amountPaise;
          else if (payment.method === PaymentMethod.CHEQUE) chequeSalesPaise += payment.amountPaise;
        }

        // Sum cash refunds from returns
        for (const ret of sale.returns) {
          refundsPaise += ret.refundAmountPaise;
        }
      }

      // Expected Cash in Drawer = Float + Cash Sales - Cash Refunds
      const expectedCashPaise = shift.startingFloatPaise + cashSalesPaise - refundsPaise;
      const actualCashPaise = UnitNormalizer.toPaise(input.actualCashRupees);
      const variancePaise = actualCashPaise - expectedCashPaise;

      // Update and lock the shift
      return tx.cashShift.update({
        where: { id: shift.id },
        data: {
          closedAt: new Date(),
          expectedCashPaise,
          actualCashPaise,
          variancePaise,
          totalSalesPaise,
          cashSalesPaise,
          cardSalesPaise,
          upiSalesPaise,
          creditSalesPaise,
          chequeSalesPaise,
          refundsPaise,
          notes: input.notes || null,
          status: 'CLOSED'
        }
      });
    });
  }

  /**
   * Generates Daily/Monthly gross sales, net sales, discounts, and tax totals
   */
  public static async getSalesSummary(
    prisma: PrismaClient,
    branchId: string,
    filters: DateRangeFilters
  ) {
    const start = this.getDateBounds(filters.startDateStr);
    const end = this.getDateBounds(filters.endDateStr, true);

    const sales = await prisma.sale.findMany({
      where: {
        branchId,
        status: { not: SaleStatus.VOID },
        createdAt: { gte: start, lte: end }
      },
      include: { items: true }
    });

    let grossSalesPaise = 0;
    let discountPaise = 0;
    let netSalesPaise = 0;
    let taxCollectedPaise = 0;

    for (const sale of sales) {
      grossSalesPaise += sale.subtotalPaise;
      discountPaise += sale.discountPaise;
      netSalesPaise += (sale.subtotalPaise - sale.discountPaise);
      
      // Calculate 18% GST portion of net sales (tax is inclusive in selling rates)
      const saleNet = sale.subtotalPaise - sale.discountPaise;
      const tax = Math.round(saleNet - (saleNet / 1.18));
      taxCollectedPaise += tax;
    }

    return {
      grossSales: grossSalesPaise / 100,
      discounts: discountPaise / 100,
      netSales: netSalesPaise / 100,
      taxesCollected: taxCollectedPaise / 100,
      salesCount: sales.length
    };
  }

  /**
   * Financial GST/VAT liability groupings by tax rates
   */
  public static async getTaxLiabilityReport(
    prisma: PrismaClient,
    branchId: string,
    filters: DateRangeFilters
  ) {
    const start = this.getDateBounds(filters.startDateStr);
    const end = this.getDateBounds(filters.endDateStr, true);

    const items = await prisma.saleItem.findMany({
      where: {
        sale: {
          branchId,
          status: { not: SaleStatus.VOID },
          createdAt: { gte: start, lte: end }
        }
      },
      include: { product: true }
    });

    // Group items by product tax percentage
    const taxGroup: { [rate: number]: { taxableAmountPaise: number; taxAmountPaise: number } } = {};

    for (const item of items) {
      const rate = item.product?.taxPercentage || 18.0; // default 18% average
      if (!taxGroup[rate]) {
        taxGroup[rate] = { taxableAmountPaise: 0, taxAmountPaise: 0 };
      }

      // Rates are GST-inclusive, extract components
      const total = item.lineTotalPaise;
      const divisor = 1 + (rate / 100);
      const taxable = Math.round(total / divisor);
      const tax = total - taxable;

      taxGroup[rate].taxableAmountPaise += taxable;
      taxGroup[rate].taxAmountPaise += tax;
    }

    return Object.keys(taxGroup).map(rateStr => {
      const rate = parseFloat(rateStr);
      return {
        taxRate: rate,
        taxableAmount: taxGroup[rate].taxableAmountPaise / 100,
        taxAmount: taxGroup[rate].taxAmountPaise / 100,
        totalAmount: (taxGroup[rate].taxableAmountPaise + taxGroup[rate].taxAmountPaise) / 100
      };
    });
  }

  /**
   * Top-Selling Products by quantity and revenue
   */
  public static async getTopSellingProducts(
    prisma: PrismaClient,
    branchId: string,
    limit: number = 10
  ) {
    const groupResult = await prisma.saleItem.groupBy({
      by: ['productId', 'productNameSnapshot'],
      where: {
        sale: {
          branchId,
          status: { not: SaleStatus.VOID }
        }
      },
      _sum: {
        quantityMilli: true,
        lineTotalPaise: true
      },
      orderBy: {
        _sum: {
          quantityMilli: 'desc'
        }
      },
      take: limit
    });

    return groupResult.map(res => ({
      productId: res.productId,
      productName: res.productNameSnapshot,
      totalQuantity: (res._sum.quantityMilli || 0) / 1000,
      totalRevenue: (res._sum.lineTotalPaise || 0) / 100
    }));
  }

  /**
   * Profit Margin Analysis based on product CostPrice vs Selling rate
   */
  public static async getProfitMarginAnalysis(
    prisma: PrismaClient,
    branchId: string,
    filters: DateRangeFilters
  ) {
    const start = this.getDateBounds(filters.startDateStr);
    const end = this.getDateBounds(filters.endDateStr, true);

    const items = await prisma.saleItem.findMany({
      where: {
        sale: {
          branchId,
          status: { not: SaleStatus.VOID },
          createdAt: { gte: start, lte: end }
        }
      },
      include: { product: true }
    });

    let totalRevenuePaise = 0;
    let totalCogsPaise = 0;

    for (const item of items) {
      totalRevenuePaise += item.lineTotalPaise;
      
      const cost = item.product?.costPricePaise || 0;
      const itemCogs = Math.round((cost * item.quantityMilli) / 1000);
      totalCogsPaise += itemCogs;
    }

    const profitPaise = totalRevenuePaise - totalCogsPaise;
    const marginPercent = totalRevenuePaise > 0 ? (profitPaise / totalRevenuePaise) * 100 : 0.0;

    return {
      revenue: totalRevenuePaise / 100,
      cogs: totalCogsPaise / 100,
      grossProfit: profitPaise / 100,
      profitMarginPercent: parseFloat(marginPercent.toFixed(2))
    };
  }
}
