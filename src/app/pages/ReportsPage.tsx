import React, { useEffect, useMemo, useState } from 'react';
import { Branch } from '@prisma/client';
import {
  BarChart3,
  Building,
  Calendar,
  IndianRupee,
  Percent,
  RefreshCw,
  Trophy
} from 'lucide-react';

// ── Types (mirrors the shapes actually returned by ReportService) ───────────
// The IPC contract types these as `any[]` for the list-shaped reports, so the
// real fields are declared here rather than trusted blindly from `any`.
interface SalesSummary {
  grossSales: number;
  discounts: number;
  netSales: number;
  taxesCollected: number;
  salesCount: number;
}

interface TaxLiabilityRow {
  taxRate: number;
  taxableAmount: number;
  taxAmount: number;
  totalAmount: number;
}

interface TopProductRow {
  productId: string;
  productName: string;
  totalQuantity: number;
  totalRevenue: number;
}

interface ProfitMargin {
  revenue: number;
  cogs: number;
  grossProfit: number;
  profitMarginPercent: number;
}

type ReportTab = 'summary' | 'tax' | 'top-products' | 'profit';

const TABS: { id: ReportTab; label: string }[] = [
  { id: 'summary', label: 'Sales Summary' },
  { id: 'tax', label: 'GST / Tax Liability' },
  { id: 'top-products', label: 'Top Products' },
  { id: 'profit', label: 'Profit Margin' }
];

// ── Formatting helpers (₹ style matches BillingPage/SalesPage) ──────────────
const formatRupees = (v: number | undefined | null) => `₹${(v ?? 0).toFixed(2)}`;
const formatQty = (v: number | undefined | null) => (v ?? 0).toFixed(2);

/** YYYY-MM-DD for a Date, in local time (matches <input type="date"> value format). */
function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Shared visual primitives (kept local — no shared UI kit in this codebase yet) ──
const cardStyle: React.CSSProperties = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '10px'
};

const StatCard: React.FC<{ label: string; value: string; accent?: string; sub?: string }> = ({
  label,
  value,
  accent = '#f8fafc',
  sub
}) => (
  <div style={{ ...cardStyle, padding: '1.25rem', flex: 1, minWidth: '180px' }}>
    <div style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
      {label}
    </div>
    <div style={{ color: accent, fontSize: '1.6rem', fontWeight: 800, marginTop: '0.35rem' }}>{value}</div>
    {sub && <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.2rem' }}>{sub}</div>}
  </div>
);

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8' }}>{message}</div>
);

export const ReportsPage: React.FC = () => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<ReportTab>('summary');

  const today = useMemo(() => new Date(), []);
  const monthStart = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today]);
  const [startDate, setStartDate] = useState<string>(toDateInput(monthStart));
  const [endDate, setEndDate] = useState<string>(toDateInput(today));

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [taxRows, setTaxRows] = useState<TaxLiabilityRow[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);
  const [profit, setProfit] = useState<ProfitMargin | null>(null);

  // ── Branches ───────────────────────────────────────────────────────────
  useEffect(() => {
    const loadBranches = async () => {
      if (!window.alumfab) return;
      try {
        const list = await window.alumfab.getAllBranches();
        setBranches(list);
        if (list.length > 0) setBranchId((prev) => prev || list[0].id);
      } catch (e) {
        console.error('Failed fetching branches for Reports:', e);
      }
    };
    void loadBranches();
  }, []);

  // ── Report data ────────────────────────────────────────────────────────
  const runReports = async () => {
    if (!branchId || !window.alumfab) return;
    if (startDate > endDate) {
      setError('Start date must be before end date.');
      return;
    }

    setLoading(true);
    setError(null);
    const filters = { startDateStr: startDate, endDateStr: endDate };

    try {
      const [summaryRes, taxRes, topRes, profitRes] = await Promise.all([
        window.alumfab.getSalesSummary(branchId, filters),
        window.alumfab.getTaxLiabilityReport(branchId, filters),
        window.alumfab.getTopSellingProducts(branchId, 10),
        window.alumfab.getProfitMarginAnalysis(branchId, filters)
      ]);

      setSummary(summaryRes);
      setTaxRows((taxRes as TaxLiabilityRow[]) ?? []);
      setTopProducts((topRes as TopProductRow[]) ?? []);
      setProfit(profitRes);
    } catch (e: any) {
      console.error('Failed generating reports:', e);
      setError(e?.message || 'Failed to generate reports. Check the console for details.');
      setSummary(null);
      setTaxRows([]);
      setTopProducts([]);
      setProfit(null);
    }
    setLoading(false);
  };

  // Auto-run once a branch is known; re-run whenever branch or date range changes.
  useEffect(() => {
    if (branchId) void runReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, startDate, endDate]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header Banner */}
      <div
        style={{
          ...cardStyle,
          padding: '1.25rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ backgroundColor: '#2563eb', padding: '0.5rem', borderRadius: '8px', color: 'white' }}>
            <BarChart3 style={{ width: 20, height: 20 }} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>Business Reports</h2>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Sales summaries, GST liability, top products & profit margin — computed from local sales data
            </span>
          </div>
        </div>

        {/* Filters: branch + date range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Building style={{ width: 15, height: 15, color: '#94a3b8' }} />
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              style={{
                backgroundColor: '#0f172a',
                color: '#f8fafc',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '0.45rem 0.6rem',
                fontSize: '0.85rem'
              }}
            >
              {branches.length === 0 && <option value="">No branches</option>}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Calendar style={{ width: 15, height: 15, color: '#94a3b8' }} />
            <input
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{
                backgroundColor: '#0f172a',
                color: '#f8fafc',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '0.45rem 0.6rem',
                fontSize: '0.85rem',
                colorScheme: 'dark'
              }}
            />
            <span style={{ color: '#64748b' }}>to</span>
            <input
              type="date"
              value={endDate}
              min={startDate}
              max={toDateInput(today)}
              onChange={(e) => setEndDate(e.target.value)}
              style={{
                backgroundColor: '#0f172a',
                color: '#f8fafc',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '0.45rem 0.6rem',
                fontSize: '0.85rem',
                colorScheme: 'dark'
              }}
            />
          </div>

          <button
            onClick={() => void runReports()}
            disabled={loading || !branchId}
            style={{
              backgroundColor: '#334155',
              color: '#f8fafc',
              border: 'none',
              borderRadius: '6px',
              padding: '0.5rem 0.9rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: loading || !branchId ? 'not-allowed' : 'pointer',
              opacity: loading || !branchId ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <RefreshCw style={{ width: 14, height: 14, ...(loading ? { animation: 'spin 1s linear infinite' } : {}) }} />
            {loading ? 'Running…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            backgroundColor: '#450a0a',
            border: '1px solid #7f1d1d',
            borderRadius: '8px',
            padding: '0.85rem 1.1rem',
            color: '#fca5a5',
            fontSize: '0.85rem'
          }}
        >
          {error}
        </div>
      )}

      {branches.length === 0 && !loading && (
        <div style={{ ...cardStyle, padding: '2.5rem', textAlign: 'center' }}>
          <p style={{ color: '#94a3b8', margin: 0 }}>
            No branches found. Reports need at least one branch with recorded sales.
          </p>
        </div>
      )}

      {/* Tab Strip */}
      <div style={{ display: 'flex', gap: '0.4rem', borderBottom: '1px solid #334155' }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
              color: activeTab === tab.id ? '#f8fafc' : '#94a3b8',
              fontWeight: activeTab === tab.id ? 700 : 500,
              fontSize: '0.85rem',
              padding: '0.6rem 0.9rem',
              cursor: 'pointer'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Sales Summary ─────────────────────────────────────────────── */}
      {activeTab === 'summary' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {summary ? (
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <StatCard label="Gross Sales" value={formatRupees(summary.grossSales)} accent="#f8fafc" />
              <StatCard label="Discounts Given" value={formatRupees(summary.discounts)} accent="#fbbf24" />
              <StatCard label="Net Sales" value={formatRupees(summary.netSales)} accent="#4ade80" />
              <StatCard label="GST Collected" value={formatRupees(summary.taxesCollected)} accent="#60a5fa" />
              <StatCard label="Invoices" value={String(summary.salesCount)} accent="#f8fafc" sub="Non-void sales in range" />
            </div>
          ) : (
            !loading && <div style={cardStyle}><EmptyState message="No sales recorded for this branch in the selected date range." /></div>
          )}
        </div>
      )}

      {/* ── GST / Tax Liability ───────────────────────────────────────── */}
      {activeTab === 'tax' && (
        <div style={{ ...cardStyle, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#0f172a', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
                <th style={{ padding: '0.85rem 1rem' }}>GST Rate</th>
                <th style={{ padding: '0.85rem 1rem' }}>Taxable Amount (₹)</th>
                <th style={{ padding: '0.85rem 1rem' }}>Tax Amount (₹)</th>
                <th style={{ padding: '0.85rem 1rem' }}>Total (₹)</th>
              </tr>
            </thead>
            <tbody>
              {taxRows
                .slice()
                .sort((a, b) => a.taxRate - b.taxRate)
                .map((row) => (
                  <tr key={row.taxRate} style={{ borderBottom: '1px solid #334155', color: '#f8fafc' }}>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span
                        style={{
                          backgroundColor: '#334155',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 700
                        }}
                      >
                        {row.taxRate}% GST
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1' }}>{formatRupees(row.taxableAmount)}</td>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#60a5fa' }}>{formatRupees(row.taxAmount)}</td>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: '#4ade80' }}>{formatRupees(row.totalAmount)}</td>
                  </tr>
                ))}
              {taxRows.length > 0 && (
                <tr style={{ backgroundColor: '#0f172a', color: '#f8fafc', fontWeight: 800 }}>
                  <td style={{ padding: '0.75rem 1rem' }}>Total</td>
                  <td style={{ padding: '0.75rem 1rem' }}>{formatRupees(taxRows.reduce((s, r) => s + r.taxableAmount, 0))}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#60a5fa' }}>{formatRupees(taxRows.reduce((s, r) => s + r.taxAmount, 0))}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#4ade80' }}>{formatRupees(taxRows.reduce((s, r) => s + r.totalAmount, 0))}</td>
                </tr>
              )}
              {taxRows.length === 0 && !loading && (
                <tr>
                  <td colSpan={4}>
                    <EmptyState message="No taxable sales in the selected date range." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Top Selling Products ──────────────────────────────────────── */}
      {activeTab === 'top-products' && (
        <div style={{ ...cardStyle, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#0f172a', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
                <th style={{ padding: '0.85rem 1rem', width: '3rem' }}>#</th>
                <th style={{ padding: '0.85rem 1rem' }}>Product</th>
                <th style={{ padding: '0.85rem 1rem' }}>Qty Sold</th>
                <th style={{ padding: '0.85rem 1rem' }}>Revenue (₹)</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((p, idx) => (
                <tr key={p.productId} style={{ borderBottom: '1px solid #334155', color: '#f8fafc' }}>
                  <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>
                    {idx === 0 ? <Trophy style={{ width: 15, height: 15, color: '#fbbf24' }} /> : idx + 1}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{p.productName}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1' }}>{formatQty(p.totalQuantity)}</td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: '#4ade80' }}>{formatRupees(p.totalRevenue)}</td>
                </tr>
              ))}
              {topProducts.length === 0 && !loading && (
                <tr>
                  <td colSpan={4}>
                    <EmptyState message="No product sales recorded yet for this branch." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {topProducts.length > 0 && (
            <div style={{ padding: '0.6rem 1rem', color: '#64748b', fontSize: '0.75rem', borderTop: '1px solid #334155' }}>
              Ranked by quantity sold, all-time (not limited to the selected date range).
            </div>
          )}
        </div>
      )}

      {/* ── Profit Margin ─────────────────────────────────────────────── */}
      {activeTab === 'profit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {profit ? (
            <>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <StatCard label="Revenue" value={formatRupees(profit.revenue)} accent="#f8fafc" />
                <StatCard label="Cost of Goods Sold" value={formatRupees(profit.cogs)} accent="#fbbf24" />
                <StatCard label="Gross Profit" value={formatRupees(profit.grossProfit)} accent="#4ade80" />
                <StatCard
                  label="Profit Margin"
                  value={`${profit.profitMarginPercent.toFixed(2)}%`}
                  accent={profit.profitMarginPercent >= 0 ? '#4ade80' : '#f87171'}
                />
              </div>
              <div style={{ ...cardStyle, padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Percent style={{ width: 16, height: 16, color: '#94a3b8' }} />
                <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                  Cost basis uses each product&apos;s current <IndianRupee style={{ width: 12, height: 12, display: 'inline' }} />
                  cost price at the time of report generation, applied to historical quantities sold — not a point-in-time
                  cost snapshot from each sale.
                </span>
              </div>
            </>
          ) : (
            !loading && <div style={cardStyle}><EmptyState message="No sales in the selected date range to compute profit margin." /></div>
          )}
        </div>
      )}
    </div>
  );
};
