import React, { useState, useEffect } from 'react';
import { Customer } from '@prisma/client';
import { Users, Plus, RefreshCw, Search, Edit, Trash2, RotateCcw } from 'lucide-react';

export const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showModal, setShowModal] = useState<boolean>(false);

  // Form State
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gstin, setGstin] = useState('');
  const [state, setState] = useState('Maharashtra');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);

  const fetchCustomers = async () => {
    setLoading(true);
    if (window.alumfab) {
      try {
        const list = await window.alumfab.getAllCustomers(true);
        setCustomers(list);
      } catch (e) {
        console.error('Failed fetching customers:', e);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    setSubmitting(true);
    try {
      if (editMode && editingCustomerId) {
        await window.alumfab.updateCustomer(editingCustomerId, {
          name,
          phone,
          gstin,
          state,
          address,
          notes
        });
      } else {
        await window.alumfab.createCustomer({
          name,
          phone,
          gstin,
          state,
          address,
          notes
        });
      }
      setShowModal(false);
      resetForm();
      await fetchCustomers();
    } catch (err: any) {
      alert('Failed saving customer profile: ' + err.message);
    }
    setSubmitting(false);
  };

  const resetForm = () => {
    setName('');
    setPhone('');
    setGstin('');
    setState('Maharashtra');
    setAddress('');
    setNotes('');
    setEditMode(false);
    setEditingCustomerId(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (c: Customer) => {
    setName(c.name);
    setPhone(c.phone || '');
    setGstin(c.gstin || '');
    setState(c.state || 'Maharashtra');
    setAddress(c.address || '');
    setNotes(c.notes || '');
    setEditMode(true);
    setEditingCustomerId(c.id);
    setShowModal(true);
  };

  const handleDeactivateCustomer = async (id: string) => {
    if (!window.confirm('Are you sure you want to deactivate this customer profile?')) return;
    try {
      await window.alumfab.updateCustomer(id, { isActive: false });
      await fetchCustomers();
    } catch (err: any) {
      alert('Failed: ' + err.message);
    }
  };

  const handleReactivateCustomer = async (id: string) => {
    try {
      await window.alumfab.updateCustomer(id, { isActive: true });
      await fetchCustomers();
    } catch (err: any) {
      alert('Failed: ' + err.message);
    }
  };

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.phone && c.phone.includes(searchTerm)) ||
    (c.gstin && c.gstin.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header Banner */}
      <div style={{
        backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px',
        padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ backgroundColor: '#2563eb', padding: '0.5rem', borderRadius: '8px', color: 'white' }}>
            <Users style={{ width: 20, height: 20 }} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Customer Directory
            </h2>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Phase 2 Domain Engine — {customers.length} Profiles Registered
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={fetchCustomers}
            style={{
              backgroundColor: '#334155', color: '#f8fafc', border: 'none', borderRadius: '6px',
              padding: '0.5rem 0.9rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
            }}
          >
            <RefreshCw style={{ width: 14, height: 14 }} /> Refresh List
          </button>

          <button
            onClick={openCreateModal}
            style={{
              backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '6px',
              padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
            }}
          >
            <Plus style={{ width: 16, height: 16 }} /> Add Customer
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '0.6rem 1rem' }}>
        <Search style={{ width: 18, height: 18, color: '#94a3b8' }} />
        <input
          type="text" placeholder="Search customer by Name, Phone, or GSTIN..."
          value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
          style={{ backgroundColor: 'transparent', border: 'none', color: '#f8fafc', outline: 'none', width: '100%', fontSize: '0.9rem' }}
        />
      </div>

      {/* Customer Table */}
      <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#0f172a', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: '0.85rem 1rem' }}>Customer Name</th>
              <th style={{ padding: '0.85rem 1rem' }}>Phone</th>
              <th style={{ padding: '0.85rem 1rem' }}>GSTIN</th>
              <th style={{ padding: '0.85rem 1rem' }}>State</th>
              <th style={{ padding: '0.85rem 1rem' }}>Address</th>
              <th style={{ padding: '0.85rem 1rem' }}>Notes</th>
              <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCustomers.map((c) => {
              const isActive = c.isActive !== false;
              return (
                <tr key={c.id} style={{ borderBottom: '1px solid #334155', color: isActive ? '#f8fafc' : '#64748b', opacity: isActive ? 1 : 0.6 }}>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>
                    {c.name}
                    {!isActive && (
                      <span style={{ marginLeft: '0.5rem', backgroundColor: '#475569', color: '#cbd5e1', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>
                        INACTIVE
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: isActive ? '#cbd5e1' : '#64748b' }}>{c.phone || '—'}</td>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', color: isActive ? '#60a5fa' : '#64748b' }}>{c.gstin || '—'}</td>
                  <td style={{ padding: '0.75rem 1rem', color: isActive ? '#cbd5e1' : '#64748b' }}>{c.state || '—'}</td>
                  <td style={{ padding: '0.75rem 1rem', color: isActive ? '#cbd5e1' : '#64748b' }}>{c.address || '—'}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#94a3b8', fontSize: '0.8rem' }}>{c.notes || '—'}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <button
                      onClick={() => openEditModal(c)}
                      style={{ backgroundColor: 'transparent', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: '0.25rem' }}
                      title="Edit Profile"
                    >
                      <Edit style={{ width: 16, height: 16 }} />
                    </button>
                    {isActive ? (
                      <button
                        onClick={() => handleDeactivateCustomer(c.id)}
                        style={{ backgroundColor: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.25rem' }}
                        title="Deactivate Customer"
                      >
                        <Trash2 style={{ width: 16, height: 16 }} />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleReactivateCustomer(c.id)}
                        style={{ backgroundColor: 'transparent', border: 'none', color: '#10b981', cursor: 'pointer', padding: '0.25rem' }}
                        title="Reactivate Customer"
                      >
                        <RotateCcw style={{ width: 16, height: 16 }} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredCustomers.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                  No customer profiles found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Customer Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
        }}>
          <div style={{
            backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
            padding: '2rem', width: '100%', maxWidth: '460px', color: '#f8fafc'
          }}>
             <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1.25rem' }}>
              {editMode ? 'Edit Customer Profile' : 'Create Customer Profile'}
            </h3>
            <form onSubmit={handleSaveCustomer} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Customer / Enterprise Name *</label>
                <input
                  type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Apex Glass & Aluminium Fabricators"
                  style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Phone Number</label>
                  <input
                    type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98200 00000"
                    style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>GSTIN Number</label>
                  <input
                    type="text" value={gstin} onChange={e => setGstin(e.target.value)} placeholder="27ABCDE1234F1Z5"
                    style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>State *</label>
                <input
                  type="text" required value={state} onChange={e => setState(e.target.value)} placeholder="Maharashtra"
                  style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Billing Address</label>
                <input
                  type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="Industrial Area, Mumbai"
                  style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Notes / Remarks (Optional)</label>
                <textarea
                  value={notes} onChange={e => setNotes(e.target.value)} placeholder="Enter business remarks..."
                  style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem', minHeight: '60px', fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button" onClick={() => { setShowModal(false); resetForm(); }}
                  style={{ backgroundColor: '#334155', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={submitting}
                  style={{ backgroundColor: '#2563eb', color: 'white', border: 'none', padding: '0.5rem 1.25rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  {submitting ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
