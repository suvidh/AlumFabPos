import { prisma } from './database';
import { DiscountType, MovementType, PaymentMode, SellingUnit } from '@prisma/client';

export interface CartItemDTO {
  productId: string;
  sku: string;
  name: string;
  profile?: string;
  finish?: string;
  alloy?: string;
  sellingUnit: SellingUnit;
  unitPricePaise: number;
  quantity: number;
  weightPerPiece?: number;
  gstRate: number;
}

export interface CheckoutDTO {
  branchId: string;
  customerId?: string;
  customerName?: string;
  customerAddress?: string;
  customerGstin?: string;
  customerState?: string;
  paymentMode: PaymentMode;
  chequeNumber?: string;
  discountType?: DiscountType;
  discountValue?: number;
  items: CartItemDTO[];
}

export class SalesService {
  /**
   * Execute Atomic Sales Transaction inside SQLite ACID Transaction
   */
  static async checkoutSale(dto: CheckoutDTO) {
    // 1. Mandatory Payment Validation
    if (dto.paymentMode === PaymentMode.CHEQUE) {
      if (!dto.chequeNumber || !dto.chequeNumber.trim()) {
        throw new Error('Cheque Number is mandatory when payment mode is CHEQUE.');
      }
    }

    if (!dto.items || dto.items.length === 0) {
      throw new Error('Cart cannot be empty.');
    }

    // Run SQLite Transaction
    return prisma.$transaction(async (tx) => {
      // A. Load Active Branch Details
      const branch = await tx.branch.findUnique({
        where: { id: dto.branchId }
      });
      if (!branch) throw new Error('Active Branch not found.');

      // B. Validate Zero Negative Stock at Active Branch
      for (const cartItem of dto.items) {
        const branchInv = await tx.branchInventory.findUnique({
          where: {
            branchId_productId: {
              branchId: dto.branchId,
              productId: cartItem.productId
            }
          }
        });

        const available = branchInv ? Number(branchInv.quantity) : 0;
        if (available < cartItem.quantity) {
          throw new Error(
            `Insufficient stock at active branch '${branch.name}' for item '${cartItem.name}'. Available: ${available}, Requested: ${cartItem.quantity}.`
          );
        }
      }

      // C. Get or Create Customer
      let customerId = dto.customerId;
      let custName = dto.customerName || 'Counter Retail Cash Sale';
      let custAddress = dto.customerAddress || branch.address || 'Local';
      let custGstin = dto.customerGstin || null;
      let custState = dto.customerState || branch.state || 'Gujarat';

      if (!customerId) {
        let cust = await tx.customer.findFirst({
          where: { name: custName }
        });
        if (!cust) {
          cust = await tx.customer.create({
            data: {
              name: custName,
              address: custAddress,
              gstin: custGstin,
              state: custState
            }
          });
        }
        customerId = cust.id;
      }

      // D. Generate Branch Invoice Number
      let seq = await tx.invoiceSequence.findUnique({
        where: {
          branchId_prefix: {
            branchId: dto.branchId,
            prefix: branch.invoicePrefix
          }
        }
      });

      if (!seq) {
        seq = await tx.invoiceSequence.create({
          data: {
            branchId: dto.branchId,
            prefix: branch.invoicePrefix,
            nextNumber: 1
          }
        });
      }

      const seqNumStr = seq.nextNumber.toString().padStart(6, '0');
      const invoiceNo = `${seq.prefix}${seqNumStr}`;

      // Increment sequence counter
      await tx.invoiceSequence.update({
        where: { id: seq.id },
        data: { nextNumber: seq.nextNumber + 1 }
      });

      // E. Financial & Integer Paise Math Calculations
      let rawSubtotalPaise = 0;
      let totalWeightKg = 0;

      const processedItems = dto.items.map((item) => {
        const lineGrossPaise = Math.round(item.unitPricePaise * item.quantity);
        const itemWeight = (item.weightPerPiece || 0) * item.quantity;
        
        rawSubtotalPaise += lineGrossPaise;
        totalWeightKg += itemWeight;

        // Inclusive Reverse GST Tax Split per line item
        const rate = item.gstRate || 18.0;
        const taxablePaise = Math.round(lineGrossPaise / (1 + rate / 100));
        const gstAmountPaise = lineGrossPaise - taxablePaise;

        // Intra-State vs Inter-State Tax Evaluation
        const isIntraState = !custState || !branch.state || custState.trim().toLowerCase() === branch.state.trim().toLowerCase();
        let cgstPaise = 0;
        let sgstPaise = 0;
        let igstPaise = 0;

        if (isIntraState) {
          cgstPaise = Math.round(gstAmountPaise / 2);
          sgstPaise = gstAmountPaise - cgstPaise;
        } else {
          igstPaise = gstAmountPaise;
        }

        return {
          productId: item.productId,
          productSkuSnapshot: item.sku,
          productNameSnapshot: item.name,
          profileSnapshot: item.profile || null,
          alloySnapshot: item.alloy || null,
          finishSnapshot: item.finish || null,
          sellingUnitSnapshot: item.sellingUnit,
          quantity: item.quantity,
          unitPricePaise: item.unitPricePaise,
          weightPerPieceSnapshot: item.weightPerPiece || 0,
          totalWeightKg: itemWeight,
          lineTotalPaise: lineGrossPaise,
          gstRateSnapshot: rate,
          taxableAmountPaise: taxablePaise,
          gstAmountPaise,
          cgstPaise,
          sgstPaise,
          igstPaise
        };
      });

      // Discount Calculations
      let discountAmountPaise = 0;
      const discountType = dto.discountType || DiscountType.NONE;
      const discountVal = dto.discountValue || 0;

      if (discountType === DiscountType.PERCENTAGE && discountVal > 0) {
        discountAmountPaise = Math.round((rawSubtotalPaise * discountVal) / 100);
      } else if (discountType === DiscountType.FIXED_AMOUNT && discountVal > 0) {
        discountAmountPaise = Math.round(discountVal * 100);
      }

      const grandTotalPaise = Math.max(0, rawSubtotalPaise - discountAmountPaise);

      // Re-calculate Total Tax Breakdown for Sale Header
      let totalTaxablePaise = 0;
      let totalCgstPaise = 0;
      let totalSgstPaise = 0;
      let totalIgstPaise = 0;

      processedItems.forEach((pi) => {
        totalTaxablePaise += pi.taxableAmountPaise;
        totalCgstPaise += pi.cgstPaise;
        totalSgstPaise += pi.sgstPaise;
        totalIgstPaise += pi.igstPaise;
      });

      // F. Create Sale Header with Immutable Historical Snapshots
      const sale = await tx.sale.create({
        data: {
          invoiceNo,
          branchId: dto.branchId,
          branchNameSnapshot: branch.name,
          branchAddressSnapshot: branch.address,
          branchGstinSnapshot: branch.gstin,
          branchPhoneSnapshot: branch.phone,
          branchStateSnapshot: branch.state,
          invoicePrefixSnapshot: branch.invoicePrefix,
          logoSnapshot: branch.logoPath,

          customerId,
          customerNameSnapshot: custName,
          customerAddressSnapshot: custAddress,
          customerGstinSnapshot: custGstin,
          customerStateSnapshot: custState,

          subtotalPaise: rawSubtotalPaise,
          discountType,
          discountValue: discountVal,
          discountAmountPaise,
          taxableAmountPaise: totalTaxablePaise,
          cgstPaise: totalCgstPaise,
          sgstPaise: totalSgstPaise,
          igstPaise: totalIgstPaise,
          grandTotalPaise,
          totalWeightKg,

          items: {
            create: processedItems
          },
          payment: {
            create: {
              mode: dto.paymentMode,
              chequeNumber: dto.chequeNumber || null,
              amountPaise: grandTotalPaise
            }
          }
        },
        include: {
          items: true,
          payment: true
        }
      });

      // G. Deduct Inventory Balances & Log Stock Movements per Branch
      for (const item of dto.items) {
        await tx.branchInventory.update({
          where: {
            branchId_productId: {
              branchId: dto.branchId,
              productId: item.productId
            }
          },
          data: {
            quantity: {
              decrement: item.quantity
            }
          }
        });

        await tx.stockMovement.create({
          data: {
            branchId: dto.branchId,
            productId: item.productId,
            type: MovementType.SALE,
            quantity: item.quantity,
            unit: item.sellingUnit,
            referenceNo: invoiceNo,
            notes: `Sale Checkout Invoice #${invoiceNo}`
          }
        });
      }

      return sale;
    });
  }
}
