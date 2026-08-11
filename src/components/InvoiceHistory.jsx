import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { FileText, Printer, Search, Calendar, User, CheckCircle2, AlertCircle, X } from 'lucide-react';

export default function InvoiceHistory() {
  const invoices = useLiveQuery(() => db.invoices.toArray(), []) || [];
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  const filteredInvoices = invoices
    .filter(inv => 
      inv.invoiceNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.customerName.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <FileText style={{ color: 'var(--accent-primary)' }} /> Sales & Invoice Register
        </h2>

        <div style={{ position: 'relative', width: '320px' }}>
          <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', width: 18, height: 18 }} />
          <input 
            type="text" 
            className="form-input" 
            style={{ paddingLeft: '2.5rem' }} 
            placeholder="Search invoice # or customer..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="glass-panel-solid">
        <div className="custom-table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date & Time</th>
                <th>Customer</th>
                <th>Payment Mode</th>
                <th>Status</th>
                <th>Weight (kg)</th>
                <th style={{ textAlign: 'right' }}>Total (₹)</th>
                <th style={{ textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No invoices recorded yet. Create a bill in the POS Terminal to view sales history.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="font-mono" style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>{inv.invoiceNo}</td>
                    <td className="font-mono" style={{ fontSize: '0.8rem' }}>{new Date(inv.date).toLocaleString()}</td>
                    <td style={{ fontWeight: 600 }}>{inv.customerName}</td>
                    <td>{inv.paymentMethod}</td>
                    <td>
                      <span className="status-pill" style={{ 
                        background: inv.status === 'PAID' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                        color: inv.status === 'PAID' ? 'var(--accent-success)' : 'var(--accent-warning)'
                      }}>
                        {inv.status}
                      </span>
                    </td>
                    <td>{inv.totalWeightKg ? inv.totalWeightKg.toFixed(2) : 0} kg</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--accent-primary)' }}>
                      ₹{inv.total.toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button 
                        className="btn btn-secondary btn-sm" 
                        onClick={() => setSelectedInvoice(inv)}
                      >
                        <Printer style={{ width: 14, height: 14 }} /> View / Print
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invoice Detail / Reprint Modal */}
      {selectedInvoice && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Tax Invoice #{selectedInvoice.invoiceNo}</h3>
              <button onClick={() => setSelectedInvoice(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X /></button>
            </div>

            <div className="printable-receipt" style={{ background: '#ffffff', color: '#000000', padding: '1rem', borderRadius: 'var(--radius-md)', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', lineHeight: '1.4' }}>
              <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '0.25rem' }}>ALUMFAB HARDWARE & PROFILES</div>
              <div style={{ textAlign: 'center', fontSize: '0.75rem', marginBottom: '0.75rem' }}>TAX INVOICE / RECEIPT</div>
              <div style={{ borderBottom: '1px dashed #000', marginBottom: '0.5rem' }}></div>
              <div>Invoice No: {selectedInvoice.invoiceNo}</div>
              <div>Date: {new Date(selectedInvoice.date).toLocaleString()}</div>
              <div>Customer: {selectedInvoice.customerName}</div>
              <div>Payment: {selectedInvoice.paymentMethod}</div>
              <div style={{ borderBottom: '1px dashed #000', margin: '0.5rem 0' }}></div>
              
              <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #000', textAlign: 'left' }}>
                    <th>Item</th>
                    <th style={{ textAlign: 'center' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.items.map((item, i) => (
                    <tr key={i}>
                      <td>
                        {item.name}
                        <br />
                        <span style={{ fontSize: '0.7rem', color: '#555' }}>
                          ({item.alloy && item.alloy !== 'N/A' ? `${item.alloy}, ` : ''}{item.finish}{item.lengthFt ? `, ${item.lengthFt}ft` : ''})
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>{item.qty}</td>
                      <td style={{ textAlign: 'right' }}>₹{item.lineTotal.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ borderBottom: '1px dashed #000', margin: '0.5rem 0' }}></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Subtotal:</span>
                <span>₹{selectedInvoice.subtotal.toFixed(0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>GST Tax (18%):</span>
                <span>₹{selectedInvoice.taxAmount.toFixed(0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '0.95rem', marginTop: '0.25rem' }}>
                <span>Grand Total:</span>
                <span>₹{selectedInvoice.total.toLocaleString()}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedInvoice(null)}>Close</button>
              <button className="btn btn-primary" onClick={() => window.print()}>
                <Printer style={{ width: 18, height: 18 }} /> Print Receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
