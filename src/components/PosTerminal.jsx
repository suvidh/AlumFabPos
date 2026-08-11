import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { 
  Search, ShoppingCart, Plus, Minus, Trash2, User, 
  CreditCard, Banknote, QrCode, Printer, Calculator, Scale, CheckCircle2, X
} from 'lucide-react';
import confetti from 'canvas-confetti';

export default function PosTerminal({ onCompleteSale }) {
  const products = useLiveQuery(() => db.products.toArray(), []) || [];
  const customers = useLiveQuery(() => db.customers.toArray(), []) || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedCustomer, setSelectedCustomer] = useState(customers[0] || null);

  const [cart, setCart] = useState([]);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [chequeNumber, setChequeNumber] = useState('');
  const [paidAmountInput, setPaidAmountInput] = useState('');
  
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [completedInvoice, setCompletedInvoice] = useState(null);

  const searchInputRef = useRef(null);

  // Section Length Calculator state
  const [calculatorItem, setCalculatorItem] = useState(null);
  const [calcLengthFt, setCalcLengthFt] = useState('12');
  const [calcPieces, setCalcPieces] = useState('1');

  // Categories
  const categories = ['All', 'Aluminum Profiles', 'Hardware & Fittings', 'Glass & Accessories'];

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'F2') {
        e.preventDefault();
        if (searchInputRef.current) searchInputRef.current.focus();
      } else if (e.key === 'F8') {
        e.preventDefault();
        if (cart.length > 0 && !showCheckoutModal) {
          setShowCheckoutModal(true);
        }
      } else if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        if (showCheckoutModal) {
          handleProcessSale();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, showCheckoutModal]);

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const addToCart = (product, customWeightKg = null, lengthFt = null, pieces = null) => {
    const existingIndex = cart.findIndex(ci => ci.productId === product.id && ci.finish === product.finish && ci.lengthFt === lengthFt);
    
    let qty = pieces ? parseFloat(pieces) : 1;
    let unitPrice = product.ratePerUnit;
    let totalWeight = customWeightKg ? parseFloat(customWeightKg) : (product.weightPerFt ? product.weightPerFt * (lengthFt || 12) * qty : 0);

    if (product.defaultUnit === 'kg') {
      unitPrice = (totalWeight / qty) * product.ratePerKg;
    }

    if (existingIndex > -1) {
      const updated = [...cart];
      updated[existingIndex].qty += qty;
      updated[existingIndex].totalWeightKg += totalWeight;
      updated[existingIndex].lineTotal = updated[existingIndex].qty * updated[existingIndex].unitPrice;
      setCart(updated);
    } else {
      setCart([
        ...cart,
        {
          productId: product.id,
          code: product.code,
          name: product.name,
          category: product.category,
          finish: product.finish,
          alloy: product.alloy || (product.category === 'Aluminum Profiles' ? '6063-T6' : 'N/A'),
          unit: product.defaultUnit,
          unitPrice: unitPrice,
          ratePerKg: product.ratePerKg,
          ratePerUnit: product.ratePerUnit,
          qty: qty,
          lengthFt: lengthFt,
          totalWeightKg: totalWeight,
          lineTotal: qty * unitPrice,
          taxRate: product.taxRate || 18
        }
      ]);
    }
  };

  const updateCartQty = (index, delta) => {
    const updated = [...cart];
    const newQty = updated[index].qty + delta;
    if (newQty <= 0) {
      updated.splice(index, 1);
    } else {
      updated[index].qty = newQty;
      if (updated[index].unit === 'kg' && updated[index].lengthFt) {
        const singleWeight = updated[index].totalWeightKg / (newQty - delta);
        updated[index].totalWeightKg = singleWeight * newQty;
      }
      updated[index].lineTotal = updated[index].qty * updated[index].unitPrice;
    }
    setCart(updated);
  };

  const removeFromCart = (index) => {
    const updated = [...cart];
    updated.splice(index, 1);
    setCart(updated);
  };

  // Totals calculations
  const subtotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);
  const discountAmount = (subtotal * discountPercent) / 100;
  const taxableTotal = subtotal - discountAmount;
  const taxAmount = (taxableTotal * 0.18); // 18% GST average
  const grandTotal = Math.round(taxableTotal + taxAmount);
  const totalWeightKg = cart.reduce((sum, item) => sum + (item.totalWeightKg || 0), 0);

  const handleOpenCalculator = (product) => {
    setCalculatorItem(product);
    setCalcLengthFt('12');
    setCalcPieces('1');
  };

  const handleAddCalculatedItem = () => {
    if (!calculatorItem) return;
    const lengthFt = parseFloat(calcLengthFt) || 12;
    const pieces = parseFloat(calcPieces) || 1;
    const weightKg = (calculatorItem.weightPerFt || 0.2) * lengthFt * pieces;
    addToCart(calculatorItem, weightKg, lengthFt, pieces);
    setCalculatorItem(null);
  };

  // ATOMIC DATABASE TRANSACTION FOR SALES
  const handleProcessSale = async () => {
    if (cart.length === 0) return;
    if (paymentMethod === 'Cheque' && !chequeNumber.trim()) {
      alert('Cheque Number is mandatory for Cheque sales.');
      return;
    }

    const currentCustomer = selectedCustomer || customers[0];
    const invoiceNo = 'ALF-INV-' + Date.now().toString().slice(-6);

    const invoiceData = {
      invoiceNo,
      date: new Date().toISOString(),
      customerId: currentCustomer ? currentCustomer.id : 1,
      customerName: currentCustomer ? currentCustomer.name : 'Walk-in Retail Customer',
      customerPhone: currentCustomer ? currentCustomer.phone : 'N/A',
      items: cart,
      subtotal,
      discountPercent,
      discountAmount,
      taxAmount,
      total: grandTotal,
      totalWeightKg,
      paymentMethod,
      chequeNumber: paymentMethod === 'Cheque' ? chequeNumber.trim() : null,
      paidAmount: grandTotal,
      status: 'PAID',
      syncStatus: 'LOCAL_ONLY'
    };

    try {
      let createdInvoiceId;
      await db.transaction('rw', [db.invoices, db.customers, db.products], async () => {
        // 1. Create Sales Invoice
        createdInvoiceId = await db.invoices.add(invoiceData);

        // 2. Atomically deduct item stock quantities
        for (const item of cart) {
          const prod = await db.products.get(item.productId);
          if (prod) {
            await db.products.update(prod.id, {
              stockQty: Math.max(0, prod.stockQty - item.qty)
            });
          }
        }
      });

      setCompletedInvoice({ ...invoiceData, id: createdInvoiceId });
      setShowCheckoutModal(false);
      setCart([]);
      setChequeNumber('');
    } catch (err) {
      alert('Sale transaction failed and was safely rolled back: ' + err.message);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: '1.5rem', height: 'calc(100vh - 120px)' }}>
      {/* Left Column: Catalog & Search */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflow: 'hidden' }}>
        {/* Search & Category Filter Header */}
        <div className="glass-panel" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', width: 18, height: 18 }} />
            <input 
              ref={searchInputRef}
              type="text" 
              className="form-input" 
              style={{ paddingLeft: '2.5rem' }} 
              placeholder="Search section, code (e.g. AL-1801) [F2 to focus]..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {categories.map(cat => (
              <button
                key={cat}
                className={`btn btn-sm ${selectedCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Product Cards Grid */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem', paddingRight: '0.25rem' }}>
          {filteredProducts.map(product => (
            <div 
              key={product.id} 
              className="glass-panel" 
              style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                justify: 'space-between', 
                gap: '0.75rem',
                border: '1px solid var(--border-color)',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.2rem' }}>
                  <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>{product.code}</span>
                  <div style={{ display: 'flex', gap: '0.3rem' }}>
                    {product.alloy && product.alloy !== 'N/A' && (
                      <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: 'rgba(59, 130, 246, 0.15)', borderRadius: '4px', color: 'var(--accent-primary)', fontWeight: 600 }}>
                        {product.alloy}
                      </span>
                    )}
                    <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: 'var(--bg-input)', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                      {product.finish}
                    </span>
                  </div>
                </div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: '1.3' }}>{product.name}</h4>
                
                {product.category === 'Aluminum Profiles' && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Scale style={{ width: 14, height: 14 }} /> Weight: {product.weightPerFt} kg/ft
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px dashed var(--border-color)', paddingTop: '0.6rem' }}>
                <div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                    ₹{product.defaultUnit === 'kg' ? product.ratePerKg : product.ratePerUnit}
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 400 }}>/{product.defaultUnit}</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: product.stockQty < 50 ? 'var(--accent-danger)' : 'var(--text-muted)' }}>
                    Stock: {product.stockQty} pcs
                  </div>
                </div>

                {product.category === 'Aluminum Profiles' ? (
                  <button 
                    className="btn btn-secondary btn-sm" 
                    onClick={() => handleOpenCalculator(product)}
                    title="Calculate Profile Length & Weight"
                  >
                    <Calculator style={{ width: 16, height: 16 }} /> Cut Calc
                  </button>
                ) : (
                  <button 
                    className="btn btn-primary btn-sm" 
                    onClick={() => addToCart(product)}
                  >
                    <Plus style={{ width: 16, height: 16 }} /> Add
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Column: Billing Cart & POS Summary */}
      <div className="glass-panel-solid" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Customer Selector Header */}
        <div style={{ paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)', marginBottom: '1rem' }}>
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <User style={{ width: 14, height: 14, color: 'var(--accent-primary)' }} /> Select Customer / Fabricator
            </label>
            <select 
              className="form-select"
              value={selectedCustomer ? selectedCustomer.id : ''}
              onChange={(e) => {
                const found = customers.find(c => c.id === parseInt(e.target.value));
                setSelectedCustomer(found);
              }}
            >
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.outstandingBalance > 0 ? `(Khata: ₹${c.outstandingBalance})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Cart Line Items Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShoppingCart style={{ width: 18, height: 18, color: 'var(--accent-cyan)' }} /> Current Order
          </h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{cart.length} item(s)</span>
        </div>

        {/* Cart Line Items List */}
        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.5rem', marginBottom: '1rem' }}>
          {cart.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
              <ShoppingCart style={{ width: 42, height: 42, strokeWidth: 1.5, marginBottom: '0.5rem', opacity: 0.5 }} />
              <p style={{ fontSize: '0.9rem' }}>Cart is empty</p>
              <p style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>Select profiles or hardware from the catalog to start billing</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {cart.map((item, idx) => (
                <div key={idx} style={{ background: 'var(--bg-input)', padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{item.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {item.alloy && item.alloy !== 'N/A' && <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>Alloy: {item.alloy}</span>}
                        <span>Finish: {item.finish}</span>
                        {item.lengthFt && <span>Length: {item.lengthFt} ft</span>}
                        {item.totalWeightKg > 0 && <span>Wt: {item.totalWeightKg.toFixed(2)} kg</span>}
                      </div>
                    </div>
                    <button 
                      onClick={() => removeFromCart(idx)} 
                      style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', opacity: 0.8 }}
                    >
                      <Trash2 style={{ width: 16, height: 16 }} />
                    </button>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <button className="btn btn-secondary btn-sm" style={{ padding: '0.15rem 0.4rem' }} onClick={() => updateCartQty(idx, -1)}><Minus style={{ width: 12, height: 12 }} /></button>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: '24px', textAlign: 'center' }}>{item.qty}</span>
                      <button className="btn btn-secondary btn-sm" style={{ padding: '0.15rem 0.4rem' }} onClick={() => updateCartQty(idx, 1)}><Plus style={{ width: 12, height: 12 }} /></button>
                    </div>

                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                      ₹{item.lineTotal.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Order Summary & Pricing Breakdown */}
        <div style={{ background: 'var(--bg-input)', padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <span>Total Material Weight:</span>
            <span className="font-mono" style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{totalWeightKg.toFixed(2)} kg</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <span>Subtotal:</span>
            <span>₹{subtotal.toFixed(2)}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <span>Discount (%):</span>
            <input 
              type="number" 
              min="0" 
              max="100" 
              value={discountPercent} 
              onChange={(e) => setDiscountPercent(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
              style={{ width: '60px', padding: '0.2rem 0.4rem', background: 'var(--bg-card-solid)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', textAlign: 'right' }} 
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <span>GST Tax (18%):</span>
            <span>₹{taxAmount.toFixed(2)}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem', marginTop: '0.2rem' }}>
            <span>Grand Total:</span>
            <span style={{ color: 'var(--accent-success)' }}>₹{grandTotal.toLocaleString()}</span>
          </div>
        </div>

        {/* Action Button */}
        <button 
          className="btn btn-primary" 
          style={{ width: '100%', padding: '0.85rem', fontSize: '1rem', fontWeight: 700 }}
          disabled={cart.length === 0}
          onClick={() => {
            setPaidAmountInput(grandTotal.toString());
            setShowCheckoutModal(true);
          }}
        >
          <CreditCard style={{ width: 20, height: 20 }} /> Proceed to Pay & Bill (F8)
        </button>
      </div>

      {/* Section Cut Calculator Modal */}
      {calculatorItem && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calculator style={{ color: 'var(--accent-cyan)' }} /> Section Weight Calculator
              </h3>
              <button onClick={() => setCalculatorItem(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X /></button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              <strong>{calculatorItem.name}</strong> ({calculatorItem.code})  
              <br />Unit Weight: <span style={{ color: 'var(--accent-cyan)' }}>{calculatorItem.weightPerFt} kg/ft</span> @ ₹{calculatorItem.ratePerKg}/kg
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Profile Length per Piece (Feet)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={calcLengthFt}
                  onChange={(e) => setCalcLengthFt(e.target.value)}
                  placeholder="e.g. 12 or 14.5"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Number of Pieces</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={calcPieces}
                  onChange={(e) => setCalcPieces(e.target.value)}
                  placeholder="e.g. 2"
                />
              </div>

              <div style={{ background: 'var(--bg-input)', padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Estimated Calculation:</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
                  Total Length: <span style={{ color: 'var(--accent-primary)' }}>{(parseFloat(calcLengthFt || 0) * parseFloat(calcPieces || 0)).toFixed(1)} ft</span>
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent-success)', marginTop: '0.2rem' }}>
                  Total Weight: {((calculatorItem.weightPerFt || 0) * parseFloat(calcLengthFt || 0) * parseFloat(calcPieces || 0)).toFixed(2)} kg
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setCalculatorItem(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddCalculatedItem}>Add to Invoice</button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout & Payment Modal */}
      {showCheckoutModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Complete Sale & Collect Payment</h3>
              <button onClick={() => setShowCheckoutModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X /></button>
            </div>

            <div style={{ background: 'var(--bg-input)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.25rem', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                <span>Customer:</span>
                <strong>{selectedCustomer ? selectedCustomer.name : 'Walk-in Retail Customer'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: 800 }}>
                <span>Total Amount Due:</span>
                <span style={{ color: 'var(--accent-success)' }}>₹{grandTotal.toLocaleString()}</span>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '1.25rem' }}>
              <label className="form-label">Payment Method</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
                {[
                  { mode: 'Cash', icon: Banknote },
                  { mode: 'Cheque', icon: CreditCard }
                ].map(({ mode, icon: Icon }) => (
                  <button
                    key={mode}
                    className={`btn ${paymentMethod === mode ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flexDirection: 'column', gap: '0.3rem', padding: '0.85rem 0.5rem', fontSize: '0.85rem' }}
                    onClick={() => setPaymentMethod(mode)}
                  >
                    <Icon style={{ width: 22, height: 22 }} />
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {paymentMethod === 'Cheque' && (
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label" style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>
                  Cheque Number (Mandatory) *
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 123456"
                  value={chequeNumber}
                  onChange={(e) => setChequeNumber(e.target.value)}
                  autoFocus
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setShowCheckoutModal(false)}>Cancel</button>
              <button className="btn btn-success" style={{ paddingLeft: '1.5rem', paddingRight: '1.5rem' }} onClick={handleProcessSale}>
                <CheckCircle2 style={{ width: 18, height: 18 }} /> Confirm Sale & Print Receipt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Completed Invoice Printable Receipt Preview Modal */}
      {completedInvoice && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-success)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle2 /> Sale Completed Successfully!
              </h3>
              <button onClick={() => setCompletedInvoice(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X /></button>
            </div>

            <div className="printable-receipt" style={{ background: '#ffffff', color: '#000000', padding: '1rem', borderRadius: 'var(--radius-md)', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', lineHeight: '1.4' }}>
              <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '0.25rem' }}>ALUMFAB HARDWARE & PROFILES</div>
              <div style={{ textAlign: 'center', fontSize: '0.75rem', marginBottom: '0.75rem' }}>TAX INVOICE / RECEIPT</div>
              <div style={{ borderBottom: '1px dashed #000', marginBottom: '0.5rem' }}></div>
              <div>Invoice No: {completedInvoice.invoiceNo}</div>
              <div>Date: {new Date(completedInvoice.date).toLocaleString()}</div>
              <div>Customer: {completedInvoice.customerName}</div>
              <div>Payment: {completedInvoice.paymentMethod}</div>
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
                  {completedInvoice.items.map((item, i) => (
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
                <span>Total Weight:</span>
                <span>{completedInvoice.totalWeightKg.toFixed(2)} kg</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Subtotal:</span>
                <span>₹{completedInvoice.subtotal.toFixed(0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>GST Tax (18%):</span>
                <span>₹{completedInvoice.taxAmount.toFixed(0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '0.95rem', marginTop: '0.25rem' }}>
                <span>Grand Total:</span>
                <span>₹{completedInvoice.total.toLocaleString()}</span>
              </div>
              <div style={{ borderBottom: '1px dashed #000', margin: '0.5rem 0' }}></div>
              <div style={{ textAlign: 'center', fontSize: '0.7rem', marginTop: '0.5rem' }}>Thank you for doing business with AlumFab!</div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button className="btn btn-secondary" onClick={() => setCompletedInvoice(null)}>Close</button>
              <button className="btn btn-primary" onClick={() => window.print()}>
                <Printer style={{ width: 18, height: 18 }} /> Print Thermal Receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
