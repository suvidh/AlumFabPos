import React, { useState, useEffect } from 'react';
import { Sale, Payment, SaleItem } from '@prisma/client';
import { FileText, RefreshCw, Eye, Download, Printer, X } from 'lucide-react';
import { UnitNormalizer } from '../../services/unitNormalizer';
import { PrintService, PrintSaleData } from '../../services/printService';
import { usePOSConfigStore, AppConfigState } from '../context/POSConfigStore';

type SaleWithDetails = Sale & { items: SaleItem[]; payments: Payment[] };

/**
 * Maps the Prisma `Sale` (with items/payments included, as returned by
 * `getAllSales`) onto the `PrintSaleData` shape `PrintService` expects.
 * Kept local to this page rather than in printService.ts so that service stays
 * free of Prisma-specific types and usable from anywhere.
 */
function toPrintSaleData(sale: SaleWithDetails, company?: AppConfigState['company']): PrintSaleData {
  return {
    invoiceNumber: sale.invoiceNumber,
    invoiceSequence: sale.invoiceSequence,
    createdAt: sale.createdAt,
    branchNameSnapshot: sale.branchNameSnapshot,
    branchAddressSnapshot: sale.branchAddressSnapshot,
    branchGstinSnapshot: sale.branchGstinSnapshot,
    branchPhoneSnapshot: sale.branchPhoneSnapshot,
    branchStateSnapshot: sale.branchStateSnapshot,
    customerNameSnapshot: sale.customerNameSnapshot,
    customerAddressSnapshot: sale.customerAddressSnapshot,
    customerGstinSnapshot: sale.customerGstinSnapshot,
    customerStateSnapshot: sale.customerStateSnapshot,
    subtotalPaise: sale.subtotalPaise,
    discountPaise: sale.discountPaise,
    grandTotalPaise: sale.grandTotalPaise,
    items: sale.items.map((item) => ({
      skuSnapshot: item.skuSnapshot ?? '',
      productNameSnapshot: item.productNameSnapshot,
      quantityMilli: item.quantityMilli,
      ratePaise: item.ratePaise,
      grossPaise: item.grossPaise,
      discountPaise: item.discountPaise,
      lineTotalPaise: item.lineTotalPaise,
      unitSnapshot: item.unitSnapshot
    })),
    payments: sale.payments.map((p) => ({
      method: p.method,
      amountPaise: p.amountPaise,
      chequeNumber: p.chequeNumber
    })),
    companyLegalName: company?.legalName || null,
    companyGstin: company?.centralGstin || null,
    companyPhone: company?.phone || null,
    companyAddress: company?.registeredAddress || null
  };
}

export const SalesPage: React.FC = () => {
  const { company } = usePOSConfigStore();
  const [sales, setSales] = useState<SaleWithDetails[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Invoice preview modal
  const [previewSale, setPreviewSale] = useState<SaleWithDetails | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchSales = async () => {
    setLoading(true);
    if (window.alumfab) {
      try {
        const list = await window.alumfab.getAllSales();
        setSales(list as unknown as SaleWithDetails[]);
      } catch (e) {
        console.error('Failed fetching sales history:', e);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSales();
  }, []);

  const handleViewInvoice = (sale: SaleWithDetails) => {
    setActionError(null);
    try {
      const html = PrintService.generateA4InvoiceHTML(toPrintSaleData(sale, company));
      setPreviewHtml(html);
      setPreviewSale(sale);
    } catch (e: any) {
      console.error('Failed rendering invoice preview:', e);
      setActionError(`Could not render invoice ${sale.invoiceNumber}: ${e.message || 'Unknown error'}`);
    }
  };

  const closePreview = () => {
    setPreviewSale(null);
    setPreviewHtml('');
  };

  const handleDownloadInvoice = async (sale: SaleWithDetails) => {
    if (!window.alumfab) return;
    setActionError(null);
    setDownloadingId(sale.id);
    try {
      const html = PrintService.generateA4InvoiceHTML(toPrintSaleData(sale, company));
      const result = await window.alumfab.downloadInvoicePdf(html, `${sale.invoiceNumber}.pdf`);
      if (!result.success && !result.canceled) {
        setActionError(result.error || `Could not save invoice ${sale.invoiceNumber}.`);
      }
    } catch (e: any) {
      console.error('Failed downloading invoice:', e);
      setActionError(`Could not save invoice ${sale.invoiceNumber}: ${e.message || 'Unknown error'}`);
    }
    setDownloadingId(null);
  };

  const handlePrintInvoice = async (sale: SaleWithDetails) => {
    setActionError(null);
    setPrintingId(sale.id);
    try {
      const html = PrintService.generateA4InvoiceHTML(toPrintSaleData(sale, company));
      if (window.alumfab) {
        const ok = await window.alumfab.printSilent(html);
        if (!ok) {
          // Electron print dialog was likely cancelled by the user, or we're
          // running in remote/browser mode where printSilent always resolves
          // false — fall back to the browser's own print flow either way.
          printViaBrowser(html);
        }
      } else {
        printViaBrowser(html);
      }
    } catch (e: any) {
      console.error('Failed printing invoice:', e);
      setActionError(`Could not print invoice ${sale.invoiceNumber}: ${e.message || 'Unknown error'}`);
    }
    setPrintingId(null);
  };

  // Fallback for non-Electron (browser/remote) sessions: open the invoice
  // HTML in a hidden print frame and trigger the native print dialog.
  const printViaBrowser = (html: string) => {
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = 'none';
    document.body.appendChild(printFrame);
    const cleanup = () => {
      setTimeout(() => document.body.removeChild(printFrame), 500);
    };
    printFrame.onload = () => {
      try {
        printFrame.contentWindow?.focus();
        printFrame.contentWindow?.print();
      } finally {
        cleanup();
      }
    };
    printFrame.srcdoc = html;
  };

  const iconButtonStyle: React.CSSProperties = {
    backgroundColor: '#334155',
    border: 'none',
    borderRadius: '6px',
    padding: '0.4rem',
    cursor: 'pointer',
    color: '#f8fafc',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header Banner */}
      <div style={{
        backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px',
        padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ backgroundColor: '#2563eb', padding: '0.5rem', borderRadius: '8px', color: 'white' }}>
            <FileText style={{ width: 20, height: 20 }} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Sales History & Invoices
            </h2>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Phase 2 Domain Engine — Integer Paise & Immutable Snapshots
            </span>
          </div>
        </div>

        <button
          onClick={fetchSales}
          style={{
            backgroundColor: '#334155', color: '#f8fafc', border: 'none', borderRadius: '6px',
            padding: '0.5rem 0.9rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
          }}
        >
          <RefreshCw style={{ width: 14, height: 14 }} /> Refresh Sales History
        </button>
      </div>

      {actionError && (
        <div style={{
          backgroundColor: '#450a0a', border: '1px solid #7f1d1d', borderRadius: '8px',
          padding: '0.85rem 1.1rem', color: '#fca5a5', fontSize: '0.85rem'
        }}>
          {actionError}
        </div>
      )}

      {/* Sales Table */}
      <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#0f172a', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: '0.85rem 1rem' }}>Invoice Number</th>
              <th style={{ padding: '0.85rem 1rem' }}>Snapshot Branch</th>
              <th style={{ padding: '0.85rem 1rem' }}>Snapshot Customer</th>
              <th style={{ padding: '0.85rem 1rem' }}>Grand Total (₹)</th>
              <th style={{ padding: '0.85rem 1rem' }}>Payment Method</th>
              <th style={{ padding: '0.85rem 1rem' }}>Date & Time</th>
              <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Invoice</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => {
              const totalRupees = UnitNormalizer.fromPaise(s.grandTotalPaise);
              const paymentMethod = s.payments && s.payments.length > 0 ? s.payments[0].method : 'CASH';
              const isDownloading = downloadingId === s.id;
              const isPrinting = printingId === s.id;
              return (
                <tr key={s.id} style={{ borderBottom: '1px solid #334155', color: '#f8fafc' }}>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontWeight: 700, color: '#60a5fa' }}>{s.invoiceNumber}</td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 500 }}>{s.branchNameSnapshot}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1' }}>{s.customerNameSnapshot}</td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: '#4ade80' }}>₹{totalRupees.toFixed(2)}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{ backgroundColor: '#334155', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                      {paymentMethod}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: '#94a3b8', fontSize: '0.8rem' }}>
                    {new Date(s.createdAt).toLocaleString()}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                      <button
                        title={`View invoice ${s.invoiceNumber}`}
                        onClick={() => handleViewInvoice(s)}
                        style={iconButtonStyle}
                      >
                        <Eye style={{ width: 15, height: 15 }} />
                      </button>
                      <button
                        title={`Download invoice ${s.invoiceNumber} as PDF`}
                        onClick={() => handleDownloadInvoice(s)}
                        disabled={isDownloading}
                        style={{ ...iconButtonStyle, opacity: isDownloading ? 0.6 : 1, cursor: isDownloading ? 'wait' : 'pointer' }}
                      >
                        <Download style={{ width: 15, height: 15, ...(isDownloading ? { animation: 'spin 1s linear infinite' } : {}) }} />
                      </button>
                      <button
                        title={`Print invoice ${s.invoiceNumber}`}
                        onClick={() => handlePrintInvoice(s)}
                        disabled={isPrinting}
                        style={{ ...iconButtonStyle, opacity: isPrinting ? 0.6 : 1, cursor: isPrinting ? 'wait' : 'pointer' }}
                      >
                        <Printer style={{ width: 15, height: 15, ...(isPrinting ? { animation: 'spin 1s linear infinite' } : {}) }} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {sales.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                  No historical sales recorded yet. Billing desk POS module will generate sales invoices in Phase 3.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Invoice Preview Modal */}
      {previewSale && (
        <div
          onClick={closePreview}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(2, 6, 23, 0.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
              width: '100%', maxWidth: '900px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden'
            }}
          >
            <div style={{
              padding: '1rem 1.25rem', borderBottom: '1px solid #334155',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>
                  Invoice {previewSale.invoiceNumber}
                </h3>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{previewSale.branchNameSnapshot}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  onClick={() => handlePrintInvoice(previewSale)}
                  disabled={printingId === previewSale.id}
                  style={{
                    backgroundColor: '#334155', color: '#f8fafc', border: 'none', borderRadius: '6px',
                    padding: '0.45rem 0.8rem', fontSize: '0.8rem', fontWeight: 600,
                    cursor: printingId === previewSale.id ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: '0.4rem'
                  }}
                >
                  <Printer style={{ width: 14, height: 14 }} />
                  {printingId === previewSale.id ? 'Printing…' : 'Print'}
                </button>
                <button
                  onClick={() => handleDownloadInvoice(previewSale)}
                  disabled={downloadingId === previewSale.id}
                  style={{
                    backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '6px',
                    padding: '0.45rem 0.8rem', fontSize: '0.8rem', fontWeight: 600,
                    cursor: downloadingId === previewSale.id ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: '0.4rem'
                  }}
                >
                  <Download style={{ width: 14, height: 14 }} />
                  {downloadingId === previewSale.id ? 'Saving…' : 'Download PDF'}
                </button>
                <button onClick={closePreview} style={iconButtonStyle} title="Close preview">
                  <X style={{ width: 15, height: 15 }} />
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', backgroundColor: '#f1f5f9' }}>
              <iframe
                title={`Invoice preview ${previewSale.invoiceNumber}`}
                srcDoc={previewHtml}
                style={{ width: '100%', height: '100%', minHeight: '70vh', border: 'none' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
