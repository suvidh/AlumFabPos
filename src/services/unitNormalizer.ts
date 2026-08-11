import { SellingUnit } from '@prisma/client';

export interface NormalizedUnitResult {
  sellingUnit: SellingUnit;
  sourceUnit: string;
}

export class UnitNormalizer {
  public static normalize(rawUnit?: string | null): NormalizedUnitResult {
    const source = (rawUnit || 'PCS').trim();
    const upper = source.toUpperCase();

    let sellingUnit: SellingUnit = SellingUnit.PCS;

    if (upper === 'PCS' || upper === 'PC' || upper === 'PIECE' || upper === 'PIECES') {
      sellingUnit = SellingUnit.PCS;
    } else if (upper === 'RFT' || upper === 'RUNNING FEET') {
      sellingUnit = SellingUnit.RFT; // Preserve RFT per Phase 2 Section 7 specification
    } else if (upper === 'FT' || upper === 'FEET' || upper === 'FOOT') {
      sellingUnit = SellingUnit.FT;
    } else if (upper === 'M' || upper === 'MTR' || upper === 'METER' || upper === 'METERS') {
      sellingUnit = SellingUnit.METER;
    } else if (upper === 'KG' || upper === 'KGS' || upper === 'KILOGRAM') {
      sellingUnit = SellingUnit.KG;
    } else if (upper === 'LENGTH' || upper === 'LEN') {
      sellingUnit = SellingUnit.LENGTH;
    } else if (upper === 'SET' || upper === 'SETS') {
      sellingUnit = SellingUnit.SET;
    } else {
      sellingUnit = SellingUnit.PCS; // Default fallback
    }

    return {
      sellingUnit,
      sourceUnit: source
    };
  }

  /**
   * Conversion helpers between decimal units and integer milli-units (1 unit = 1000 milli-units)
   */
  public static toMilliUnits(decimalQuantity: number): number {
    return Math.round(decimalQuantity * 1000);
  }

  public static fromMilliUnits(milliUnits: number): number {
    return milliUnits / 1000;
  }

  /**
   * Conversion helpers between Rupees float/string and integer Paise (₹1 = 100 paise)
   */
  public static toPaise(rupeesAmount: number): number {
    return Math.round(rupeesAmount * 100);
  }

  public static fromPaise(paiseAmount: number): number {
    return paiseAmount / 100;
  }
}
