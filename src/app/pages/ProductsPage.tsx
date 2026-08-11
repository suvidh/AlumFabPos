import React, { useState, useEffect } from 'react';
import { Product } from '@prisma/client';
import { Package, Plus, RefreshCw, Search, Upload, Play, CheckCircle2, AlertTriangle, Trash2, RotateCcw, Edit } from 'lucide-react';
import { UnitNormalizer } from '../../services/unitNormalizer';
import { ImportDryRunResult, ConflictStrategy } from '../../../electron/ipc/contracts';

export const ProductsPage: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showModal, setShowModal] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);

  // Form State
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('PCS');
  const [barcode, setBarcode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);

  // Category Domain States
  const [categories, setCategories] = useState<any[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'catalog' | 'categories'>('catalog');
  const [categoryId, setCategoryId] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryEditMode, setCategoryEditMode] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  // Import State
  const [defaultImportPath, setDefaultImportPath] = useState<string>('hardware.ods');
  const [importFilePath, setImportFilePath] = useState<string>('');
  const [dryRunRunning, setDryRunRunning] = useState<boolean>(false);
  const [dryRunResult, setDryRunResult] = useState<ImportDryRunResult | null>(null);
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('SKIP');
  const [committing, setCommitting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string>('');

  const fetchProducts = async () => {
    setLoading(true);
    if (window.alumfab) {
      try {
        const list = await window.alumfab.getAllProducts(true);
        setProducts(list);
      } catch (e) {
        console.error('Failed querying product catalog:', e);
      }
    }
    setLoading(false);
  };

  const fetchDefaultImportPath = async () => {
    if (window.alumfab) {
      try {
        const defaultPath = await window.alumfab.getImportDefaultPath();
        setDefaultImportPath(defaultPath);
        setImportFilePath(defaultPath);
      } catch (e) {
        console.error('Failed querying default import path:', e);
      }
    }
  };

  const fetchCategories = async () => {
    if (window.alumfab) {
      try {
        const list = await window.alumfab.getAllCategories(true);
        setCategories(list);
      } catch (e) {
        console.error('Failed fetching categories:', e);
      }
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchCategories();
    fetchDefaultImportPath();
  }, []);

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sku || !name || !price) return;
    setSubmitting(true);
    try {
      if (editMode && editingProductId) {
        await window.alumfab.updateProduct(editingProductId, {
          name,
          sellingPrice: parseFloat(price),
          sellingUnit: unit,
          sourceUnit: unit,
          barcode: barcode || undefined,
          categoryId: categoryId || undefined
        });
      } else {
        await window.alumfab.createProduct({
          sku,
          name,
          sellingPrice: parseFloat(price),
          sellingUnit: unit,
          sourceUnit: unit,
          barcode: barcode || undefined,
          categoryId: categoryId || undefined
        });
      }
      setShowModal(false);
      resetForm();
      await fetchProducts();
    } catch (err: any) {
      alert('Failed saving product: ' + err.message);
    }
    setSubmitting(false);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryName.trim()) return;
    try {
      if (categoryEditMode && editingCategoryId) {
        await window.alumfab.updateCategory(editingCategoryId, { name: categoryName.trim() });
      } else {
        await window.alumfab.createCategory(categoryName.trim());
      }
      setShowCategoryModal(false);
      setCategoryName('');
      setCategoryEditMode(false);
      setEditingCategoryId(null);
      await fetchCategories();
      await fetchProducts();
    } catch (err: any) {
      alert('Failed saving category: ' + err.message);
    }
  };

  const handleDeactivateCategory = async (id: string) => {
    if (!window.confirm('Are you sure you want to deactivate this category?')) return;
    try {
      await window.alumfab.updateCategory(id, { isActive: false });
      await fetchCategories();
      await fetchProducts();
    } catch (err: any) {
      alert('Failed to deactivate: ' + err.message);
    }
  };

  const handleReactivateCategory = async (id: string) => {
    try {
      await window.alumfab.updateCategory(id, { isActive: true });
      await fetchCategories();
      await fetchProducts();
    } catch (err: any) {
      alert('Failed to reactivate: ' + err.message);
    }
  };

  const openCreateCategory = () => {
    setCategoryName('');
    setCategoryEditMode(false);
    setEditingCategoryId(null);
    setShowCategoryModal(true);
  };

  const openEditCategory = (c: any) => {
    setCategoryName(c.name);
    setCategoryEditMode(true);
    setEditingCategoryId(c.id);
    setShowCategoryModal(true);
  };

  const resetForm = () => {
    setSku('');
    setName('');
    setPrice('');
    setUnit('PCS');
    setBarcode('');
    setCategoryId('');
    setEditMode(false);
    setEditingProductId(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (p: any) => {
    setSku(p.sku);
    setName(p.name);
    setPrice(UnitNormalizer.fromPaise(p.sellingPricePaise).toString());
    setUnit(p.sellingUnit || 'PCS');
    setBarcode(p.barcode || '');
    setCategoryId(p.categoryId || '');
    setEditMode(true);
    setEditingProductId(p.id);
    setShowModal(true);
  };

  const handleRunDryRun = async () => {
    if (!importFilePath) return;
    setDryRunRunning(true);
    setImportError('');
    setDryRunResult(null);
    try {
      const res = await window.alumfab.runImportDryRun(importFilePath);
      setDryRunResult(res);
    } catch (err: any) {
      setImportError(err.message || 'Dry-run failed. Check that the file exists and is valid.');
    }
    setDryRunRunning(false);
  };

  const handleCommitImport = async () => {
    if (!dryRunResult) return;
    setCommitting(true);
    setImportError('');
    try {
      const res = await window.alumfab.commitImport(dryRunResult, conflictStrategy);
      if (res.success) {
        alert(
          `Import committed successfully!\n` +
          `• New: ${res.importedCount}\n` +
          `• Updated: ${res.updatedCount}\n` +
          `• Skipped: ${res.skippedCount}`
        );
        setShowImportModal(false);
        setDryRunResult(null);
        await fetchProducts();
      } else {
        setImportError(res.errors.join(', ') || 'Failed to commit import');
      }
    } catch (err: any) {
      setImportError(err.message || 'Error occurred while committing.');
    }
    setCommitting(false);
  };

  const handleDeactivateProduct = async (productId: string) => {
    if (!window.confirm('Are you sure you want to deactivate/delete this product? It will be hidden from default searches.')) return;
    try {
      await window.alumfab.updateProduct(productId, { isActive: false });
      await fetchProducts();
    } catch (err: any) {
      alert('Failed to deactivate product: ' + err.message);
    }
  };

  const handleActivateProduct = async (productId: string) => {
    try {
      await window.alumfab.updateProduct(productId, { isActive: true });
      await fetchProducts();
    } catch (err: any) {
      alert('Failed to reactivate product: ' + err.message);
    }
  };

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
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
            <Package style={{ width: 20, height: 20 }} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Master Product Catalog
            </h2>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              GST-Inclusive Selling Prices (Paise Engine) — {products.length} Products Registered
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={fetchProducts}
            style={{
              backgroundColor: '#334155', color: '#f8fafc', border: 'none', borderRadius: '6px',
              padding: '0.5rem 0.9rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
            }}
          >
            <RefreshCw style={{ width: 14, height: 14 }} /> Refresh
          </button>

          {activeSubTab === 'catalog' && (
            <>
              <button
                onClick={() => setShowImportModal(true)}
                style={{
                  backgroundColor: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '6px',
                  padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
                }}
              >
                <Upload style={{ width: 16, height: 16 }} /> Import
              </button>

              <button
                onClick={openCreateModal}
                style={{
                  backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '6px',
                  padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
                }}
              >
                <Plus style={{ width: 16, height: 16 }} /> Add Product
              </button>
            </>
          )}

          {activeSubTab === 'categories' && (
            <button
              onClick={openCreateCategory}
              style={{
                backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '6px',
                padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
              }}
            >
              <Plus style={{ width: 16, height: 16 }} /> Add Category
            </button>
          )}
        </div>
      </div>

      {/* Navigation sub-tabs */}
      <div style={{ display: 'flex', gap: '0.75rem', borderBottom: '1px solid #334155', paddingBottom: '0.5rem' }}>
        <button
          onClick={() => setActiveSubTab('catalog')}
          style={{
            padding: '0.4rem 0.85rem', borderRadius: '6px', border: 'none',
            backgroundColor: activeSubTab === 'catalog' ? '#2563eb' : 'transparent',
            color: activeSubTab === 'catalog' ? 'white' : '#94a3b8',
            fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem'
          }}
        >
          Product Catalog
        </button>
        <button
          onClick={() => setActiveSubTab('categories')}
          style={{
            padding: '0.4rem 0.85rem', borderRadius: '6px', border: 'none',
            backgroundColor: activeSubTab === 'categories' ? '#2563eb' : 'transparent',
            color: activeSubTab === 'categories' ? 'white' : '#94a3b8',
            fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem'
          }}
        >
          Product Categories
        </button>
      </div>

      {activeSubTab === 'catalog' && (
        <>
          {/* Search Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '0.6rem 1rem' }}>
            <Search style={{ width: 18, height: 18, color: '#94a3b8' }} />
            <input
              type="text" placeholder="Search product by Name or SKU code..."
              value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              style={{ backgroundColor: 'transparent', border: 'none', color: '#f8fafc', outline: 'none', width: '100%', fontSize: '0.9rem' }}
            />
          </div>
        </>
      )}

      {/* Product Table */}
      {activeSubTab === 'catalog' && (
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#0f172a', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: '0.85rem 1rem' }}>SKU Code</th>
              <th style={{ padding: '0.85rem 1rem' }}>Product Name</th>
              <th style={{ padding: '0.85rem 1rem' }}>GST-Inclusive Price (₹)</th>
              <th style={{ padding: '0.85rem 1rem' }}>Selling Unit</th>
              <th style={{ padding: '0.85rem 1rem' }}>Source Unit</th>
              <th style={{ padding: '0.85rem 1rem' }}>Barcode</th>
              <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p) => {
              const priceRupees = UnitNormalizer.fromPaise(p.sellingPricePaise);
              const isActive = p.isActive !== false;
              return (
                <tr 
                  key={p.id} 
                  style={{ 
                    borderBottom: '1px solid #334155', 
                    color: isActive ? '#f8fafc' : '#64748b',
                    opacity: isActive ? 1 : 0.6
                  }}
                >
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontWeight: 600, color: isActive ? '#60a5fa' : '#64748b' }}>
                    {p.sku}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 500, textDecoration: isActive ? 'none' : 'line-through' }}>
                    {p.name}
                    {!isActive && (
                      <span style={{ marginLeft: '0.5rem', backgroundColor: '#475569', color: '#cbd5e1', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>
                        INACTIVE
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: isActive ? '#4ade80' : '#64748b' }}>
                    ₹{priceRupees.toFixed(2)}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{ backgroundColor: '#334155', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                      {p.sellingUnit}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: '#94a3b8', fontSize: '0.8rem' }}>{p.sourceUnit || 'PCS'}</td>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', color: '#94a3b8' }}>{p.barcode || '—'}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <button
                      onClick={() => openEditModal(p)}
                      style={{
                        backgroundColor: 'transparent', border: 'none', color: '#60a5fa', 
                        cursor: 'pointer', padding: '0.25rem', borderRadius: '4px', 
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
                      }}
                      title="Edit Product"
                    >
                      <Edit style={{ width: 16, height: 16 }} />
                    </button>
                    {isActive ? (
                      <button
                        onClick={() => handleDeactivateProduct(p.id)}
                        style={{
                          backgroundColor: 'transparent', border: 'none', color: '#ef4444', 
                          cursor: 'pointer', padding: '0.25rem', borderRadius: '4px', 
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
                        }}
                        title="Delete (Deactivate) Product"
                      >
                        <Trash2 style={{ width: 16, height: 16 }} />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleActivateProduct(p.id)}
                        style={{
                          backgroundColor: 'transparent', border: 'none', color: '#10b981', 
                          cursor: 'pointer', padding: '0.25rem', borderRadius: '4px', 
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
                        }}
                        title="Restore Product"
                      >
                        <RotateCcw style={{ width: 16, height: 16 }} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {/* Categories View Tab */}
      {activeSubTab === 'categories' && (
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#0f172a', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
                <th style={{ padding: '0.85rem 1rem' }}>Category Name</th>
                <th style={{ padding: '0.85rem 1rem' }}>Status</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => {
                const isActive = c.isActive !== false;
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid #334155', color: isActive ? '#f8fafc' : '#64748b', opacity: isActive ? 1 : 0.6 }}>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{c.name}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{
                        backgroundColor: isActive ? 'rgba(16, 185, 129, 0.15)' : '#475569',
                        color: isActive ? '#34d399' : '#cbd5e1',
                        padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600
                      }}>
                        {isActive ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                      <button
                        onClick={() => openEditCategory(c)}
                        style={{ backgroundColor: 'transparent', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: '0.25rem' }}
                        title="Edit Category"
                      >
                        <Edit style={{ width: 16, height: 16 }} />
                      </button>
                      {isActive ? (
                        <button
                          onClick={() => handleDeactivateCategory(c.id)}
                          style={{ backgroundColor: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.25rem' }}
                          title="Deactivate"
                        >
                          <Trash2 style={{ width: 16, height: 16 }} />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReactivateCategory(c.id)}
                          style={{ backgroundColor: 'transparent', border: 'none', color: '#10b981', cursor: 'pointer', padding: '0.25rem' }}
                          title="Reactivate"
                        >
                          <RotateCcw style={{ width: 16, height: 16 }} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {categories.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                    No categories registered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Product Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
        }}>
          <div style={{
            backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
            padding: '2rem', width: '100%', maxWidth: '480px', color: '#f8fafc'
          }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1.25rem' }}>
              {editMode ? 'Edit Product Details' : 'Add Product Section'}
            </h3>
            <form onSubmit={handleSaveProduct} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>SKU Code * {editMode && '(Read-Only)'}</label>
                <input
                  type="text" required value={sku} onChange={e => setSku(e.target.value)} placeholder="e.g. SEC-2TRK-12"
                  disabled={editMode}
                  style={{ width: '100%', backgroundColor: editMode ? '#1e293b' : '#0f172a', border: '1px solid #334155', color: editMode ? '#94a3b8' : 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Product Name *</label>
                <input
                  type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Aluminium Track Section 12ft"
                  style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Product Category (Optional)</label>
                <select
                  value={categoryId} onChange={e => setCategoryId(e.target.value)}
                  style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                >
                  <option value="">-- Select Category --</option>
                  {categories.filter(c => c.isActive).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Final Price (₹ GST-Inclusive) *</label>
                  <input
                    type="number" step="0.01" required value={price} onChange={e => setPrice(e.target.value)} placeholder="1450.00"
                    style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Selling Unit *</label>
                  <select
                    value={unit} onChange={e => setUnit(e.target.value)}
                    style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                  >
                    <option value="RFT">RFT (Running Feet)</option>
                    <option value="FT">FT (Feet)</option>
                    <option value="PCS">PCS (Pieces)</option>
                    <option value="METER">METER</option>
                    <option value="KG">KG</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Barcode (Optional)</label>
                <input
                  type="text" value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="e.g. 890100100008"
                  style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
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
                  {submitting ? 'Saving...' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ODS Import Modal */}
      {showImportModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
        }}>
          <div style={{
            backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
            padding: '2rem', width: '100%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto', color: '#f8fafc'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Upload style={{ color: '#16a34a' }} /> Bulk ODS Product Dataset Ingestion
              </h3>
              <button
                type="button" onClick={() => { setShowImportModal(false); setDryRunResult(null); setImportError(''); }}
                style={{ backgroundColor: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>
                Point the system to your local OpenDocument Spreadsheet (`hardware.ods`) containing the product catalog. 
                This runs a schema & validation check before executing an atomic database transaction.
              </p>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>ODS Spreadsheet File Path *</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                  <input
                    type="text" required value={importFilePath} onChange={e => setImportFilePath(e.target.value)}
                    style={{ flex: 1, backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.55rem', borderRadius: '6px', fontSize: '0.85rem' }}
                  />
                  <button
                    onClick={handleRunDryRun} disabled={dryRunRunning || !importFilePath}
                    style={{
                      backgroundColor: '#2563eb', color: 'white', border: 'none', padding: '0.55rem 1rem', borderRadius: '6px',
                      fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
                    }}
                  >
                    {dryRunRunning ? 'Validating...' : <><Play style={{ width: 14, height: 14 }} /> Run Validation</>}
                  </button>
                </div>
              </div>

              {importError && (
                <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '0.75rem', borderRadius: '6px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle style={{ width: 16, height: 16, flexShrink: 0 }} />
                  <div>{importError}</div>
                </div>
              )}

              {/* Dry Run Results Preview */}
              {dryRunResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '0.5rem' }}>
                  
                  {/* Stats Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
                    <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Total Rows</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{dryRunResult.totalRows}</div>
                    </div>
                    <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.75rem', color: '#4ade80' }}>Valid Rows</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#4ade80' }}>{dryRunResult.validRows}</div>
                    </div>
                    <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.75rem', color: '#facc15' }}>Warnings</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#facc15' }}>{dryRunResult.warningRows}</div>
                    </div>
                    <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.75rem', color: '#f87171' }}>Errors</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f87171' }}>{dryRunResult.errorRows}</div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '1rem' }}>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>New Products Detected:</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#60a5fa' }}>{dryRunResult.newProducts} Products</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Existing SKU Conflicts:</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#facc15' }}>{dryRunResult.existingSkuConflicts} Conflicts</div>
                    </div>
                  </div>

                  {/* Conflict Strategy Picker */}
                  <div>
                    <label style={{ fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 600 }}>SKU Conflict Resolution Strategy</label>
                    <select
                      value={conflictStrategy} onChange={e => setConflictStrategy(e.target.value as ConflictStrategy)}
                      style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.55rem', borderRadius: '6px', marginTop: '0.25rem', fontSize: '0.85rem' }}
                    >
                      <option value="SKIP">SKIP — Skip rows with existing SKU (Default, non-destructive)</option>
                      <option value="UPDATE_EXISTING">UPDATE EXISTING — Overwrite price/name/barcode for existing SKUs</option>
                      <option value="CANCEL_IMPORT">CANCEL — Abort entire import if conflicts are found</option>
                    </select>
                  </div>

                  {/* Warning / Error Log Detail */}
                  {(dryRunResult.warningRows > 0 || dryRunResult.errorRows > 0) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Validation Warnings / Errors Details:</span>
                      <div style={{ maxHeight: '180px', overflowY: 'auto', backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '6px', padding: '0.5rem' }}>
                        {dryRunResult.rows.map((row) => {
                          if (row.warnings.length === 0 && row.errors.length === 0) return null;
                          return (
                            <div key={row.rowNumber} style={{ borderBottom: '1px solid #1e293b', padding: '0.4rem', fontSize: '0.8rem' }}>
                              <span style={{ fontWeight: 700, color: '#94a3b8' }}>Row {row.rowNumber} ({row.sku}): </span>
                              {row.errors.map((e, idx) => (
                                <span key={idx} style={{ color: '#f87171', marginRight: '0.5rem' }}>🛑 {e}</span>
                              ))}
                              {row.warnings.map((w, idx) => (
                                <span key={idx} style={{ color: '#facc15', marginRight: '0.5rem' }}>⚠️ {w}</span>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Commit Action */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <button
                      type="button" onClick={() => { setDryRunResult(null); }}
                      style={{ backgroundColor: '#334155', color: 'white', border: 'none', padding: '0.55rem 1.25rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
                    >
                      Clear Preview
                    </button>
                    <button
                      onClick={handleCommitImport} disabled={committing || dryRunResult.errorRows > 0}
                      style={{
                        backgroundColor: '#16a34a', color: 'white', border: 'none', padding: '0.55rem 1.5rem', borderRadius: '6px',
                        fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
                      }}
                    >
                      {committing ? 'Writing to DB...' : <><CheckCircle2 style={{ width: 15, height: 15 }} /> Commit Ingestion</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Category Modal */}
      {showCategoryModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
        }}>
          <div style={{
            backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
            padding: '2rem', width: '100%', maxWidth: '400px', color: '#f8fafc'
          }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1.25rem' }}>
              {categoryEditMode ? 'Edit Category' : 'Create Category'}
            </h3>
            <form onSubmit={handleSaveCategory} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Category Name *</label>
                <input
                  type="text" required value={categoryName} onChange={e => setCategoryName(e.target.value)} placeholder="e.g. Sections, Screws, Hardware"
                  style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button" onClick={() => setShowCategoryModal(false)}
                  style={{ backgroundColor: '#334155', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ backgroundColor: '#2563eb', color: 'white', border: 'none', padding: '0.5rem 1.25rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Save Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

