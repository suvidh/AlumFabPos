import React, { useState, useEffect } from 'react';
import { Company, Branch } from '@prisma/client';
import { AppInfoResult, AppPathsResult, DatabaseHealthResult } from '../../../electron/ipc/contracts';
import { Building2, FileCode, HardDrive, Cpu, RefreshCw, CheckCircle2, AlertTriangle, Plus, Edit, CreditCard } from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'company' | 'invoice' | 'backup' | 'system'>('company');
  const [company, setCompany] = useState<Company | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [appInfo, setAppInfo] = useState<AppInfoResult | null>(null);
  const [appPaths, setAppPaths] = useState<AppPathsResult | null>(null);
  const [dbHealth, setDbHealth] = useState<DatabaseHealthResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showBranchModal, setShowBranchModal] = useState<boolean>(false);

  // New Branch Form State
  const [code, setCode] = useState('');
  const [bName, setBName] = useState('');
  const [gstin, setGstin] = useState('');
  const [phone, setPhone] = useState('');
  const [state, setState] = useState('Maharashtra');
  const [address, setAddress] = useState('');
  const [prefix, setPrefix] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchCompanyData = async () => {
    setLoading(true);
    if (window.alumfab) {
      try {
        const { company: comp } = await window.alumfab.getCompany();
        const bList = await window.alumfab.getAllBranches();
        setCompany(comp);
        setBranches(bList);

        const info = await window.alumfab.getAppInfo();
        const paths = await window.alumfab.getAppPaths();
        const health = await window.alumfab.checkDatabaseHealth();
        setAppInfo(info);
        setAppPaths(paths);
        setDbHealth(health);
      } catch (e) {
        console.error('Failed fetching settings data:', e);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCompanyData();
  }, []);

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company || !code || !bName) return;
    setSubmitting(true);
    try {
      await window.alumfab.createBranch({
        companyId: company.id,
        code,
        name: bName,
        gstin,
        phone,
        state,
        address,
        invoicePrefix: prefix || `INV-${code.toUpperCase()}-`
      });
      setShowBranchModal(false);
      setCode('');
      setBName('');
      setGstin('');
      setPhone('');
      setAddress('');
      setPrefix('');
      await fetchCompanyData();
    } catch (err: any) {
      alert('Failed creating branch: ' + err.message);
    }
    setSubmitting(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Navigation Sub-Tabs */}
      <div style={{
        display: 'flex', gap: '0.5rem', backgroundColor: '#1e293b', padding: '0.4rem', borderRadius: '8px', border: '1px solid #334155', width: 'fit-content'
      }}>
        <button
          onClick={() => setActiveSubTab('company')}
          style={{
            padding: '0.5rem 1rem', borderRadius: '6px', border: 'none',
            backgroundColor: activeSubTab === 'company' ? '#2563eb' : 'transparent',
            color: activeSubTab === 'company' ? 'white' : '#94a3b8',
            fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
          }}
        >
          <Building2 style={{ width: 15, height: 15 }} /> Company & Branches
        </button>

        <button
          onClick={() => setActiveSubTab('system')}
          style={{
            padding: '0.5rem 1rem', borderRadius: '6px', border: 'none',
            backgroundColor: activeSubTab === 'system' ? '#2563eb' : 'transparent',
            color: activeSubTab === 'system' ? 'white' : '#94a3b8',
            fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
          }}
        >
          <Cpu style={{ width: 15, height: 15 }} /> System Status
        </button>

      </div>

      {/* Company & Branches Tab */}
      {activeSubTab === 'company' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Company Card */}
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
                  {company?.name || 'ALUMFAB Bulk Aluminium Hardware'}
                </h3>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Single Company Business Profile</span>
              </div>
              <span style={{ backgroundColor: 'rgba(37, 99, 235, 0.15)', color: '#60a5fa', padding: '0.3rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
                Single Company Model
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', fontSize: '0.85rem', color: '#cbd5e1' }}>
              <div><strong style={{ color: '#94a3b8' }}>Legal Enterprise Name:</strong> {company?.legalName || 'N/A'}</div>
              <div><strong style={{ color: '#94a3b8' }}>Central GSTIN / Tax ID:</strong> <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{company?.taxId || 'N/A'}</span></div>
              <div><strong style={{ color: '#94a3b8' }}>Phone:</strong> {company?.phone || 'N/A'}</div>
              <div><strong style={{ color: '#94a3b8' }}>State Jurisdiction:</strong> {company?.state || 'Maharashtra'}</div>
              <div style={{ gridColumn: '1 / -1' }}><strong style={{ color: '#94a3b8' }}>Registered Address:</strong> {company?.address || 'N/A'}</div>
            </div>
          </div>

          {/* Branches Section */}
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
                  Company Branches & Outlets ({branches.length})
                </h3>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Branch-scoped GSTIN, Invoice Prefixes & Inventories</span>
              </div>

              <button
                onClick={() => setShowBranchModal(true)}
                style={{
                  backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '6px',
                  padding: '0.45rem 0.9rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
                }}
              >
                <Plus style={{ width: 15, height: 15 }} /> Add Branch
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
              {branches.map(b => {
                const isDefault = b.id === company?.defaultBranchId;
                return (
                  <div key={b.id} style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: '#f8fafc' }}>
                        {b.name} <span style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: '0.85rem' }}>({b.code})</span>
                      </div>
                      {isDefault && (
                        <span style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700 }}>
                          MAIN HEADQUARTERS
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: '0.8rem', color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      <div><span style={{ color: '#94a3b8' }}>Branch GSTIN:</span> <strong style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{b.gstin || 'N/A'}</strong></div>
                      <div><span style={{ color: '#94a3b8' }}>Invoice Sequence Prefix:</span> <strong style={{ fontFamily: 'monospace' }}>{b.invoicePrefix}</strong></div>
                      <div><span style={{ color: '#94a3b8' }}>Phone:</span> {b.phone || 'N/A'}</div>
                      <div><span style={{ color: '#94a3b8' }}>State:</span> {b.state || 'Maharashtra'}</div>
                      <div><span style={{ color: '#94a3b8' }}>Address:</span> {b.address || 'N/A'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* System Status Tab */}
      {activeSubTab === 'system' && (
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#f8fafc', margin: 0 }}>
              Phase 2 System Health & Domain Engine
            </h3>
            <button
              onClick={fetchCompanyData}
              style={{
                backgroundColor: '#334155', color: '#f8fafc', border: 'none', borderRadius: '6px',
                padding: '0.4rem 0.8rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
              }}
            >
              <RefreshCw style={{ width: 14, height: 14 }} /> Refresh Health
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '1rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.4rem' }}>Application Name</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>{appInfo?.name || 'ALUMFAB POS'}</div>
            </div>

            <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '1rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.4rem' }}>Prisma Domain Schema Version</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#60a5fa' }}>v{dbHealth?.details?.schemaVersion || 2} (Phase 2 Domain)</div>
            </div>

            <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '1rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.4rem' }}>SQLite Database Status</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: dbHealth?.ok ? '#4ade80' : '#f87171', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {dbHealth?.ok ? <CheckCircle2 style={{ width: 16, height: 16 }} /> : <AlertTriangle style={{ width: 16, height: 16 }} />}
                {dbHealth?.ok ? 'Connected & Healthy' : 'Disconnected'}
              </div>
            </div>
          </div>

          <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '1rem' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.75rem' }}>Resolved Application Paths</div>
            <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div><span style={{ color: '#94a3b8' }}>Database File:</span> {appPaths?.databaseFile || 'Loading...'}</div>
              <div><span style={{ color: '#94a3b8' }}>Logs Directory:</span> {appPaths?.logsDir || 'Loading...'}</div>
              <div><span style={{ color: '#94a3b8' }}>Backups Directory:</span> {appPaths?.backupDir || 'Loading...'}</div>
              <div><span style={{ color: '#94a3b8' }}>Logos Directory:</span> {appPaths?.logosDir || 'Loading...'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Add Branch Modal */}
      {showBranchModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
        }}>
          <div style={{
            backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
            padding: '2rem', width: '100%', maxWidth: '480px', color: '#f8fafc'
          }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1.25rem' }}>
              Create Company Branch Outlet
            </h3>
            <form onSubmit={handleCreateBranch} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Branch Code *</label>
                  <input
                    type="text" required value={code} onChange={e => setCode(e.target.value)} placeholder="BR02"
                    style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Branch Name *</label>
                  <input
                    type="text" required value={bName} onChange={e => setBName(e.target.value)} placeholder="Thane Depot & Showroom"
                    style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Branch GSTIN</label>
                  <input
                    type="text" value={gstin} onChange={e => setGstin(e.target.value)} placeholder="27AAAAA0000A1Z5"
                    style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Invoice Prefix</label>
                  <input
                    type="text" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="INV-BR02-"
                    style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Phone</label>
                  <input
                    type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98200 67890"
                    style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>State *</label>
                  <input
                    type="text" required value={state} onChange={e => setState(e.target.value)} placeholder="Maharashtra"
                    style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Branch Address</label>
                <input
                  type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="Wagle Estate, Thane, Maharashtra 400604"
                  style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button" onClick={() => setShowBranchModal(false)}
                  style={{ backgroundColor: '#334155', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={submitting}
                  style={{ backgroundColor: '#2563eb', color: 'white', border: 'none', padding: '0.5rem 1.25rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  {submitting ? 'Creating...' : 'Save Branch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
