import React, { useState, useEffect } from 'react';
import { Company, Branch } from '@prisma/client';
import { AppInfoResult, AppPathsResult, DatabaseHealthResult } from '../../../electron/ipc/contracts';
import { Building2, Cpu, RefreshCw, CheckCircle2, AlertTriangle, Plus, Edit, Trash2, ShieldCheck } from 'lucide-react';
import { usePOSConfigStore } from '../context/POSConfigStore';

export const SettingsPage: React.FC = () => {
  const { 
    company, 
    branchesList, 
    activeBoundBranch, 
    updateCompany, 
    updateBranch, 
    bindActiveBranch, 
    fetchInitialConfig 
  } = usePOSConfigStore();

  const branches = branchesList;
  const activeBranch = activeBoundBranch;

  const [activeSubTab, setActiveSubTab] = useState<'company' | 'system'>('company');
  const [appInfo, setAppInfo] = useState<AppInfoResult | null>(null);
  const [appPaths, setAppPaths] = useState<AppPathsResult | null>(null);
  const [dbHealth, setDbHealth] = useState<DatabaseHealthResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Modals visibility state
  const [showBranchModal, setShowBranchModal] = useState<boolean>(false);
  const [showCompanyModal, setShowCompanyModal] = useState<boolean>(false);

  // Branch Form State
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [bName, setBName] = useState('');
  const [gstin, setGstin] = useState('');
  const [phone, setPhone] = useState('');
  const [state, setState] = useState('Gujarat');
  const [address, setAddress] = useState('');
  const [prefix, setPrefix] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Company Form State
  const [compName, setCompName] = useState('');
  const [compLegalName, setCompLegalName] = useState('');
  const [compTaxId, setCompTaxId] = useState('');
  const [compPhone, setCompPhone] = useState('');
  const [compState, setCompState] = useState('Gujarat');
  const [compAddress, setCompAddress] = useState('');
  const [compSaving, setCompSaving] = useState(false);

  const isEditMode = editingBranchId !== null;

  const statesList = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
    'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
    'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
    'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
    'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
    'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Puducherry'
  ];

  const fetchSystemHealth = async () => {
    setLoading(true);
    if (window.alumfab) {
      try {
        await fetchInitialConfig();
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
    fetchSystemHealth();
  }, []);

  const resetFormFields = () => {
    setEditingBranchId(null);
    setCode('');
    setBName('');
    setGstin('');
    setPhone('');
    setState('Gujarat');
    setAddress('');
    setPrefix('');
  };

  const openCreateModal = () => {
    resetFormFields();
    setShowBranchModal(true);
  };

  const openEditModal = (branch: Branch) => {
    setEditingBranchId(branch.id);
    setCode(branch.code);
    setBName(branch.name);
    setGstin(branch.gstin || '');
    setPhone(branch.phone || '');
    setState(branch.state || 'Gujarat');
    setAddress(branch.address || '');
    setPrefix(branch.invoicePrefix || '');
    setShowBranchModal(true);
  };

  const openCompanyEditModal = () => {
    if (!company) return;
    setCompName(company.name || '');
    setCompLegalName(company.legalName || '');
    setCompTaxId(company.centralGstin || '');
    setCompPhone(company.phone || '');
    setCompState(company.stateJurisdiction || 'Gujarat');
    setCompAddress(company.registeredAddress || '');
    setShowCompanyModal(true);
  };

  const handleBindBranch = (branchId: string) => {
    bindActiveBranch(branchId);
    alert(`Local POS terminal installation has been successfully scoped to selected branch.`);
  };

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
      resetFormFields();
      await fetchInitialConfig();
    } catch (err: any) {
      alert('Failed creating branch: ' + err.message);
    }
    setSubmitting(false);
  };

  const handleUpdateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBranchId || !bName) return;
    setSubmitting(true);
    try {
      await updateBranch(editingBranchId, {
        name: bName,
        gstin: gstin || undefined,
        phone: phone || undefined,
        state: state || undefined,
        address: address || undefined,
        invoicePrefix: prefix || undefined
      });
      setShowBranchModal(false);
      resetFormFields();
    } catch (err: any) {
      alert('Failed updating branch: ' + err.message);
    }
    setSubmitting(false);
  };

  const handleDeleteBranch = async (branch: Branch) => {
    // Safety logic: Minimum active branch constraint
    if (branches.length <= 1) {
      alert("At least one branch must remain active in the system.");
      return;
    }

    const confirm = window.confirm(
      `Are you sure you want to delete branch "${branch.name}" (${branch.code})?\n\n` +
      `If the branch has active transactions, inventory stocks, or customer accounts, the system will apply a Soft-Delete to retire it from service safely.`
    );
    if (!confirm) return;

    try {
      // Safety logic: Active terminal scoping binding check
      const boundId = localStorage.getItem('boundBranchId');
      if (boundId === branch.id) {
        const nextBranch = branches.find(b => b.id !== branch.id);
        if (nextBranch) {
          alert(`The branch you are deleting is currently set as this terminal's active bound branch. Re-assigning bound branch to "${nextBranch.name}" automatically.`);
          localStorage.setItem('boundBranchId', nextBranch.id);
        }
      }

      const res = await window.alumfab.deleteBranch(branch.id);
      if (res.softDeleted) {
        alert(`Branch "${branch.name}" contains dependent POS transactional history. It has been safely soft-deleted (status set to INACTIVE) and retired from this view.`);
      } else {
        alert(`Branch "${branch.name}" contains no dependencies and was permanently deleted from the local database.`);
      }

      await fetchInitialConfig();
      window.dispatchEvent(new Event('bound-branch-changed'));
    } catch (err: any) {
      alert('Failed to delete branch: ' + err.message);
    }
  };

  const handleUpdateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    // Validate GSTIN if provided (standard 15-digit alphanumeric formats)
    if (compTaxId) {
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (!gstinRegex.test(compTaxId.toUpperCase().trim())) {
        alert('Invalid GSTIN format. Expected format: 24ABOPK8064H1ZD (15 chars)');
        return;
      }
    }

    setCompSaving(true);
    try {
      await updateCompany({
        name: compName.trim(),
        legalName: compLegalName.trim(),
        taxId: compTaxId.toUpperCase().trim(),
        phone: compPhone.trim(),
        state: compState.trim(),
        address: compAddress.trim()
      });
      setShowCompanyModal(false);
    } catch (err: any) {
      alert('Failed updating company details: ' + err.message);
    }
    setCompSaving(false);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155',
    color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem'
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ backgroundColor: 'rgba(37, 99, 235, 0.15)', color: '#60a5fa', padding: '0.3rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
                  Single Company Model
                </span>
                <button
                  onClick={openCompanyEditModal}
                  style={{
                    backgroundColor: '#334155', color: '#f8fafc', border: 'none', borderRadius: '6px',
                    padding: '0.4rem 0.8rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
                  }}
                >
                  <Edit style={{ width: 14, height: 14 }} /> Edit Company Details
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', fontSize: '0.85rem', color: '#cbd5e1' }}>
              <div><strong style={{ color: '#94a3b8' }}>Legal Enterprise Name:</strong> {company?.legalName || 'N/A'}</div>
              <div><strong style={{ color: '#94a3b8' }}>Central GSTIN / Tax ID:</strong> <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{company?.centralGstin || 'N/A'}</span></div>
              <div><strong style={{ color: '#94a3b8' }}>Phone:</strong> {company?.phone || 'N/A'}</div>
              <div><strong style={{ color: '#94a3b8' }}>State Jurisdiction:</strong> {company?.stateJurisdiction || 'Maharashtra'}</div>
              <div style={{ gridColumn: '1 / -1' }}><strong style={{ color: '#94a3b8' }}>Registered Address:</strong> {company?.registeredAddress || 'N/A'}</div>
            </div>
          </div>

          {/* Local Scoping Settings Panel */}
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldCheck style={{ color: '#10b981', width: 20, height: 20 }} />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
                POS Terminal Offline Scoping (Local Binding)
              </h3>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
              Bind this offline installation to one active store branch. Sales invoices and inventory stocks will be scoped directly to this bound branch.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.25rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#cbd5e1', fontWeight: 600 }}>Bound Active Branch:</span>
              <select
                value={activeBranch?.id || ''}
                onChange={(e) => handleBindBranch(e.target.value)}
                style={{ backgroundColor: '#0f172a', color: 'white', border: '1px solid #334155', padding: '0.45rem 1rem', borderRadius: '6px', fontSize: '0.85rem', outline: 'none', minWidth: '220px' }}
              >
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code}) {b.id === company?.defaultBranchId ? ' - [Headquarters]' : ''}
                  </option>
                ))}
              </select>
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
                onClick={openCreateModal}
                style={{
                  backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '6px',
                  padding: '0.45rem 0.9rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
                }}
              >
                <Plus style={{ width: 15, height: 15 }} /> Add Branch
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>
              {branches.map(b => {
                const isDefault = b.id === company?.defaultBranchId;
                return (
                  <div key={b.id} style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: '#f8fafc' }}>
                        {b.name} <span style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: '0.85rem' }}>({b.code})</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        {isDefault && (
                          <span style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, marginRight: '0.25rem' }}>
                            MAIN HQ
                          </span>
                        )}
                        <button
                          onClick={() => openEditModal(b)}
                          title="Edit Branch"
                          style={{
                            backgroundColor: '#334155', color: '#e2e8f0', border: 'none', borderRadius: '6px',
                            padding: '0.35rem 0.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
                            fontSize: '0.75rem', fontWeight: 600
                          }}
                        >
                          <Edit style={{ width: 13, height: 13 }} /> Edit
                        </button>
                        <button
                          onClick={() => handleDeleteBranch(b)}
                          title="Delete Branch"
                          style={{
                            backgroundColor: '#7f1d1d', color: '#fca5a5', border: 'none', borderRadius: '6px',
                            padding: '0.35rem 0.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
                            fontSize: '0.75rem', fontWeight: 600
                          }}
                        >
                          <Trash2 style={{ width: 13, height: 13 }} /> Delete
                        </button>
                      </div>
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
              onClick={fetchSystemHealth}
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

      {/* Edit Company Profile Modal */}
      {showCompanyModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
        }}>
          <div style={{
            backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
            padding: '2rem', width: '100%', maxWidth: '520px', color: '#f8fafc'
          }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1.25rem' }}>
              Edit Company Profile
            </h3>
            <form onSubmit={handleUpdateCompany} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Brand / Operating Name *</label>
                <input
                  type="text" required value={compName} onChange={e => setCompName(e.target.value)} placeholder="ALUMFAB Bulk Aluminium Hardware"
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Legal Enterprise Name</label>
                <input
                  type="text" value={compLegalName} onChange={e => setCompLegalName(e.target.value)} placeholder="ALUMFAB Hardware & Aluminium Pvt Ltd"
                  style={inputStyle}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Central GSTIN / Tax ID</label>
                  <input
                    type="text" value={compTaxId} onChange={e => setCompTaxId(e.target.value)} placeholder="24ABOPK8064H1ZD"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Phone Number</label>
                  <input
                    type="text" value={compPhone} onChange={e => setCompPhone(e.target.value)} placeholder="9824157960"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>State Jurisdiction *</label>
                <select
                  value={compState} onChange={e => setCompState(e.target.value)}
                  style={{ ...inputStyle, outline: 'none' }}
                >
                  {statesList.map(st => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Registered Address</label>
                <textarea
                  value={compAddress} onChange={e => setCompAddress(e.target.value)} placeholder="Enter business registered office address..."
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button" onClick={() => setShowCompanyModal(false)}
                  style={{ backgroundColor: '#334155', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={compSaving}
                  style={{ backgroundColor: '#2563eb', color: 'white', border: 'none', padding: '0.5rem 1.25rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  {compSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Branch Modal */}
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
              {isEditMode ? 'Edit Branch Details' : 'Create Company Branch Outlet'}
            </h3>
            <form onSubmit={isEditMode ? handleUpdateBranch : handleCreateBranch} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Branch Code *</label>
                  <input
                    type="text" required value={code} onChange={e => setCode(e.target.value)} placeholder="BR02"
                    disabled={isEditMode}
                    style={{ ...inputStyle, opacity: isEditMode ? 0.5 : 1, cursor: isEditMode ? 'not-allowed' : 'text' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Branch Name *</label>
                  <input
                    type="text" required value={bName} onChange={e => setBName(e.target.value)} placeholder="Thane Depot & Showroom"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Branch GSTIN</label>
                  <input
                    type="text" value={gstin} onChange={e => setGstin(e.target.value)} placeholder="27AAAAA0000A1Z5"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Invoice Prefix</label>
                  <input
                    type="text" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="INV-BR02-"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Phone</label>
                  <input
                    type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98200 67890"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>State *</label>
                  <select
                    value={state} onChange={e => setState(e.target.value)}
                    style={{ ...inputStyle, outline: 'none' }}
                  >
                    {statesList.map(st => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Branch Address</label>
                <input
                  type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="Wagle Estate, Thane, Maharashtra 400604"
                  style={inputStyle}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button" onClick={() => { setShowBranchModal(false); resetFormFields(); }}
                  style={{ backgroundColor: '#334155', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={submitting}
                  style={{ backgroundColor: isEditMode ? '#16a34a' : '#2563eb', color: 'white', border: 'none', padding: '0.5rem 1.25rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  {submitting ? (isEditMode ? 'Saving...' : 'Creating...') : (isEditMode ? 'Save Changes' : 'Save Branch')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
