import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { 
  Search, ShoppingCart, Plus, Minus, Trash2, User, 
  CreditCard, Banknote, Printer, Calculator, Scale, CheckCircle2, X,
  Monitor, Keyboard, RefreshCw, FolderOpen, Save
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { AudioFeedbackService } from '../services/audioFeedback';

export default function PosTerminal({ onCompleteSale }) {
  // Dexie local cache queries
  const products = useLiveQuery(() => db.products.toArray(), []) || [];
  const customers = useLiveQuery(() => db.customers.toArray(), []) || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedCustomer, setSelectedCustomer] = useState(customers[0] || null);

  // Cart & State Management
  const [cart, setCart] = useState([]);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [chequeNumber, setChequeNumber] = useState('');
  const [paidAmountInput, setPaidAmountInput] = useState('');
  
  // Modals & UI States
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [completedInvoice, setCompletedInvoice] = useState(null);
  const [calculatorItem, setCalculatorItem] = useState(null);
  const [calcLengthFt, setCalcLengthFt] = useState('12');
  const [calcPieces, setCalcPieces] = useState('1');

  // Keyboard navigation & Hold/Recall states
  const [activeCartIndex, setActiveCartIndex] = useState(0);
  const [heldSales, setHeldSales] = useState([]);
  const [showRecallModal, setShowRecallModal] = useState(false);

  const searchInputRef = useRef(null);

  const categories = ['All', 'Aluminum Profiles', 'Hardware & Fittings', 'Glass & Accessories'];

  // Global Barcode Scanner Event Subscriber
  useEffect(() => {
    const handleBarcodeScan = (e) => {
      const scanned = e.detail; // ScannedBarcodeResult
      
      // Look up matching product in local index
      const matchedProduct = products.find(p => p.code === scanned.itemCode || p.barcode === scanned.barcode);
      
      if (matchedProduct) {
        const weight = scanned.type === 'WEIGHT_SCALE' ? scanned.weightDecimal : null;
        addToCart(matchedProduct, weight);
        console.log(`[PosTerminal] Added product ${matchedProduct.name} to cart via barcode scan.`);
      } else {
        console.warn(`[PosTerminal] Scanned item code '${scanned.itemCode}' / barcode '${scanned.barcode}' not found in product index.`);
        AudioFeedbackService.playErrorBeep();
      }
    };

    window.addEventListener('globalBarcodeScanned', handleBarcodeScan);
    return () => window.removeEventListener('globalBarcodeScanned', handleBarcodeScan);
  }, [products, cart]);

  // Keyboard-First Hotkeys & Navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 1. Skip hotkey interceptors if any overlay modal is open or if user is active in an input field
      const active = document.activeElement;
      const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');

      // F-Keys are always intercepted globally unless standard browser action is needed
      if (e.key === 'F2') {
        e.preventDefault();
        if (isTyping && active !== searchInputRef.current) {
          // If typing somewhere else, let standard focus work
          return;
        }
        handleHoldSale();
      } else if (e.key === 'F4') {
        e.preventDefault();
        setShowRecallModal(true);
      } else if (e.key === 'F8') {
        e.preventDefault();
        if (cart.length > 0 && !showCheckoutModal) {
          setPaidAmountInput(grandTotal.toString());
          setShowCheckoutModal(true);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (showCheckoutModal) {
          setShowCheckoutModal(false);
        } else if (showRecallModal) {
          setShowRecallModal(false);
        } else if (calculatorItem) {
          setCalculatorItem(null);
        } else {
          // Default escape: clear search query, if empty, clear cart
          if (searchQuery) {
            setSearchQuery('');
          } else {
            handleClearCart();
          }
        }
      }

      // If user is actively typing in a search bar or forms, do not hijack arrows/plus/delete
      if (isTyping && active === searchInputRef.current && e.key === 'Enter') {
        // Search enter: if there is exactly one filtered product, add it to cart
        if (filteredProducts.length === 1) {
          e.preventDefault();
          addToCart(filteredProducts[0]);
          setSearchQuery('');
        }
        return;
      }

      if (isTyping) {
        return;
      }

      // Cart navigation via keyboard arrows
      if (cart.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveCartIndex((prev) => (prev + 1) % cart.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveCartIndex((prev) => (prev - 1 + cart.length) % cart.length);
        } else if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          updateCartQty(activeCartIndex, 1);
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          updateCartQty(activeCartIndex, -1);
        } else if (e.key === 'Delete') {
          e.preventDefault();
          removeFromCart(activeCartIndex);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, showCheckoutModal, showRecallModal, calculatorItem, searchQuery, activeCartIndex, selectedCustomer, products]);

  // Keep active index in bounds of cart changes
  useEffect(() => {
    if (cart.length === 0) {
      setActiveCartIndex(0);
    } else if (activeCartIndex >= cart.length) {
      setActiveCartIndex(cart.length - 1);
    }
  }, [cart, activeCartIndex]);

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const addToCart = (product, customWeightKg = null, lengthFt = null, pieces = null) => {
    // For profiles, match item by ID, finish, and length to allow cut tracking
    const existingIndex = cart.findIndex(ci => 
      ci.productId === product.id && 
      ci.finish === product.finish && 
      ci.lengthFt === lengthFt
    );
    
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
      // Recalculate line total with line discount
      const baseTotal = updated[existingIndex].qty * updated[existingIndex].unitPrice;
      updated[existingIndex].lineTotal = baseTotal * (1 - (updated[existingIndex].lineDiscountPercent || 0) / 100);
      setCart(updated);
      setActiveCartIndex(existingIndex);
    } else {
      const newItem = {
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
        lineDiscountPercent: 0,
        lineTotal: qty * unitPrice,
        taxRate: product.taxRate || 18
      };
      setCart([...cart, newItem]);
      setActiveCartIndex(cart.length); // Select new item
    }
  };

  const updateCartQty = (index, delta) => {
    if (cart.length === 0 || index < 0 || index >= cart.length) return;
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
      const baseTotal = updated[index].qty * updated[index].unitPrice;
      updated[index].lineTotal = baseTotal * (1 - (updated[index].lineDiscountPercent || 0) / 100);
    }
    setCart(updated);
  };

  const updateLineDiscount = (index, discountVal) => {
    if (index < 0 || index >= cart.length) return;
    const updated = [...cart];
    const percent = Math.max(0, Math.min(100, discountVal || 0));
    updated[index].lineDiscountPercent = percent;
    const baseTotal = updated[index].qty * updated[index].unitPrice;
    updated[index].lineTotal = baseTotal * (1 - percent / 100);
    setCart(updated);
  };

  const removeFromCart = (index) => {
    if (cart.length === 0 || index < 0 || index >= cart.length) return;
    const updated = [...cart];
    updated.splice(index, 1);
    setCart(updated);
  };

  const handleClearCart = () => {
    setCart([]);
    setDiscountPercent(0);
    setActiveCartIndex(0);
  };

  // Hold Sale mechanism
  const handleHoldSale = () => {
    if (cart.length === 0) return;
    const holdItem = {
      id: Date.now(),
      cart,
      selectedCustomer,
      discountPercent,
      subtotal,
      grandTotal,
      time: new Date()
    };
    setHeldSales([holdItem, ...heldSales]);
    setCart([]);
    setDiscountPercent(0);
    AudioFeedbackService.playSuccessBeep();
  };

  const handleRecallSale = (heldItem) => {
    setCart(heldItem.cart);
    setSelectedCustomer(heldItem.selectedCustomer);
    setDiscountPercent(heldItem.discountPercent);
    setHeldSales(heldSales.filter(h => h.id !== heldItem.id));
    setShowRecallModal(false);
    AudioFeedbackService.playSuccessBeep();
  };

  // Subtotal, Discount, Tax and Totals Math
  const subtotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);
  const discountAmount = (subtotal * discountPercent) / 100;
  const taxableTotal = subtotal - discountAmount;
  const taxAmount = (taxableTotal * 0.18); // 18% average GST
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

  // Process completed sale transaction (Offline Dexie)  const [activeBranch, setActiveBranch] = useState(null);
  const [cashTendered, setCashTendered] = useState('0');
  const [cardPaid, setCardPaid] = useState('0');
  const [upiPaid, setUpiPaid] = useState('0');
  const [creditPaid, setCreditPaid] = useState('0');
  const [chequePaid, setChequePaid] = useState('0');
  const [localChequeNo, setLocalChequeNo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function loadActiveBranch() {
      try {
        const branches = await api.getAllBranches();
        if (branches && branches.length > 0) {
          setActiveBranch(branches[0]);
        }
      } catch (e) {
        console.error('Failed to load branches:', e);
      }
    }
    loadActiveBranch();
  }, []);

  // Split payment math
  const valCard = parseFloat(cardPaid) || 0;
  const valUpi = parseFloat(upiPaid) || 0;
  const valCredit = parseFloat(creditPaid) || 0;
  const valCheque = parseFloat(chequePaid) || 0;
  const valCashTendered = parseFloat(cashTendered) || 0;

  const nonCashAllocated = valCard + valUpi + valCredit + valCheque;
  const cashAllocated = Math.max(0, grandTotal - nonCashAllocated);
  const changeDue = valCashTendered >= cashAllocated ? valCashTendered - cashAllocated : 0;
  const actualCashPaid = valCashTendered >= cashAllocated ? cashAllocated : valCashTendered;

  const totalAllocated = nonCashAllocated + actualCashPaid;
  const remainingBalance = Math.max(0, grandTotal - totalAllocated);

  const resetPaymentFields = (total = 0) => {
    setCashTendered(total.toString());
    setCardPaid('0');
    setUpiPaid('0');
    setCreditPaid('0');
    setChequePaid('0');
    setLocalChequeNo('');
  };

  const handleProcessSale = async () => {
    if (cart.length === 0) return;
    if (remainingBalance > 0) {
      alert(`Cannot checkout. Remaining balance of ₹${remainingBalance.toFixed(2)} must be allocated.`);
      return;
    }
    if (valCheque > 0 && !localChequeNo.trim()) {
      alert('Cheque Number is mandatory for Cheque payments.');
      return;
    }

    setIsSubmitting(true);

    const paymentSplits = [];
    if (actualCashPaid > 0) paymentSplits.push({ method: 'CASH', amountRupees: actualCashPaid });
    if (valCard > 0) paymentSplits.push({ method: 'CARD', amountRupees: valCard });
    if (valUpi > 0) paymentSplits.push({ method: 'UPI', amountRupees: valUpi });
    if (valCredit > 0) paymentSplits.push({ method: 'CREDIT', amountRupees: valCredit });
    if (valCheque > 0) paymentSplits.push({ method: 'CHEQUE', amountRupees: valCheque, chequeNumber: localChequeNo });

    const offlineUuid = 'off-' + Date.now().toString() + '-' + Math.random().toString(36).substring(2, 11);

    const payload = {
      branchId: activeBranch ? activeBranch.id : 'branch-a-id',
      customerId: selectedCustomer ? selectedCustomer.id : undefined,
      items: cart.map(item => ({
        productId: item.productId,
        quantityDecimal: item.qty,
        rateRupees: item.unitPrice,
        discountRupees: (item.qty * item.unitPrice * (item.lineDiscountPercent || 0)) / 100
      })),
      discountType: 'PERCENTAGE',
      discountValueBasisPoints: discountPercent * 100,
      payments: paymentSplits,
      offlineUuid
    };

    try {
      let resultSale;
      
      // Attempt online checkout via SQLite / Prisma if connected
      if (navigator.onLine) {
        try {
          resultSale = await api.createSale(payload);
        } catch (e) {
          console.warn('Online checkout failed, falling back to local offline caching:', e.message);
        }
      }

      // Write to IndexedDB local Dexie store (LOCAL_ONLY acts as OfflinePendingQueue)
      const invoiceData = {
        invoiceNo: resultSale ? resultSale.invoiceNumber : 'OFF-' + Date.now().toString().slice(-6),
        date: resultSale ? resultSale.createdAt : new Date().toISOString(),
        customerId: selectedCustomer ? selectedCustomer.id : 1,
        customerName: selectedCustomer ? selectedCustomer.name : 'Walk-in Retail Customer',
        customerPhone: selectedCustomer ? selectedCustomer.phone : 'N/A',
        items: cart,
        subtotal,
        discountPercent,
        discountAmount,
        taxAmount,
        total: grandTotal,
        totalWeightKg,
        paymentMethod: paymentSplits.map(p => p.method).join(' + '),
        paidAmount: grandTotal,
        status: 'PAID',
        syncStatus: resultSale ? 'SYNCED' : 'LOCAL_ONLY',
        offlineUuid,
        payments: paymentSplits,
        branchId: activeBranch ? activeBranch.id : 'branch-a-id'
      };
      
      await db.invoices.add(invoiceData);

      confetti({ particleCount: 80, spread: 60, origin: { y: 0.8 } });
      setCompletedInvoice(invoiceData);
      setShowCheckoutModal(false);
      setCart([]);
      resetPaymentFields();

      if (!resultSale) {
        alert('Server connection offline. Invoice successfully queued locally in OfflinePendingQueue.');
      }
    } catch (err) {
      alert('Sale checkout failed: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', gap: '1rem' }}>
      
      {/* Top Header Stats bar */}
      <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 1.2rem', borderRadius: 'var(--radius-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
            <Monitor style={{ width: 16, height: 16, color: 'var(--accent-cyan)' }} />
            <span style={{ color: 'var(--text-muted)' }}>Terminal:</span>
            <strong style={{ color: 'var(--text-primary)' }}>TERM-01</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
            <User style={{ width: 16, height: 16, color: 'var(--accent-cyan)' }} />
            <span style={{ color: 'var(--text-muted)' }}>Cashier:</span>
            <strong style={{ color: 'var(--text-primary)' }}>Supervisor</strong>
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.03)', padding: '0.2rem 0.6rem', borderRadius: '4px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Keyboard style={{ width: 14, height: 14 }} />
            <span>F2 Hold | F4 Recall | F8 Pay | Esc Clear</span>
          </div>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} title="Secure DB connection active"></span>
          <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600, textTransform: 'uppercase' }}>SQLite Active</span>
        </div>
      </div>

      {/* Main Terminal Split layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 450px', gap: '1.25rem', flex: 1, overflow: 'hidden' }}>
        
        {/* Left Hand: Interactive Cart (60%) */}
        <div className="glass-panel-solid" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          
          <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShoppingCart style={{ width: 18, height: 18, color: 'var(--accent-cyan)' }} /> Checkout Cart
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--bg-input)', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>
              {cart.length} Row(s)
            </span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
            {cart.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
                <Keyboard style={{ width: 48, height: 48, strokeWidth: 1.5, marginBottom: '0.75rem', opacity: 0.4, color: 'var(--accent-cyan)' }} />
                <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Ready for Scan input</p>
                <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Scan barcodes or click catalog products to append items.<br/>Use F2 to hold, F4 to recall transactions.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left', fontSize: '0.75rem' }}>
                    <th style={{ padding: '0.5rem' }}>#</th>
                    <th style={{ padding: '0.5rem' }}>SKU/Barcode</th>
                    <th style={{ padding: '0.5rem' }}>Item Description</th>
                    <th style={{ padding: '0.5rem', textAlign: 'right' }}>Price</th>
                    <th style={{ padding: '0.5rem', textAlign: 'center' }}>Qty</th>
                    <th style={{ padding: '0.5rem', textAlign: 'center', width: '80px' }}>Disc %</th>
                    <th style={{ padding: '0.5rem', textAlign: 'right' }}>Total</th>
                    <th style={{ padding: '0.5rem', textAlign: 'center' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item, idx) => {
                    const isActive = idx === activeCartIndex;
                    return (
                      <tr 
                        key={idx} 
                        onClick={() => setActiveCartIndex(idx)}
                        style={{ 
                          borderBottom: '1px solid var(--border-color)',
                          cursor: 'pointer',
                          background: isActive ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                          boxShadow: isActive ? 'inset 2px 0 0 var(--accent-cyan)' : 'none',
                          transition: 'background 0.15s ease'
                        }}
                      >
                        <td style={{ padding: '0.65rem 0.5rem', fontWeight: 600, color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                          {isActive ? '👉' : idx + 1}
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{item.code}</td>
                        <td style={{ padding: '0.65rem 0.5rem' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.name}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', gap: '0.4rem', marginTop: '0.1rem' }}>
                            {item.finish && <span>{item.finish}</span>}
                            {item.lengthFt && <span>{item.lengthFt} ft</span>}
                            {item.totalWeightKg > 0 && <span>{item.totalWeightKg.toFixed(2)} kg</span>}
                          </div>
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontWeight: 500 }}>₹{item.unitPrice.toFixed(2)}</td>
                        <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'var(--bg-input)', padding: '0.15rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                            <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }} onClick={(e) => { e.stopPropagation(); updateCartQty(idx, -1); }}><Minus style={{ width: 12, height: 12 }} /></button>
                            <span style={{ fontWeight: 700, minWidth: '16px', color: 'var(--text-primary)', fontSize: '0.8rem' }}>{item.qty}</span>
                            <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }} onClick={(e) => { e.stopPropagation(); updateCartQty(idx, 1); }}><Plus style={{ width: 12, height: 12 }} /></button>
                          </div>
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                          <input 
                            type="number"
                            min="0"
                            max="100"
                            value={item.lineDiscountPercent || 0}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => updateLineDiscount(idx, parseFloat(e.target.value) || 0)}
                            style={{ 
                              width: '48px', 
                              padding: '0.15rem 0.25rem', 
                              background: 'var(--bg-card-solid)', 
                              border: '1px solid var(--border-color)', 
                              borderRadius: '4px', 
                              color: 'var(--text-primary)', 
                              textAlign: 'center',
                              fontSize: '0.75rem'
                            }}
                          />
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontWeight: 700, color: 'var(--accent-primary)' }}>₹{item.lineTotal.toFixed(2)}</td>
                        <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                          <button 
                            onClick={(e) => { e.stopPropagation(); removeFromCart(idx); }}
                            style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', opacity: 0.7 }}
                            title="Remove Row (Del)"
                          >
                            <Trash2 style={{ width: 14, height: 14 }} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right Hand: Search, Product Grid, Customer (40%) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflow: 'hidden' }}>
          
          {/* Customer panel */}
          <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
                <User style={{ width: 14, height: 14, color: 'var(--accent-cyan)' }} /> Active Fabricator / Customer
              </label>
              <select 
                className="form-select"
                style={{ fontSize: '0.85rem', padding: '0.4rem' }}
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

          {/* Catalog panel */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '0.75rem', overflow: 'hidden' }}>
            
            {/* Search */}
            <div style={{ position: 'relative' }}>
              <Search style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', width: 16, height: 16 }} />
              <input 
                ref={searchInputRef}
                type="text" 
                className="form-input" 
                style={{ paddingLeft: '2.2rem', paddingRight: '0.5rem', fontSize: '0.85rem' }} 
                placeholder="Type item name/SKU... (F2 to Hold/Search)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Category tabs */}
            <div style={{ display: 'flex', gap: '0.25rem', overflowX: 'auto', paddingBottom: '0.2rem' }}>
              {categories.map(cat => (
                <button
                  key={cat}
                  className={`btn btn-sm ${selectedCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', flexShrink: 0 }}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Grid */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {filteredProducts.map(product => (
                <div 
                  key={product.id} 
                  className="glass-panel" 
                  onClick={() => {
                    if (product.category === 'Aluminum Profiles') {
                      handleOpenCalculator(product);
                    } else {
                      addToCart(product);
                    }
                  }}
                  style={{ 
                    padding: '0.5rem 0.75rem',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(255,255,255,0.01)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>{product.code}</span>
                      <span style={{ fontSize: '0.65rem', padding: '0.05rem 0.25rem', background: 'var(--bg-input)', borderRadius: '4px', color: 'var(--text-muted)' }}>{product.finish}</span>
                    </div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{product.name}</span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                        ₹{product.defaultUnit === 'kg' ? product.ratePerKg : product.ratePerUnit}
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>/{product.defaultUnit}</span>
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Stock: {product.stockQty}</div>
                    </div>
                    {product.category === 'Aluminum Profiles' ? (
                      <Calculator style={{ width: 16, height: 16, color: 'var(--text-muted)' }} />
                    ) : (
                      <Plus style={{ width: 16, height: 16, color: 'var(--text-muted)' }} />
                    )}
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>

      </div>

      {/* Bottom Panel Checkout Summary & Action Buttons */}
      <div className="glass-panel" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1.5rem', padding: '0.85rem 1.2rem', borderRadius: 'var(--radius-md)' }}>
        
        {/* Actions Button Panel */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button 
            className="btn btn-secondary" 
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', padding: '0.7rem 1.1rem' }}
            onClick={handleHoldSale}
            disabled={cart.length === 0}
          >
            <Save style={{ width: 16, height: 16, color: 'var(--accent-cyan)' }} />
            <span>Hold Bill (F2)</span>
          </button>
          
          <button 
            className="btn btn-secondary" 
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', padding: '0.7rem 1.1rem' }}
            onClick={() => setShowRecallModal(true)}
            disabled={heldSales.length === 0}
          >
            <FolderOpen style={{ width: 16, height: 16, color: 'var(--accent-cyan)' }} />
            <span>Recall Bill ({heldSales.length}) (F4)</span>
          </button>

          <button 
            className="btn btn-danger" 
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', padding: '0.7rem 1.1rem' }}
            onClick={handleClearCart}
            disabled={cart.length === 0}
          >
            <Trash2 style={{ width: 16, height: 16 }} />
            <span>Clear Cart (Esc)</span>
          </button>
        </div>

        {/* Subtotals & Final grand totals */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', textAlign: 'right' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Material Weight: {totalWeightKg.toFixed(2)} kg</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Subtotal: ₹{subtotal.toFixed(2)} (Tax included)</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'flex-end', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span>Disc (%):</span>
              <input 
                type="number" 
                min="0" 
                max="100" 
                value={discountPercent} 
                onChange={(e) => setDiscountPercent(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                style={{ width: '42px', padding: '0.05rem 0.2rem', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', textAlign: 'right', fontSize: '0.75rem' }} 
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <button 
              className="btn btn-primary" 
              style={{ padding: '0.85rem 1.5rem', fontSize: '1rem', fontWeight: 700, gap: '0.5rem' }}
              disabled={cart.length === 0}
              onClick={() => {
                setPaidAmountInput(grandTotal.toString());
                setShowCheckoutModal(true);
              }}
            >
              <CreditCard style={{ width: 20, height: 20 }} /> Pay & Bill (F8)
            </button>
          </div>
        </div>

      </div>

      {/* Held Sales Recall Modal */}
      {showRecallModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FolderOpen style={{ color: 'var(--accent-cyan)' }} /> Recall Suspended Sales
              </h3>
              <button onClick={() => setShowRecallModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X /></button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Select a held invoice sequence to reload details back to checkout desk.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '300px', overflowY: 'auto', marginBottom: '1.25rem' }}>
              {heldSales.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  No transactions currently suspended.
                </div>
              ) : (
                heldSales.map((held) => (
                  <div 
                    key={held.id} 
                    onClick={() => handleRecallSale(held)}
                    style={{ 
                      background: 'var(--bg-input)', 
                      padding: '0.75rem 1rem', 
                      borderRadius: 'var(--radius-md)', 
                      border: '1px solid var(--border-color)', 
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {held.selectedCustomer ? held.selectedCustomer.name : 'Walk-in Customer'}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        Saved: {held.time.toLocaleTimeString()} | Rows: {held.cart.length}
                      </div>
                    </div>
                    <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--accent-success)' }}>
                      ₹{held.grandTotal}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowRecallModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Section Cut Calculator Modal */}
      {calculatorItem && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calculator style={{ color: 'var(--accent-cyan)' }} /> Profile Cut Calculator
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
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
                  Total Length: <span style={{ color: 'var(--accent-primary)' }}>{(parseFloat(calcLengthFt || 0) * parseFloat(calcPieces || 0)).toFixed(1)} ft</span>
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent-success)', marginTop: '0.2rem' }}>
                  Total Weight: {((calculatorItem.weightPerFt || 0) * parseFloat(calcLengthFt || 0) * parseFloat(calcPieces || 0)).toFixed(2)} kg
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setCalculatorItem(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddCalculatedItem}>Add to Invoice</button>
            </div>
          </div>
            {/* Checkout & Payment Modal */}
      {showCheckoutModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CreditCard style={{ color: 'var(--accent-cyan)' }} /> Split Payment Checkout
              </h3>
              <button onClick={() => setShowCheckoutModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} disabled={isSubmitting}><X /></button>
            </div>

            <div style={{ background: 'var(--bg-input)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Customer Account:</div>
                <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>{selectedCustomer ? selectedCustomer.name : 'Walk-in Retail Customer'}</strong>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Bill:</div>
                <strong style={{ fontSize: '1.2rem', color: 'var(--accent-success)' }}>₹{grandTotal.toLocaleString()}</strong>
              </div>
            </div>

            {/* Split payments input list */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Cash Tendered (₹)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  style={{ fontSize: '0.85rem', padding: '0.4rem' }} 
                  value={cashTendered}
                  onChange={(e) => setCashTendered(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Card Payment (₹)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  style={{ fontSize: '0.85rem', padding: '0.4rem' }} 
                  value={cardPaid}
                  onChange={(e) => setCardPaid(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Digital UPI/Wallet (₹)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  style={{ fontSize: '0.85rem', padding: '0.4rem' }} 
                  value={upiPaid}
                  onChange={(e) => setUpiPaid(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Cheque Amount (₹)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  style={{ fontSize: '0.85rem', padding: '0.4rem' }} 
                  value={chequePaid}
                  onChange={(e) => setChequePaid(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Cheque specifications */}
            {valCheque > 0 && (
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label" style={{ color: 'var(--accent-primary)', fontSize: '0.75rem', fontWeight: 700 }}>
                  Cheque Number (Mandatory) *
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={{ fontSize: '0.85rem', padding: '0.4rem' }}
                  placeholder="Enter 6-digit cheque number"
                  value={localChequeNo}
                  onChange={(e) => setLocalChequeNo(e.target.value)}
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>
            )}

            {/* Credit Sale */}
            <div className="form-group" style={{ marginBottom: '1.25rem' }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Charge Store Credit / On-Account (₹)</label>
              {selectedCustomer && selectedCustomer.creditLimitPaise > 0 ? (
                <div>
                  <input 
                    type="number" 
                    className="form-input" 
                    style={{ fontSize: '0.85rem', padding: '0.4rem' }} 
                    value={creditPaid}
                    onChange={(e) => setCreditPaid(e.target.value)}
                    disabled={isSubmitting}
                  />
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    Available credit: ₹{(selectedCustomer.creditLimitPaise - selectedCustomer.outstandingBalancePaise) / 100}
                  </div>
                </div>
              ) : (
                <div>
                  <input 
                    type="number" 
                    className="form-input" 
                    style={{ fontSize: '0.85rem', padding: '0.4rem' }} 
                    value="0" 
                    disabled 
                  />
                  <div style={{ fontSize: '0.7rem', color: 'var(--accent-danger)', marginTop: '0.2rem' }}>
                    Credit disabled (Cash-only profile). Assign customer with active credit limit to enable.
                  </div>
                </div>
              )}
            </div>

            {/* Real-time Math summaries */}
            <div style={{ background: 'var(--bg-input)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', border: '1px solid var(--border-color)', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', fontSize: '0.85rem' }}>
              <div style={{ color: 'var(--text-secondary)' }}>
                Allocated Paid: <strong>₹{totalAllocated.toFixed(2)}</strong>
              </div>
              <div style={{ textAlign: 'right', color: changeDue > 0 ? '#10b981' : 'var(--text-secondary)' }}>
                Change Due: <strong style={{ color: changeDue > 0 ? '#10b981' : 'inherit' }}>₹{changeDue.toFixed(2)}</strong>
              </div>
              <div style={{ color: 'var(--text-secondary)', gridColumn: 'span 2', borderTop: '1px dashed var(--border-color)', paddingTop: '0.4rem', marginTop: '0.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Remaining Balance Due:</span>
                <strong style={{ fontSize: '0.95rem', color: remainingBalance > 0 ? 'var(--accent-danger)' : '#10b981' }}>
                  ₹{remainingBalance.toFixed(2)}
                </strong>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowCheckoutModal(false)} disabled={isSubmitting}>Cancel</button>
              <button 
                className="btn btn-success" 
                style={{ paddingLeft: '1.5rem', paddingRight: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }} 
                onClick={handleProcessSale}
                disabled={remainingBalance > 0 || isSubmitting || (valCheque > 0 && !localChequeNo.trim())}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="animate-spin" style={{ width: 18, height: 18 }} />
                    <span>Processing Sale...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 style={{ width: 18, height: 18 }} />
                    <span>Confirm Sale & Print</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}      </div>
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
