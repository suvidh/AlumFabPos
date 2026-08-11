import { prisma } from './database';
import { SellingUnit } from '@prisma/client';

export class ProductService {
  /**
   * List all active products with stock balance for active branch
   */
  static async getProductsForBranch(branchId: string, search?: string) {
    const whereCondition: any = { isActive: true };
    if (search && search.trim()) {
      const q = search.trim();
      whereCondition.OR = [
        { name: { contains: q } },
        { sku: { contains: q } },
        { barcode: { contains: q } }
      ];
    }

    const products = await prisma.product.findMany({
      where: whereCondition,
      include: {
        branchInventories: {
          where: { branchId }
        }
      },
      orderBy: { name: 'asc' }
    });

    return products.map((p) => {
      const branchInv = p.branchInventories[0];
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        profile: p.profile,
        finish: p.finish,
        alloy: p.alloy,
        sellingUnit: p.sellingUnit,
        sellingPricePaise: p.sellingPricePaise,
        sellingPriceRupees: p.sellingPricePaise / 100,
        gstRate: p.gstRate ? Number(p.gstRate) : 18.0,
        weightPerPiece: p.weightPerPiece ? Number(p.weightPerPiece) : 0.0,
        availableStock: branchInv ? Number(branchInv.quantity) : 0.0,
        barcode: p.barcode
      };
    });
  }

  /**
   * Soft-deactivate product (isActive = false)
   */
  static async deactivateProduct(productId: string) {
    return prisma.product.update({
      where: { id: productId },
      data: { isActive: false }
    });
  }

  /**
   * Dry-run validation of raw dataset rows
   */
  static validateDatasetRows(rows: any[]) {
    let validCount = 0;
    let warningCount = 0;
    let errorCount = 0;
    const items: any[] = [];
    const seenSkus = new Set<string>();

    rows.forEach((row, index) => {
      const rowNum = index + 1;
      const name = row.HardwareName || row.name || '';
      const sku = row.ProductCode || row.sku || '';
      const rawPrice = row.Price ?? row.price;
      const rawUnit = (row.Per || row.unit || 'PCS').toString().toUpperCase();
      const barcode = row.Barcode || row.barcode || '';

      const errors: string[] = [];
      const warnings: string[] = [];

      if (!name.trim()) errors.push('Product Name is missing');
      if (!sku.trim()) errors.push('Product Code / SKU is missing');
      
      if (sku && seenSkus.has(sku)) {
        errors.push(`Duplicate SKU '${sku}' in dataset`);
      } else if (sku) {
        seenSkus.add(sku);
      }

      let pricePaise = 0;
      if (rawPrice === undefined || rawPrice === null || isNaN(Number(rawPrice))) {
        errors.push('Invalid price value');
      } else {
        const numPrice = Number(rawPrice);
        if (numPrice < 0) errors.push('Negative price is forbidden');
        else if (numPrice === 0) warnings.push('Zero price item');
        pricePaise = Math.round(numPrice * 100);
      }

      // Unit Normalization
      let normalizedUnit: SellingUnit = SellingUnit.PCS;
      let sourceUnit = rawUnit;
      if (rawUnit === 'KG' || rawUnit === 'KGS') normalizedUnit = SellingUnit.KG;
      else if (rawUnit === 'PCS') normalizedUnit = SellingUnit.PCS;
      else if (rawUnit === 'FT' || rawUnit === 'FEET') normalizedUnit = SellingUnit.FT;
      else if (rawUnit === 'RFT') {
        normalizedUnit = SellingUnit.FT; // Running Feet mapped to FT
        warnings.push("Source unit 'RFT' normalized to 'FT'");
      } else if (rawUnit === 'METER' || rawUnit === 'M') normalizedUnit = SellingUnit.METER;
      else if (rawUnit === 'LENGTH') normalizedUnit = SellingUnit.LENGTH;
      else if (rawUnit === 'SET') normalizedUnit = SellingUnit.SET;

      if (errors.length > 0) errorCount++;
      else if (warnings.length > 0) {
        warningCount++;
        validCount++;
      } else {
        validCount++;
      }

      items.push({
        rowNum,
        name,
        sku,
        pricePaise,
        priceRupees: pricePaise / 100,
        sellingUnit: normalizedUnit,
        sourceUnit,
        barcode,
        errors,
        warnings,
        isValid: errors.length === 0
      });
    });

    return {
      totalRows: rows.length,
      validCount,
      warningCount,
      errorCount,
      items
    };
  }
}
