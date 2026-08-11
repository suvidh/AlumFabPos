import React, { useState, useEffect } from 'react';
import { Sale, Payment } from '@prisma/client';
import { FileText, RefreshCw } from 'lucide-react';
import { UnitNormalizer } from '../../services/unitNormalizer';

export const SalesPage: React.FC = () => {
  const [sales, setSales] = useState<(Sale & { payments: Payment[] })[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchSales = async () => {
    setLoading(true);
    if (window.alumfab) {
      try {
        const list = await window.alumfab.getAllSales();
        setSales(list as any);
      } catch (e) {
        console.error('Failed fetching sales history:', e);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSales();
  }, []);

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
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => {
              const totalRupees = UnitNormalizer.fromPaise(s.grandTotalPaise);
              const paymentMethod = s.payments && s.payments.length > 0 ? s.payments[0].method : 'CASH';
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
                </tr>
              );
            })}
            {sales.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                  No historical sales recorded yet. Billing desk POS module will generate sales invoices in Phase 3.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
