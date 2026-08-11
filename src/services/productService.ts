import { PrismaClient, Product, SellingUnit } from '@prisma/client';
import { UnitNormalizer } from './unitNormalizer';

export interface CreateProductInput {
  sku: string;
  name: string;
  barcode?: string;
  categoryId?: string;
  brand?: string;
  profile?: string;
  size?: string;
  finish?: string;
  sellingPrice: number; // Input in Rupees (e.g. 1450.50 -> converted to 145050 paise)
  sellingUnit?: string; // e.g. "RFT", "PCS", "FT"
  sourceUnit?: string;
  weightPerPiece?: number; // Input in Kg decimal
  length?: number; // Input in Feet/Meters decimal
  minimumStock?: number; // Input in decimal
}

export class ProductService {
  public static async getAllProducts(prisma: PrismaClient, includeInactive = false): Promise<Product[]> {
    return prisma.product.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: { category: true },
      orderBy: { name: 'asc' }
    });
  }

  public static async getProductBySku(prisma: PrismaClient, sku: string): Promise<Product | null> {
    return prisma.product.findUnique({
      where: { sku: sku.trim() },
      include: { category: true }
    });
  }

  public static async createProduct(prisma: PrismaClient, input: CreateProductInput): Promise<Product> {
    const norm = UnitNormalizer.normalize(input.sellingUnit || input.sourceUnit);
    const pricePaise = UnitNormalizer.toPaise(input.sellingPrice);

    return prisma.product.create({
      data: {
        sku: input.sku.trim().toUpperCase(),
        name: input.name.trim(),
        barcode: input.barcode?.trim() || null,
        categoryId: input.categoryId || null,
        brand: input.brand?.trim() || null,
        profile: input.profile?.trim() || null,
        size: input.size?.trim() || null,
        finish: input.finish?.trim() || null,
        sellingPricePaise: pricePaise,
        sellingUnit: norm.sellingUnit,
        sourceUnit: norm.sourceUnit,
        weightPerPieceMilli: input.weightPerPiece ? UnitNormalizer.toMilliUnits(input.weightPerPiece) : null,
        lengthMilli: input.length ? UnitNormalizer.toMilliUnits(input.length) : null,
        minimumStockMilli: input.minimumStock ? UnitNormalizer.toMilliUnits(input.minimumStock) : 0,
        isActive: true
      }
    });
  }

  public static async updateProduct(
    prisma: PrismaClient,
    productId: string,
    input: Partial<CreateProductInput> & { isActive?: boolean }
  ): Promise<Product> {
    const norm = input.sellingUnit || input.sourceUnit
      ? UnitNormalizer.normalize(input.sellingUnit || input.sourceUnit)
      : null;

    return prisma.product.update({
      where: { id: productId },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.categoryId !== undefined && { categoryId: input.categoryId || null }),
        ...(input.barcode !== undefined && { barcode: input.barcode?.trim() || null }),
        ...(input.brand !== undefined && { brand: input.brand?.trim() || null }),
        ...(input.profile !== undefined && { profile: input.profile?.trim() || null }),
        ...(input.size !== undefined && { size: input.size?.trim() || null }),
        ...(input.finish !== undefined && { finish: input.finish?.trim() || null }),
        ...(input.sellingPrice !== undefined && { sellingPricePaise: UnitNormalizer.toPaise(input.sellingPrice) }),
        ...(norm && { sellingUnit: norm.sellingUnit, sourceUnit: norm.sourceUnit }),
        ...(input.minimumStock !== undefined && { minimumStockMilli: UnitNormalizer.toMilliUnits(input.minimumStock) }),
        ...(input.weightPerPiece !== undefined && { weightPerPieceMilli: UnitNormalizer.toMilliUnits(input.weightPerPiece) }),
        ...(input.length !== undefined && { lengthMilli: UnitNormalizer.toMilliUnits(input.length) }),
        ...(input.isActive !== undefined && { isActive: input.isActive })
      }
    });
  }

  public static async seedDefaultProducts(prisma: PrismaClient): Promise<number> {
    const count = await prisma.product.count();
    if (count > 0) return count;

    // Seed default hardware catalog with Integer Paise & Milli-units
    const defaultItems = [
      { sku: 'SEC-2TRK-12', name: 'Aluminium Sliding Window Track 2-Track 12ft', price: 1450.00, unit: 'RFT', barcode: '890100100001' },
      { sku: 'SEC-3TRK-12', name: 'Aluminium Sliding Window Track 3-Track 12ft', price: 1890.00, unit: 'RFT', barcode: '890100100002' },
      { sku: 'SEC-HW-SASH', name: 'Heavy Duty Window Sash Section 12ft', price: 1120.00, unit: 'FT', barcode: '890100100003' },
      { sku: 'SEC-ANG-1X1', name: 'Aluminium Equal Angle 1x1 inch 12ft', price: 680.00, unit: 'RFT', barcode: '890100100004' },
      { sku: 'SEC-PIPE-2X1', name: 'Aluminium Rectangular Tube 2x1 inch 12ft', price: 950.00, unit: 'FT', barcode: '890100100005' },
      { sku: 'HDW-BEAR-SS', name: 'Heavy Stainless Steel Bearing Roller for Sliding Track', price: 85.00, unit: 'PCS', barcode: '890100100006' },
      { sku: 'HDW-LOCK-SLD', name: 'Concealed Touch Lock Satin Finish', price: 240.00, unit: 'PCS', barcode: '890100100007' }
    ];

    for (const item of defaultItems) {
      const norm = UnitNormalizer.normalize(item.unit);
      await prisma.product.create({
        data: {
          sku: item.sku,
          name: item.name,
          sellingPricePaise: UnitNormalizer.toPaise(item.price),
          sellingUnit: norm.sellingUnit,
          sourceUnit: norm.sourceUnit,
          barcode: item.barcode,
          minimumStockMilli: UnitNormalizer.toMilliUnits(10),
          isActive: true
        }
      });
    }

    return defaultItems.length;
  }
}
