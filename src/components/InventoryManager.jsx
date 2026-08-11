import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Package, Plus, Search, Edit3, Trash2, Scale, Tag, X, Layers } from 'lucide-react';

export default function InventoryManager() {
  const products = useLiveQuery(() => db.products.toArray(), []) || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Form State
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Aluminum Profiles');
  const [finish, setFinish] = useState('Silver Anodized');
  const [alloy, setAlloy] = useState('6063-T6');
  const [defaultUnit, setDefaultUnit] = useState('kg');
  const [weightPerFt, setWeightPerFt] = useState('0.2');
  const [ratePerKg, setRatePerKg] = useState('310');
  const [ratePerUnit, setRatePerUnit] = useState('60');
  const [stockQty, setStockQty] = useState('100');

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.alloy && p.alloy.toLowerCase().includes(searchQuery.toLowerCase())) ||
    p.finish.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSaveProduct = async () => {
    if (!name) return;
    await db.products.add({
      code: code || 'AL-' + Date.now().toString().slice(-4),
      name,
      category,
      finish,
      alloy: alloy || (category === 'Aluminum Profiles' ? '6063-T6' : 'N/A'),
      defaultUnit,
      weightPerFt: parseFloat(weightPerFt) || 0,
      ratePerKg: parseFloat(ratePerKg) || 0,
      ratePerUnit: parseFloat(ratePerUnit) || 0,
      stockQty: parseFloat(stockQty) || 0,
      taxRate: 18
    });
    setShowAddModal(false);
    setCode('');
    setName('');
  };

  const handleDeleteProduct = async (id) => {
    if (confirm('Are you sure you want to remove this product profile from catalog?')) {
      await db.products.delete(id);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Header & Search Bar */}
      <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, maxWidth: '500px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', width: 18, height: 18 }} />
            <input 
              type="text" 
              className="form-input" 
              style={{ paddingLeft: '2.5rem' }} 
              placeholder="Search by code, name, finish, alloy grade, category..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          <Plus style={{ width: 18, height: 18 }} /> Add Master Profile / Item
        </button>
      </div>

      {/* Catalog Table */}
      <div className="glass-panel-solid">
        <div className="custom-table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Item Name & Description</th>
                <th>Category</th>
                <th>Alloy Grade</th>
                <th>Finish / Spec</th>
                <th>Unit</th>
                <th>Wt / ft</th>
                <th>Rate (₹)</th>
                <th>Stock Level</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono" style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>{p.code}</td>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>
                    <span className="status-pill" style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                      {p.category}
                    </span>
                  </td>
                  <td>
                    <span className="status-pill" style={{ background: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent-primary)', fontWeight: 600 }}>
                      {p.alloy || 'N/A'}
                    </span>
                  </td>
                  <td>{p.finish}</td>
                  <td style={{ textTransform: 'uppercase' }}>{p.defaultUnit}</td>
                  <td>{p.weightPerFt ? `${p.weightPerFt} kg` : 'N/A'}</td>
                  <td style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>
                    ₹{p.defaultUnit === 'kg' ? `${p.ratePerKg}/kg` : `${p.ratePerUnit}/pc`}
                  </td>
                  <td>
                    <span className="status-pill" style={{ 
                      background: p.stockQty < 50 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                      color: p.stockQty < 50 ? 'var(--accent-danger)' : 'var(--accent-success)'
                    }}>
                      {p.stockQty} pcs
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button 
                      onClick={() => handleDeleteProduct(p.id)} 
                      style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer' }}
                    >
                      <Trash2 style={{ width: 16, height: 16 }} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Item Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Add Aluminum Section / Hardware Item</h3>
              <button onClick={() => setShowAddModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Item Code</label>
                  <input type="text" className="form-input" placeholder="AL-1804" value={code} onChange={(e) => setCode(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="Aluminum Profiles">Aluminum Profiles</option>
                    <option value="Hardware & Fittings">Hardware & Fittings</option>
                    <option value="Glass & Accessories">Glass & Accessories</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Item Name</label>
                <input type="text" className="form-input" placeholder="e.g. 27mm Heavy Interlock Profile" value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Alloy Grade</label>
                  <select className="form-select" value={alloy} onChange={(e) => setAlloy(e.target.value)}>
                    <option value="6063-T6">6063-T6 (Architectural Structural)</option>
                    <option value="6063-T5">6063-T5 (Architectural Soft)</option>
                    <option value="6061-T6">6061-T6 (Heavy Structural)</option>
                    <option value="6082-T6">6082-T6 (High Strength Structural)</option>
                    <option value="1100 Commercial">1100 (Commercial Pure)</option>
                    <option value="SS-304">SS-304 Stainless Steel</option>
                    <option value="N/A">N/A (Hardware / Accessory)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Surface Finish</label>
                  <input type="text" className="form-input" placeholder="Silver Anodized / Powder Coated" value={finish} onChange={(e) => setFinish(e.target.value)} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">Default Pricing Unit</label>
                  <select className="form-select" value={defaultUnit} onChange={(e) => setDefaultUnit(e.target.value)}>
                    <option value="kg">kg (Weight based)</option>
                    <option value="pcs">pcs (Piece based)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Initial Stock Count (pcs)</label>
                  <input type="number" className="form-input" value={stockQty} onChange={(e) => setStockQty(e.target.value)} />
                </div>
              </div>

              {defaultUnit === 'kg' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="form-group">
                    <label className="form-label">Weight per Foot (kg/ft)</label>
                    <input type="number" step="0.001" className="form-input" value={weightPerFt} onChange={(e) => setWeightPerFt(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rate per kg (₹)</label>
                    <input type="number" className="form-input" value={ratePerKg} onChange={(e) => setRatePerKg(e.target.value)} />
                  </div>
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">Rate per Piece (₹)</label>
                  <input type="number" className="form-input" value={ratePerUnit} onChange={(e) => setRatePerUnit(e.target.value)} />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveProduct}>Save Product</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
