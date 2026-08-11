import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Users, Plus, Phone, CreditCard, ArrowUpRight, ArrowDownLeft, DollarSign, History, CheckCircle2, X } from 'lucide-react';

export default function CustomerKhata() {
  const customers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const transactions = useLiveQuery(() => db.customerTransactions.toArray(), []) || [];

  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [showCollectPaymentModal, setShowCollectPaymentModal] = useState(false);

  // New Customer Form State
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newType, setNewType] = useState('Fabricator');
  const [newLimit, setNewLimit] = useState('100000');

  // Collect Payment Form State
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('Cash collection / Payment received');

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId) || customers[0];
  const customerTransactions = selectedCustomer 
    ? transactions.filter(t => t.customerId === selectedCustomer.id).sort((a, b) => new Date(b.date) - new Date(a.date))
    : [];

  const handleAddCustomer = async () => {
    if (!newName) return;
    const id = await db.customers.add({
      code: newCode || 'CUST-' + Date.now().toString().slice(-4),
      name: newName,
      phone: newPhone || 'N/A',
      customerType: newType,
      creditLimit: parseFloat(newLimit) || 100000,
      outstandingBalance: 0
    });
    setSelectedCustomerId(id);
    setShowAddCustomerModal(false);
    setNewName('');
    setNewPhone('');
  };

  // ATOMIC DATABASE TRANSACTION FOR PAYMENT COLLECTIONS
  const handleRecordPayment = async () => {
    if (!selectedCustomer || !paymentAmount) return;
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0) return;

    try {
      await db.transaction('rw', [db.customers, db.customerTransactions], async () => {
        const freshCust = await db.customers.get(selectedCustomer.id);
        const currentBal = freshCust ? freshCust.outstandingBalance || 0 : 0;
        const newBalance = Math.max(0, currentBal - amount);

        await db.customers.update(selectedCustomer.id, {
          outstandingBalance: newBalance
        });

        await db.customerTransactions.add({
          customerId: selectedCustomer.id,
          date: new Date().toISOString(),
          type: 'CREDIT',
          amount: amount,
          balance: newBalance,
          notes: paymentNotes
        });
      });

      setShowCollectPaymentModal(false);
      setPaymentAmount('');
    } catch (err) {
      alert('Payment collection transaction failed and rolled back: ' + err.message);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '1.5rem', height: 'calc(100vh - 120px)' }}>
      {/* Left Column: Customer Directory */}
      <div className="glass-panel-solid" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users style={{ color: 'var(--accent-primary)', width: 18, height: 18 }} /> Fabricator Khata Accounts
          </h3>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddCustomerModal(true)}>
            <Plus style={{ width: 14, height: 14 }} /> Add Client
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingRight: '0.2rem' }}>
          {customers.map(customer => (
            <div 
              key={customer.id} 
              onClick={() => setSelectedCustomerId(customer.id)}
              style={{ 
                background: selectedCustomer && selectedCustomer.id === customer.id ? 'var(--bg-card-hover)' : 'var(--bg-input)',
                border: selectedCustomer && selectedCustomer.id === customer.id ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                padding: '0.85rem',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{customer.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.2rem' }}>
                    <Phone style={{ width: 12, height: 12 }} /> {customer.phone}
                  </div>
                </div>
                <span className="status-pill" style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--accent-cyan)', fontSize: '0.65rem' }}>
                  {customer.customerType}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px dashed var(--border-color)' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Khata Balance:</span>
                <span style={{ fontSize: '0.95rem', fontWeight: 800, color: customer.outstandingBalance > 0 ? 'var(--accent-danger)' : 'var(--accent-success)' }}>
                  ₹{customer.outstandingBalance.toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Column: Customer Detailed Ledger */}
      {selectedCustomer ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflow: 'hidden' }}>
          {/* Customer Overview Banner */}
          <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)' }}>{selectedCustomer.code}</span>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>{selectedCustomer.name}</h2>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                Phone: {selectedCustomer.phone} | Type: {selectedCustomer.customerType}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Outstanding Credit Balance</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: selectedCustomer.outstandingBalance > 0 ? 'var(--accent-danger)' : 'var(--accent-success)' }}>
                  ₹{selectedCustomer.outstandingBalance.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Credit Limit: ₹{selectedCustomer.creditLimit.toLocaleString()}</div>
              </div>

              <button className="btn btn-success" onClick={() => setShowCollectPaymentModal(true)}>
                <DollarSign style={{ width: 18, height: 18 }} /> Record Payment Collection
              </button>
            </div>
          </div>

          {/* Transactions Ledger Timeline */}
          <div className="glass-panel-solid" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <History style={{ color: 'var(--accent-primary)', width: 18, height: 18 }} /> Statement / Transaction History
            </h3>

            <div className="custom-table-container" style={{ flex: 1, overflowY: 'auto' }}>
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Date & Time</th>
                    <th>Type</th>
                    <th>Notes / Details</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th style={{ textAlign: 'right' }}>Running Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {customerTransactions.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                        No payment or invoice transactions recorded yet for this customer.
                      </td>
                    </tr>
                  ) : (
                    customerTransactions.map((tx, idx) => (
                      <tr key={idx}>
                        <td className="font-mono" style={{ fontSize: '0.8rem' }}>{new Date(tx.date).toLocaleString()}</td>
                        <td>
                          {tx.type === 'DEBIT' ? (
                            <span className="status-pill" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--accent-danger)' }}>
                              <ArrowUpRight style={{ width: 12, height: 12 }} /> Invoice Billed
                            </span>
                          ) : (
                            <span className="status-pill" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--accent-success)' }}>
                              <ArrowDownLeft style={{ width: 12, height: 12 }} /> Payment Received
                            </span>
                          )}
                        </td>
                        <td>{tx.notes}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: tx.type === 'DEBIT' ? 'var(--accent-danger)' : 'var(--accent-success)' }}>
                          {tx.type === 'DEBIT' ? `+₹${tx.amount.toLocaleString()}` : `-₹${tx.amount.toLocaleString()}`}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          ₹{tx.balance.toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {/* Add Client Modal */}
      {showAddCustomerModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '450px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Add Fabricator / Customer</h3>
              <button onClick={() => setShowAddCustomerModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Client Code</label>
                <input type="text" className="form-input" placeholder="e.g. CUST-FAB03" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Full Name / Firm Name</label>
                <input type="text" className="form-input" placeholder="e.g. Metro Aluminum Works" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone Number</label>
                <input type="text" className="form-input" placeholder="+91 98765 00000" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Customer Type</label>
                <select className="form-select" value={newType} onChange={(e) => setNewType(e.target.value)}>
                  <option value="Fabricator">Fabricator</option>
                  <option value="Architect">Architect</option>
                  <option value="Retail">Retail</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Credit Limit (₹)</label>
                <input type="number" className="form-input" value={newLimit} onChange={(e) => setNewLimit(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setShowAddCustomerModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddCustomer}>Save Client</button>
            </div>
          </div>
        </div>
      )}

      {/* Collect Payment Modal */}
      {showCollectPaymentModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-success)' }}>Record Khata Cash Collection</h3>
              <button onClick={() => setShowCollectPaymentModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X /></button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Client: <strong>{selectedCustomer.name}</strong>  
              <br />Current Outstanding: <span style={{ color: 'var(--accent-danger)', fontWeight: 700 }}>₹{selectedCustomer.outstandingBalance.toLocaleString()}</span>
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Payment Amount Collected (₹)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  placeholder="e.g. 10000" 
                  value={paymentAmount} 
                  onChange={(e) => setPaymentAmount(e.target.value)} 
                />
              </div>

              <div className="form-group">
                <label className="form-label">Notes / Reference</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={paymentNotes} 
                  onChange={(e) => setPaymentNotes(e.target.value)} 
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setShowCollectPaymentModal(false)}>Cancel</button>
              <button className="btn btn-success" onClick={handleRecordPayment}>Record Collection</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
