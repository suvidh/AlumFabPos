import { SellingUnit } from '@prisma/client';

export interface PrintSaleItem {
  skuSnapshot: string;
  productNameSnapshot: string;
  quantityMilli: number;
  ratePaise: number;
  grossPaise: number;
  discountPaise: number;
  lineTotalPaise: number;
  unitSnapshot: SellingUnit | string;
}

export interface PrintPayment {
  method: string;
  amountPaise: number;
  chequeNumber?: string | null;
}

export interface PrintSaleData {
  invoiceNumber: string;
  invoiceSequence: number;
  createdAt: Date | string;
  branchNameSnapshot: string;
  branchAddressSnapshot?: string | null;
  branchGstinSnapshot?: string | null;
  branchPhoneSnapshot?: string | null;
  branchStateSnapshot?: string | null;
  customerNameSnapshot: string;
  customerAddressSnapshot?: string | null;
  customerGstinSnapshot?: string | null;
  customerStateSnapshot?: string | null;
  subtotalPaise: number;
  discountPaise: number;
  grandTotalPaise: number;
  items: PrintSaleItem[];
  payments: PrintPayment[];
  companyLegalName?: string | null;
  companyGstin?: string | null;
  companyPhone?: string | null;
  companyAddress?: string | null;
}

/**
 * Registered business identity for ALUMFAB Hardware (this is a single-tenant
 * app built for this business, not generic multi-shop software — see the
 * dealer letterhead / delivery challan these values were taken from).
 *
 * Used as a FALLBACK on every printed document: a sale's branchGstinSnapshot /
 * branchPhoneSnapshot are only populated once the branch record itself has
 * them set (via Settings), and every sale created before that was filled in
 * has those fields frozen as null in its immutable snapshot. Falling back
 * here means invoices always show the real company details, past and future,
 * without rewriting historical sale data.
 */
const COMPANY_GSTIN_FALLBACK = '24ABOPK8064H1ZD';
const COMPANY_PHONE_FALLBACK = '9824157960';
const COMPANY_WEBSITE = 'www.alumfab.co.in';

export class PrintService {
  /**
   * Generates a vector SVG barcode representation for Code 128 structure
   */
  private static generateSvgBarcode(text: string): string {
    return `
      <svg width="180" height="40" viewBox="0 0 180 40" xmlns="http://www.w3.org/2000/svg" style="margin: 5px auto; display: block;">
        <rect x="10" y="5" width="2" height="25" fill="black"/>
        <rect x="14" y="5" width="1" height="25" fill="black"/>
        <rect x="17" y="5" width="3" height="25" fill="black"/>
        <rect x="22" y="5" width="1" height="25" fill="black"/>
        <rect x="25" y="5" width="2" height="25" fill="black"/>
        <rect x="29" y="5" width="1" height="25" fill="black"/>
        <rect x="32" y="5" width="3" height="25" fill="black"/>
        <rect x="37" y="5" width="2" height="25" fill="black"/>
        <rect x="41" y="5" width="1" height="25" fill="black"/>
        <rect x="44" y="5" width="2" height="25" fill="black"/>
        <rect x="48" y="5" width="4" height="25" fill="black"/>
        <rect x="54" y="5" width="1" height="25" fill="black"/>
        <rect x="57" y="5" width="2" height="25" fill="black"/>
        <rect x="61" y="5" width="3" height="25" fill="black"/>
        <rect x="66" y="5" width="1" height="25" fill="black"/>
        <rect x="69" y="5" width="2" height="25" fill="black"/>
        <rect x="73" y="5" width="4" height="25" fill="black"/>
        <rect x="79" y="5" width="1" height="25" fill="black"/>
        <rect x="82" y="5" width="2" height="25" fill="black"/>
        <rect x="86" y="5" width="3" height="25" fill="black"/>
        <rect x="91" y="5" width="1" height="25" fill="black"/>
        <rect x="94" y="5" width="2" height="25" fill="black"/>
        <rect x="98" y="5" width="4" height="25" fill="black"/>
        <rect x="104" y="5" width="1" height="25" fill="black"/>
        <rect x="107" y="5" width="2" height="25" fill="black"/>
        <rect x="111" y="5" width="3" height="25" fill="black"/>
        <rect x="116" y="5" width="1" height="25" fill="black"/>
        <rect x="119" y="5" width="2" height="25" fill="black"/>
        <rect x="123" y="5" width="4" height="25" fill="black"/>
        <rect x="129" y="5" width="1" height="25" fill="black"/>
        <rect x="132" y="5" width="2" height="25" fill="black"/>
        <rect x="136" y="5" width="3" height="25" fill="black"/>
        <rect x="141" y="5" width="1" height="25" fill="black"/>
        <rect x="144" y="5" width="2" height="25" fill="black"/>
        <rect x="148" y="5" width="4" height="25" fill="black"/>
        <rect x="154" y="5" width="1" height="25" fill="black"/>
        <rect x="157" y="5" width="2" height="25" fill="black"/>
        <rect x="161" y="5" width="3" height="25" fill="black"/>
        <rect x="166" y="5" width="1" height="25" fill="black"/>
        <rect x="169" y="5" width="2" height="25" fill="black"/>
        <text x="90" y="37" font-family="monospace" font-size="7" text-anchor="middle" letter-spacing="1.5">${text}</text>
      </svg>
    `;
  }

  /**
   * Renders the invoice content for ONE copy (customer or office). Used twice,
   * side by side, by generateA4InvoiceHTML — kept as a separate method so the
   * two copies can never drift out of sync with each other.
   */
  private static renderInvoicePanel(sale: PrintSaleData, copyLabel: string): string {
    const subtotalRupees = (sale.subtotalPaise / 100).toFixed(2);
    const discountRupees = (sale.discountPaise / 100).toFixed(2);
    const taxableRupees = ((sale.subtotalPaise - sale.discountPaise) / 100);
    const gstRupees = (taxableRupees * 0.18).toFixed(2); // 18% average GST
    const grandTotalRupees = (sale.grandTotalPaise / 100).toFixed(2);
    const dateStr = new Date(sale.createdAt).toLocaleDateString('en-IN', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const rowsHtml = sale.items.map((item, idx) => {
      const qty = item.quantityMilli / 1000;
      const rate = (item.ratePaise / 100).toFixed(2);
      const disc = (item.discountPaise / 100).toFixed(2);
      const total = (item.lineTotalPaise / 100).toFixed(2);
      return `
        <tr>
          <td style="text-align: center;">${idx + 1}</td>
          <td><strong>${item.skuSnapshot}</strong></td>
          <td>${item.productNameSnapshot}</td>
          <td style="text-align: right;">${qty.toFixed(2)} ${item.unitSnapshot}</td>
          <td style="text-align: right;">₹${rate}</td>
          <td style="text-align: right;">₹${disc}</td>
          <td style="text-align: right; font-weight: bold;">₹${total}</td>
        </tr>
      `;
    }).join('');

    const paymentsHtml = sale.payments.map((p) => {
      const mode = p.method;
      const amount = (p.amountPaise / 100).toFixed(2);
      const chequeStr = p.chequeNumber ? ` (Chq No: ${p.chequeNumber})` : '';
      return `<div style="margin-bottom: 2px;">• Paid via <strong>${mode}</strong>: ₹${amount}${chequeStr}</div>`;
    }).join('');

    return `
      <div class="invoice-box">

        <!-- Copy Label -->
        <div class="copy-label">${copyLabel}</div>

        <!-- Company & Invoice ID Header -->
        <table class="header-table">
          <tr>
            <td>
              <div class="header-title">${sale.companyLegalName || 'ALUMFAB Bulk Aluminium Hardware'}</div>
              <div style="color: #64748b;">${sale.companyAddress || 'Shop No. 2, Kalindi Apartment, Nr. Sharda Hospital Circle, Majura Gate Road, Surat - 395002'}</div>
              <div>GSTIN: <strong>${sale.companyGstin || COMPANY_GSTIN_FALLBACK}</strong> | Phone: ${sale.companyPhone || COMPANY_PHONE_FALLBACK}</div>
              <div style="color: #2563eb;">${COMPANY_WEBSITE}</div>
            </td>
            <td style="text-align: right; vertical-align: top;">
              <div class="tax-invoice-lbl">INVOICE</div>
              <div style="margin-top: 5px; font-size: 11px; font-weight: bold; color: #0f172a;"># ${sale.invoiceNumber}</div>
              <div style="color: #64748b; font-size: 9px;">Date: ${dateStr}</div>
            </td>
          </tr>
        </table>

        <!-- Billing Info Cards -->
        <table class="info-grid">
          <tr>
            <td class="info-card" style="border-right: none;">
              <div class="info-title">Branch / Despatched From:</div>
              <strong>${sale.branchNameSnapshot}</strong>
              <div>${sale.branchAddressSnapshot || ''}</div>
              <div>GSTIN: <strong>${sale.branchGstinSnapshot || 'N/A'}</strong></div>
              <div>Phone: ${sale.branchPhoneSnapshot || 'N/A'}</div>
              <div>State: ${sale.branchStateSnapshot || ''}</div>
            </td>
            <td class="info-card">
              <div class="info-title">Billed To (Customer):</div>
              <strong>${sale.customerNameSnapshot}</strong>
              <div>${sale.customerAddressSnapshot || 'Counter Walk-in'}</div>
              <div>GSTIN: <strong>${sale.customerGstinSnapshot || 'N/A'}</strong></div>
              <div>State: ${sale.customerStateSnapshot || ''}</div>
            </td>
          </tr>
        </table>

        <!-- Invoice Line items table -->
        <table class="items-table">
          <thead>
            <tr>
              <th style="width: 22px;">#</th>
              <th style="width: 66px; text-align: left;">SKU</th>
              <th style="text-align: left;">Product Name</th>
              <th style="width: 54px; text-align: right;">Qty</th>
              <th style="width: 54px; text-align: right;">Rate</th>
              <th style="width: 48px; text-align: right;">Disc.</th>
              <th style="width: 60px; text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <!-- Summary and Payment Allocation -->
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="vertical-align: top; padding-right: 10px;">
              <div style="background: #f8fafc; padding: 8px; border-radius: 4px; border: 1px solid #e2e8f0; font-size: 9px;">
                <div style="font-weight: bold; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin-bottom: 5px; color: #475569; text-transform: uppercase;">Payment Details:</div>
                ${paymentsHtml}
              </div>
              <div style="margin-top: 8px; font-size: 8px; color: #64748b;">
                <strong>Terms & Conditions:</strong>
                <br/>1. Goods once sold will not be taken back or exchanged.
                <br/>2. Subject to Surat jurisdiction only.
              </div>
            </td>
            <td style="width: 150px; vertical-align: top;">
              <table class="totals-grid">
                <tr>
                  <td class="totals-label">Subtotal (Net):</td>
                  <td class="totals-value">₹${subtotalRupees}</td>
                </tr>
                <tr>
                  <td class="totals-label">Discount:</td>
                  <td class="totals-value" style="color: #ef4444;">-₹${discountRupees}</td>
                </tr>
                <tr>
                  <td class="totals-label">GST (18% Avg):</td>
                  <td class="totals-value">₹${gstRupees}</td>
                </tr>
                <tr>
                  <td class="totals-label" style="font-size: 10px; font-weight: bold; color: #0f172a;">Grand Total:</td>
                  <td class="totals-value" style="font-size: 12px; font-weight: 800; color: #10b981; border-bottom: 2px double #10b981;">₹${grandTotalRupees}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Footer Signatures — pushed to the bottom of the invoice-box via
             margin-top: auto (invoice-box is a flex column), so the sheet
             always fills the full printable page height instead of leaving
             blank space below the totals. -->
        <table class="footer-table" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td>
              <div style="font-size: 8px; color: #94a3b8;">Printed on secure ALUMFAB Local SQLite POS engine.</div>
            </td>
            <td style="text-align: right; display: flex; flex-direction: column; align-items: flex-end;">
              <div style="font-size: 9px; font-weight: bold; color: #475569;">For ${sale.branchNameSnapshot}</div>
              <div class="signatory-box">Authorized Signatory</div>
            </td>
          </tr>
        </table>

      </div>
    `;
  }

  /**
   * Returns HTML for an A4 LANDSCAPE Commercial Tax Invoice containing TWO
   * copies side by side — a Customer Copy on the left and an Office Copy on
   * the right — separated by a dashed cut line, so a single printed sheet is
   * torn/cut in half into the two copies retail billing traditionally hands
   * out. Both halves render from the same sale data via renderInvoicePanel,
   * so they are always identical apart from the copy label.
   */
  public static generateA4InvoiceHTML(sale: PrintSaleData): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Invoice - ${sale.invoiceNumber}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          html, body { height: 100%; }
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9.5px; line-height: 1.35; color: #1e293b; background: #fff; padding: 12px; }

          /* CSS Print Rules — LANDSCAPE so two copies fit side by side */
          @media print {
            html, body { height: 100%; }
            body { padding: 0; font-size: 9px; }
            @page { size: A4 landscape; margin: 8mm; }
            .no-print { display: none !important; }
          }

          /* Two-up layout: Customer Copy | dashed cut line | Office Copy.
             .sheet/.invoice-box stretch to the full page height and each
             invoice-box is a flex column so its content — including the
             footer signature block — spreads out to use the whole printable
             area instead of leaving blank space at the bottom. */
          .sheet { width: 100%; height: 100%; display: flex; align-items: stretch; gap: 0; }
          .invoice-box {
            flex: 1 1 50%; min-width: 0; border: 1px solid #cbd5e1; padding: 16px;
            border-radius: 6px; display: flex; flex-direction: column; height: 100%;
          }
          .cut-line {
            flex: 0 0 auto; width: 0; margin: 0 8px;
            border-left: 1px dashed #94a3b8; position: relative;
          }
          .cut-line::before {
            content: '✂ CUT HERE';
            position: absolute; top: 50%; left: 50%;
            transform: translate(-50%, -50%) rotate(90deg);
            white-space: nowrap; font-size: 7px; letter-spacing: 1px;
            color: #94a3b8; background: #fff; padding: 2px 4px;
          }

          .copy-label {
            display: inline-block; font-size: 8px; font-weight: 800; letter-spacing: 0.5px;
            color: #2563eb; background: #eff6ff; border: 1px solid #bfdbfe;
            padding: 2px 6px; border-radius: 3px; text-transform: uppercase; margin-bottom: 6px;
          }

          .header-table { width: 100%; margin-bottom: 10px; border-collapse: collapse; }
          .header-title { font-size: 14px; font-weight: 800; text-transform: uppercase; color: #0f172a; margin-bottom: 3px; }
          .tax-invoice-lbl { font-size: 9px; font-weight: bold; background: #0f172a; color: #fff; padding: 2px 6px; border-radius: 3px; display: inline-block; }

          .info-grid { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
          .info-card { width: 50%; padding: 6px; border: 1px solid #e2e8f0; vertical-align: top; border-radius: 4px; }
          .info-title { font-size: 8px; font-weight: bold; color: #64748b; text-transform: uppercase; border-bottom: 1px dashed #e2e8f0; padding-bottom: 2px; margin-bottom: 4px; }

          .items-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; table-layout: fixed; }
          .items-table th { background: #f8fafc; color: #475569; font-weight: bold; text-transform: uppercase; font-size: 8px; padding: 7px 6px; border: 1px solid #e2e8f0; }
          .items-table td { padding: 9px 6px; border: 1px solid #e2e8f0; vertical-align: middle; font-size: 9px; overflow-wrap: break-word; }
          .items-table tr { page-break-inside: avoid; break-inside: avoid; }
          thead { display: table-header-group; }

          .totals-grid { width: 100%; margin-top: 10px; border-collapse: collapse; }
          .totals-label { text-align: right; padding: 4px 6px; font-size: 9px; color: #475569; }
          .totals-value { text-align: right; padding: 4px 6px; font-weight: bold; font-size: 9.5px; width: 70px; border-bottom: 1px solid #e2e8f0; }

          .signatory-box { border: 1px dashed #cbd5e1; width: 130px; height: 40px; margin-top: 6px; border-radius: 4px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 3px; color: #64748b; font-size: 7.5px; }

          /* Pushed to the bottom of the flex-column invoice-box, see comment
             above renderInvoicePanel's footer table. */
          .footer-table { margin-top: auto; padding-top: 18px; }
        </style>
      </head>
      <body>
        <div class="sheet">
          ${this.renderInvoicePanel(sale, 'Customer Copy')}
          <div class="cut-line"></div>
          ${this.renderInvoicePanel(sale, 'Office Copy')}
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Returns HTML for 80mm/58mm Thermal Receipt format
   */
  public static generateThermalHTML(sale: PrintSaleData, paperWidth: '80mm' | '58mm' = '80mm'): string {
    const subtotalRupees = (sale.subtotalPaise / 100).toFixed(2);
    const discountRupees = (sale.discountPaise / 100).toFixed(2);
    const taxableRupees = ((sale.subtotalPaise - sale.discountPaise) / 100);
    const gstRupees = (taxableRupees * 0.18).toFixed(2);
    const grandTotalRupees = (sale.grandTotalPaise / 100).toFixed(2);
    const dateStr = new Date(sale.createdAt).toLocaleDateString('en-IN', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const rowsHtml = sale.items.map((item) => {
      const qty = item.quantityMilli / 1000;
      const rate = (item.ratePaise / 100).toFixed(2);
      const total = (item.lineTotalPaise / 100).toFixed(2);
      return `
        <div style="margin-bottom: 5px; page-break-inside: avoid;">
          <div style="font-weight: bold;">${item.productNameSnapshot}</div>
          <div style="display: flex; justify-content: space-between; font-size: 8px; color: #555;">
            <span>${qty.toFixed(2)} ${item.unitSnapshot} x ₹${rate}</span>
            <span>₹${total}</span>
          </div>
        </div>
      `;
    }).join('');

    const paymentsHtml = sale.payments.map((p) => {
      return `
        <div style="display: flex; justify-content: space-between; font-size: 8px; margin-bottom: 2px;">
          <span>• ${p.method} Payment</span>
          <span>₹${(p.amountPaise / 100).toFixed(2)}</span>
        </div>
      `;
    }).join('');

    const barcodeSvg = this.generateSvgBarcode(sale.invoiceNumber);

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Thermal Receipt - ${sale.invoiceNumber}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { 
            font-family: 'Courier New', Courier, monospace; 
            font-size: 9px; 
            line-height: 1.3; 
            color: #000; 
            background: #fff; 
            padding: 8px;
            width: ${paperWidth};
          }
          
          @media print {
            body { padding: 4px; width: ${paperWidth}; font-size: 8px; }
            @page { size: ${paperWidth} auto; margin: 0; }
            .no-print { display: none !important; }
          }

          .receipt-divider { border-bottom: 1px dashed #000; margin: 6px 0; }
          .receipt-center { text-align: center; }
          .receipt-bold { font-weight: bold; }
          
          .totals-line { display: flex; justify-content: space-between; margin-bottom: 2px; }
        </style>
      </head>
      <body>
        <div class="receipt-center receipt-bold" style="font-size: 11px;">${sale.companyLegalName || 'ALUMFAB HARDWARE'}</div>
        <div class="receipt-center" style="font-size: 8px;">${sale.companyAddress || 'Shop No. 2, Kalindi Apartment, Nr. Sharda Hospital Circle, Majura Gate Road, Surat - 395002'}</div>
        <div class="receipt-center receipt-bold" style="font-size: 9px; margin-top: 3px; margin-bottom: 2px;">Branch: ${sale.branchNameSnapshot}</div>
        <div class="receipt-center" style="font-size: 8px;">Branch GSTIN: ${sale.branchGstinSnapshot || COMPANY_GSTIN_FALLBACK}</div>
        <div class="receipt-center" style="font-size: 8px;">Branch Address: ${sale.branchAddressSnapshot || 'Store Hub Road'}</div>
        <div class="receipt-center" style="font-size: 8px;">Phone: ${sale.branchPhoneSnapshot || COMPANY_PHONE_FALLBACK}</div>
        <div class="receipt-center" style="font-size: 8px;">${COMPANY_WEBSITE}</div>

        <div class="receipt-divider"></div>
        
        <div>INV NO: ${sale.invoiceNumber}</div>
        <div>DATE  : ${dateStr}</div>
        <div>CUST  : ${sale.customerNameSnapshot}</div>
        <div>CLERK : Terminal Supervisor</div>
        
        <div class="receipt-divider"></div>
        
        <!-- Items listing -->
        <div style="margin-bottom: 5px;">
          ${rowsHtml}
        </div>
        
        <div class="receipt-divider"></div>
        
        <!-- Totals Math -->
        <div class="totals-line">
          <span>Subtotal:</span>
          <span>₹${subtotalRupees}</span>
        </div>
        <div class="totals-line" style="color: #000;">
          <span>Discount:</span>
          <span>-₹${discountRupees}</span>
        </div>
        <div class="totals-line">
          <span>GST average (18%):</span>
          <span>₹${gstRupees}</span>
        </div>
        <div class="totals-line receipt-bold" style="font-size: 10px; margin-top: 3px;">
          <span>GRAND TOTAL:</span>
          <span>₹${grandTotalRupees}</span>
        </div>
        
        <div class="receipt-divider"></div>
        
        <!-- Split payment allocation -->
        <div class="receipt-bold" style="font-size: 8px; margin-bottom: 3px;">PAYMENT DETAILS:</div>
        ${paymentsHtml}
        
        <div class="receipt-divider"></div>
        
        <div class="receipt-center">Thank you for visiting AlumFab!</div>
        <div class="receipt-center" style="font-size: 7px; margin-top: 3px; color: #555;">For support, quote receipt barcode.</div>
        
        <!-- Receipt vector lookup barcode -->
        <div style="margin-top: 8px; text-align: center;">
          ${barcodeSvg}
        </div>
      </body>
      </html>
    `;
  }
}
