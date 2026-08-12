export interface ScannedBarcodeResult {
  type: 'STANDARD' | 'WEIGHT_SCALE';
  barcode: string;
  itemCode: string;
  weightDecimal?: number; // Weight in kg (if type is WEIGHT_SCALE)
  isValid: boolean;
  error?: string;
}

export class BarcodeService {
  /**
   * Validates standard EAN-13 check digit
   */
  public static validateEan13Checksum(barcode: string): boolean {
    if (!/^\d{13}$/.test(barcode)) {
      return false;
    }

    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const digit = parseInt(barcode.charAt(i), 10);
      // EAN-13 check digit formula:
      // Weight odd positions (0, 2, 4...) with 1, even positions (1, 3, 5...) with 3
      sum += digit * (i % 2 === 0 ? 1 : 3);
    }

    const calculatedCheckDigit = (10 - (sum % 10)) % 10;
    const actualCheckDigit = parseInt(barcode.charAt(12), 10);

    return calculatedCheckDigit === actualCheckDigit;
  }

  /**
   * Parses the barcode to check if it's standard or embedded-weight scale (EAN-13 starting with 20-29)
   */
  public static parseBarcode(barcode: string): ScannedBarcodeResult {
    const trimmedBarcode = barcode.trim();

    if (!trimmedBarcode) {
      return {
        type: 'STANDARD',
        barcode: '',
        itemCode: '',
        isValid: false,
        error: 'Empty barcode string.'
      };
    }

    // Check if it fits the EAN-13 Embedded-Weight format (13 digits, starting with 20-29)
    if (/^\d{13}$/.test(trimmedBarcode) && /^(2[0-9])/.test(trimmedBarcode)) {
      const isValidChecksum = this.validateEan13Checksum(trimmedBarcode);
      
      const prefix = trimmedBarcode.substring(0, 2);
      const itemCode = trimmedBarcode.substring(2, 7); // 5 digits for item code
      const weightBlock = trimmedBarcode.substring(7, 12); // 5 digits for weight/price

      // Scale weight is in grams (e.g. 02500 = 2500g = 2.500kg)
      const weightGrams = parseInt(weightBlock, 10);
      const weightDecimal = isNaN(weightGrams) ? 0 : weightGrams / 1000;

      return {
        type: 'WEIGHT_SCALE',
        barcode: trimmedBarcode,
        itemCode: prefix + '-' + itemCode, // e.g. "21-00045"
        weightDecimal,
        isValid: isValidChecksum,
        ...(!isValidChecksum && { error: 'EAN-13 checksum validation failed for weight-scale barcode.' })
      };
    }

    // Default fallback to standard scan (UPC, Code 128, QR, etc.)
    // If it is 13 digits but doesn't start with 20-29, we still run standard EAN checksum validation
    let isValid = true;
    let error: string | undefined;

    if (/^\d{13}$/.test(trimmedBarcode)) {
      isValid = this.validateEan13Checksum(trimmedBarcode);
      if (!isValid) {
        error = 'EAN-13 checksum validation failed.';
      }
    } else if (/^\d{12}$/.test(trimmedBarcode)) {
      // UPC-A (12 digits) can be padded to EAN-13 or validated. We accept it as valid standard.
      isValid = true;
    }

    return {
      type: 'STANDARD',
      barcode: trimmedBarcode,
      itemCode: trimmedBarcode,
      isValid,
      ...(error && { error })
    };
  }
}
