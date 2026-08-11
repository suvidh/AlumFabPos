import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Product, Customer, DiscountType, PaymentMethod } from '@prisma/client';
import QRCode from 'qrcode';
import {
  ShoppingCart, Search, Trash2, X, CheckCircle, AlertCircle,
  User, CreditCard, Banknote, Tag, RefreshCw, Keyboard, ChevronDown, QrCode
} from 'lucide-react';
import { UnitNormalizer } from '../../services/unitNormalizer';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface CartItem {
  product: Product;
  quantityDecimal: number;
  rateRupees: number;   // GST-Inclusive unit price (may be overridden)
  lineDiscountRupees: number;
}

type CheckoutStep = 'cart' | 'payment' | 'success';

// ─────────────────────────────────────────────────────────────
// Small helper: format currency
// ─────────────────────────────────────────────────────────────
const formatRupees = (paise: number) => `₹${UnitNormalizer.fromPaise(paise).toFixed(2)}`;
const toPaise = (r: number) => UnitNormalizer.toPaise(r);

// ─────────────────────────────────────────────────────────────
// Hotkey badge component
// ─────────────────────────────────────────────────────────────
const HotkeyBadge: React.FC<{ label: string }> = ({ label }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '0.65rem', fontWeight: 700, fontFamily: 'monospace',
    backgroundColor: '#0f172a', border: '1px solid #475569', color: '#94a3b8',
    borderRadius: '4px', padding: '1px 5px', lineHeight: 1.5
  }}>{label}</span>
);

// ─────────────────────────────────────────────────────────────
// Main BillingPage
// ─────────────────────────────────────────────────────────────
export const BillingPage: React.FC = () => {

  // Data
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [defaultBranchId, setDefaultBranchId] = useState<string>('');

  // Product Search (F2)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCartIdx, setActiveCartIdx] = useState<number>(-1);

  // Invoice-level discount
  const [discountType, setDiscountType] = useState<'NONE' | 'PERCENTAGE' | 'FIXED'>('NONE');
  const [discountValue, setDiscountValue] = useState<string>('');
  const [discountNote, setDiscountNote] = useState<string>('');

  // Customer selection
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerDropOpen, setCustomerDropOpen] = useState(false);

  // Checkout flow
  const [step, setStep] = useState<CheckoutStep>('cart');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [chequeNumber, setChequeNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastInvoiceNumber, setLastInvoiceNumber] = useState<string>('');

  // ── Load master data ──────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      if (!window.alumfab) return;
      try {
        const [prods, custs, { company, defaultBranch }] = await Promise.all([
          window.alumfab.getAllProducts(false),
          window.alumfab.getAllCustomers(),
          window.alumfab.getCompany()
        ]);
        setProducts(prods);
        setCustomers(custs);
        if (defaultBranch) setDefaultBranchId(defaultBranch.id);
      } catch (e) {
        console.error('Billing load error:', e);
      }
    };
    load();
  }, []);

  // ── Product search filter ─────────────────────────────────
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const q = searchQuery.toLowerCase();
    setSearchResults(
      products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.includes(q))
      ).slice(0, 10)
    );
  }, [searchQuery, products]);

  // ── Global keyboard hotkeys ───────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // F2 → open product search
    if (e.key === 'F2') {
      e.preventDefault();
      if (step === 'cart') {
        setSearchOpen(true);
        setSearchQuery('');
        setTimeout(() => searchRef.current?.focus(), 50);
      }
    }
    // F8 → proceed to checkout
    if (e.key === 'F8') {
      e.preventDefault();
      if (step === 'cart' && cart.length > 0) setStep('payment');
      else if (step === 'payment') handleCheckout();
    }
    // Escape → close search / go back
    if (e.key === 'Escape') {
      if (searchOpen) { setSearchOpen(false); setSearchQuery(''); }
      else if (step === 'payment') setStep('cart');
    }
  }, [step, cart, searchOpen]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Cart operations ───────────────────────────────────────
  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.findIndex(i => i.product.id === product.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { ...updated[existing], quantityDecimal: updated[existing].quantityDecimal + 1 };
        setActiveCartIdx(existing);
        return updated;
      }
      setActiveCartIdx(prev.length);
      return [...prev, {
        product,
        quantityDecimal: 1,
        rateRupees: UnitNormalizer.fromPaise(product.sellingPricePaise),
        lineDiscountRupees: 0
      }];
    });
    setSearchOpen(false);
    setSearchQuery('');
  };

  const updateCartQty = (idx: number, qty: number) => {
    if (qty <= 0) return;
    setCart(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], quantityDecimal: qty };
      return updated;
    });
  };

  const updateCartRate = (idx: number, rate: number) => {
    if (rate < 0) return;
    setCart(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], rateRupees: rate };
      return updated;
    });
  };

  const updateLineDiscount = (idx: number, disc: number) => {
    setCart(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], lineDiscountRupees: Math.max(0, disc) };
      return updated;
    });
  };

  const removeFromCart = (idx: number) => {
    setCart(prev => prev.filter((_, i) => i !== idx));
    setActiveCartIdx(-1);
  };

  const clearCart = () => {
    setCart([]);
    setActiveCartIdx(-1);
    setDiscountType('NONE');
    setDiscountValue('');
    setDiscountNote('');
    setSelectedCustomerId('');
    setPaymentMethod(PaymentMethod.CASH);
    setChequeNumber('');
    setSubmitError(null);
    setStep('cart');
  };

  // ── Totals calculation ────────────────────────────────────
  const subtotalPaise = cart.reduce((sum, item) => {
    const grossPaise = toPaise(item.rateRupees * item.quantityDecimal);
    const discPaise = toPaise(item.lineDiscountRupees);
    return sum + Math.max(0, grossPaise - discPaise);
  }, 0);

  const invoiceDiscountPaise = (() => {
    const val = parseFloat(discountValue) || 0;
    if (discountType === 'PERCENTAGE') return Math.round((subtotalPaise * val) / 100);
    if (discountType === 'FIXED') return toPaise(val);
    return 0;
  })();

  const grandTotalPaise = Math.max(0, subtotalPaise - invoiceDiscountPaise);

  // ── Checkout submission ───────────────────────────────────
  const handleCheckout = async () => {
    if (!defaultBranchId || cart.length === 0) return;
    if (paymentMethod === PaymentMethod.CHEQUE && !chequeNumber.trim()) {
      setSubmitError('Cheque number is required for CHEQUE payments.');
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const items = cart.map(item => ({
        productId: item.product.id,
        quantityDecimal: item.quantityDecimal,
        rateRupees: item.rateRupees,
        discountRupees: item.lineDiscountRupees || undefined
      }));

      const saleInput: any = {
        branchId: defaultBranchId,
        customerId: selectedCustomerId || undefined,
        items,
        paymentMethod,
        chequeNumber: paymentMethod === PaymentMethod.CHEQUE ? chequeNumber.trim() : undefined
      };

      if (discountType === 'PERCENTAGE') {
        saleInput.discountType = DiscountType.PERCENTAGE;
        saleInput.discountValueBasisPoints = Math.round((parseFloat(discountValue) || 0) * 100);
      } else if (discountType === 'FIXED') {
        saleInput.discountType = DiscountType.FIXED;
        saleInput.discountRupees = parseFloat(discountValue) || 0;
      }

      if (discountNote) saleInput.discountNote = discountNote;

      const sale = await window.alumfab.createSale(saleInput);
      setLastInvoiceNumber((sale as any).invoiceNumber || 'N/A');
      setStep('success');
    } catch (err: any) {
      setSubmitError(err.message || 'Sale creation failed. Check stock levels and retry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectPaymentMethod = (method: PaymentMethod) => {
    setPaymentMethod(method);
    setSubmitError(null);
  };

  // ── Customer display ──────────────────────────────────────
  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.phone && c.phone.includes(customerSearch))
  );
  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  // ─────────────────────────────────────────────────────────
  // RENDER: Success Screen
  // ─────────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: '70vh', gap: '1.5rem', textAlign: 'center'
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          backgroundColor: 'rgba(34, 197, 94, 0.15)',
          border: '2px solid #22c55e',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <CheckCircle style={{ width: 36, height: 36, color: '#22c55e' }} />
        </div>

        <div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f8fafc', marginBottom: '0.35rem' }}>
            Sale Recorded Successfully
          </div>
          <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            Invoice created and stock balances updated.
          </div>
        </div>

        <div style={{
          backgroundColor: '#1e293b', border: '1px solid #334155',
          borderRadius: '10px', padding: '1.25rem 2rem', minWidth: '280px'
        }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginBottom: '0.35rem' }}>
            INVOICE NUMBER
          </div>
          <div style={{
            fontSize: '1.4rem', fontWeight: 800, fontFamily: 'monospace',
            color: '#60a5fa', letterSpacing: '0.04em'
          }}>
            {lastInvoiceNumber}
          </div>
          <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#94a3b8' }}>
            Grand Total: <span style={{ color: '#4ade80', fontWeight: 700 }}>{formatRupees(grandTotalPaise)}</span>
            &nbsp;·&nbsp; Payment: <span style={{ fontWeight: 600 }}>{paymentMethod}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={clearCart}
            style={{
              backgroundColor: '#2563eb', color: 'white', border: 'none',
              borderRadius: '8px', padding: '0.7rem 1.5rem', fontSize: '0.9rem',
              fontWeight: 700, cursor: 'pointer'
            }}
          >
            New Sale (F2)
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────
  // RENDER: Payment Step
  // ─────────────────────────────────────────────────────────
  if (step === 'payment') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '640px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{
          backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px',
          padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ backgroundColor: '#2563eb', padding: '0.5rem', borderRadius: '8px', color: 'white' }}>
              <CreditCard style={{ width: 20, height: 20 }} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
                Payment Settlement
              </h2>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                {cart.length} line item{cart.length !== 1 ? 's' : ''} · Cash or Cheque
              </span>
            </div>
          </div>
          <button
            onClick={() => setStep('cart')}
            style={{
              backgroundColor: '#334155', color: '#f8fafc', border: 'none',
              borderRadius: '6px', padding: '0.4rem 0.85rem', fontSize: '0.8rem',
              fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
            }}
          >
            <X style={{ width: 14, height: 14 }} /> Back <HotkeyBadge label="Esc" />
          </button>
        </div>

        {/* Order Summary */}
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ padding: '0.85rem 1.25rem', backgroundColor: '#0f172a', borderBottom: '1px solid #334155', fontSize: '0.8rem', color: '#94a3b8', fontWeight: 700 }}>
            ORDER SUMMARY
          </div>
          {cart.map((item, i) => {
            const gross = item.rateRupees * item.quantityDecimal;
            const lineTotal = Math.max(0, gross - item.lineDiscountRupees);
            return (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.65rem 1.25rem', borderBottom: i < cart.length - 1 ? '1px solid #1e293b' : 'none',
                fontSize: '0.85rem', color: '#f8fafc'
              }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{item.product.name}</span>
                  <span style={{ color: '#64748b', marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                    {item.quantityDecimal} × ₹{item.rateRupees.toFixed(2)} / {item.product.sellingUnit}
                  </span>
                </div>
                <span style={{ fontWeight: 700, color: '#4ade80' }}>₹{lineTotal.toFixed(2)}</span>
              </div>
            );
          })}
          {/* Totals */}
          <div style={{ padding: '0.85rem 1.25rem', borderTop: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#94a3b8' }}>
              <span>Subtotal</span><span>{formatRupees(subtotalPaise)}</span>
            </div>
            {invoiceDiscountPaise > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#f87171' }}>
                <span>Discount {discountType === 'PERCENTAGE' ? `(${discountValue}%)` : ''}</span>
                <span>− {formatRupees(invoiceDiscountPaise)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc', paddingTop: '0.5rem', borderTop: '1px solid #334155' }}>
              <span>Grand Total</span><span style={{ color: '#4ade80' }}>{formatRupees(grandTotalPaise)}</span>
            </div>
          </div>
        </div>

        {/* Payment Method */}
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 700, marginBottom: '0.85rem' }}>
            PAYMENT METHOD
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {[
              { method: PaymentMethod.CASH, label: 'Cash', icon: Banknote },
              { method: PaymentMethod.CHEQUE, label: 'Cheque', icon: CreditCard }
            ].map(({ method, label, icon: Icon }) => (
              <button
                key={method}
                onClick={() => selectPaymentMethod(method)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                  padding: '0.85rem 1rem', borderRadius: '8px', fontWeight: 700, fontSize: '0.9rem',
                  cursor: 'pointer', transition: 'all 0.15s ease',
                  border: paymentMethod === method ? '2px solid #2563eb' : '2px solid #334155',
                  backgroundColor: paymentMethod === method ? 'rgba(37, 99, 235, 0.15)' : 'transparent',
                  color: paymentMethod === method ? '#60a5fa' : '#94a3b8'
                }}
              >
                <Icon style={{ width: 18, height: 18 }} /> {label}
              </button>
            ))}
          </div>

          {/* Cheque number field */}
          {paymentMethod === PaymentMethod.CHEQUE && (
            <div style={{ marginTop: '0.85rem' }}>
              <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Cheque Number *</label>
              <input
                type="text"
                placeholder="e.g. 123456"
                value={chequeNumber}
                onChange={e => setChequeNumber(e.target.value)}
                autoFocus
                style={{
                  width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155',
                  color: 'white', padding: '0.6rem 0.8rem', borderRadius: '6px',
                  marginTop: '0.3rem', fontSize: '0.9rem', boxSizing: 'border-box'
                }}
              />
            </div>
          )}
        </div>

        {/* Error */}
        {submitError && (
          <div style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444',
            color: '#f87171', borderRadius: '8px', padding: '0.85rem 1rem',
            fontSize: '0.85rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem'
          }}>
            <AlertCircle style={{ width: 16, height: 16, flexShrink: 0, marginTop: '2px' }} />
            {submitError}
          </div>
        )}

        {/* Confirm Button */}
        <button
          onClick={handleCheckout}
          disabled={isSubmitting || !defaultBranchId}
          style={{
            backgroundColor: isSubmitting ? '#1e3a5f' : '#16a34a',
            color: 'white', border: 'none', borderRadius: '8px',
            padding: '0.9rem 1.5rem', fontSize: '1rem', fontWeight: 800,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            transition: 'background-color 0.15s ease'
          }}
        >
          <CheckCircle style={{ width: 20, height: 20 }} />
          {isSubmitting ? 'Processing Sale...' : `Confirm & Record Sale — ${formatRupees(grandTotalPaise)}`}
          &nbsp;<HotkeyBadge label="F8" />
        </button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────
  // RENDER: Cart Step (main POS view)
  // ─────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* ── Toolbar ── */}
      <div style={{
        backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px',
        padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ backgroundColor: '#2563eb', padding: '0.5rem', borderRadius: '8px', color: 'white' }}>
            <ShoppingCart style={{ width: 20, height: 20 }} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Billing POS Counter
            </h2>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {cart.length === 0 ? 'Cart is empty — press F2 to search and add items' : `${cart.length} item${cart.length !== 1 ? 's' : ''} in cart`}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.3rem', fontSize: '0.75rem', color: '#64748b', alignItems: 'center' }}>
            <HotkeyBadge label="F2" /> <span>Search</span>
            &nbsp;&nbsp;
            <HotkeyBadge label="F8" /> <span>Checkout</span>
          </div>

          <button
            onClick={() => { setSearchOpen(true); setSearchQuery(''); setTimeout(() => searchRef.current?.focus(), 50); }}
            style={{
              backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '6px',
              padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
            }}
          >
            <Search style={{ width: 16, height: 16 }} /> Add Item <HotkeyBadge label="F2" />
          </button>

          {cart.length > 0 && (
            <button
              onClick={clearCart}
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#f87171',
                border: '1px solid #ef4444', borderRadius: '6px',
                padding: '0.5rem 0.85rem', fontSize: '0.8rem', fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem'
              }}
            >
              <Trash2 style={{ width: 14, height: 14 }} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Cart Table ── */}
      <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#0f172a', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
                <th style={{ padding: '0.75rem 1rem', width: '34%' }}>Product</th>
                <th style={{ padding: '0.75rem 1rem', width: '12%' }}>Unit</th>
                <th style={{ padding: '0.75rem 1rem', width: '14%' }}>Qty</th>
                <th style={{ padding: '0.75rem 1rem', width: '14%' }}>Rate (₹)</th>
                <th style={{ padding: '0.75rem 1rem', width: '13%' }}>Line Disc (₹)</th>
                <th style={{ padding: '0.75rem 1rem', width: '9%', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '0.75rem 0.5rem', width: '4%' }}></th>
              </tr>
            </thead>
            <tbody>
              {cart.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '3rem', textAlign: 'center', color: '#475569' }}>
                    <Keyboard style={{ width: 32, height: 32, marginBottom: '0.5rem', display: 'block', margin: '0 auto 0.5rem' }} />
                    Press <strong style={{ color: '#60a5fa' }}>F2</strong> or click "Add Item" to search products
                  </td>
                </tr>
              )}
              {cart.map((item, idx) => {
                const gross = item.rateRupees * item.quantityDecimal;
                const lineTotal = Math.max(0, gross - item.lineDiscountRupees);
                const isActive = activeCartIdx === idx;
                return (
                  <tr
                    key={idx}
                    onClick={() => setActiveCartIdx(idx)}
                    style={{
                      borderBottom: '1px solid #334155', color: '#f8fafc',
                      backgroundColor: isActive ? 'rgba(37, 99, 235, 0.06)' : 'transparent',
                      cursor: 'pointer', transition: 'background-color 0.1s ease'
                    }}
                  >
                    <td style={{ padding: '0.6rem 1rem' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{item.product.name}</div>
                      <div style={{ fontSize: '0.72rem', color: '#60a5fa', fontFamily: 'monospace' }}>{item.product.sku}</div>
                    </td>
                    <td style={{ padding: '0.6rem 1rem' }}>
                      <span style={{
                        backgroundColor: '#334155', color: '#94a3b8',
                        padding: '0.15rem 0.45rem', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700
                      }}>{item.product.sellingUnit}</span>
                    </td>
                    <td style={{ padding: '0.6rem 1rem' }}>
                      <input
                        type="number" min="0.001" step="0.001"
                        value={item.quantityDecimal}
                        onClick={e => e.stopPropagation()}
                        onChange={e => updateCartQty(idx, parseFloat(e.target.value) || 0)}
                        style={{
                          width: '80px', backgroundColor: '#0f172a', border: '1px solid #334155',
                          color: 'white', padding: '0.3rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem'
                        }}
                      />
                    </td>
                    <td style={{ padding: '0.6rem 1rem' }}>
                      <input
                        type="number" min="0" step="0.01"
                        value={item.rateRupees}
                        onClick={e => e.stopPropagation()}
                        onChange={e => updateCartRate(idx, parseFloat(e.target.value) || 0)}
                        style={{
                          width: '90px', backgroundColor: '#0f172a', border: '1px solid #334155',
                          color: 'white', padding: '0.3rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem'
                        }}
                      />
                    </td>
                    <td style={{ padding: '0.6rem 1rem' }}>
                      <input
                        type="number" min="0" step="0.01"
                        value={item.lineDiscountRupees}
                        onClick={e => e.stopPropagation()}
                        onChange={e => updateLineDiscount(idx, parseFloat(e.target.value) || 0)}
                        style={{
                          width: '90px', backgroundColor: '#0f172a', border: '1px solid #334155',
                          color: 'white', padding: '0.3rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem'
                        }}
                      />
                    </td>
                    <td style={{ padding: '0.6rem 1rem', fontWeight: 800, color: '#4ade80', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      ₹{lineTotal.toFixed(2)}
                    </td>
                    <td style={{ padding: '0.6rem 0.5rem', textAlign: 'center' }}>
                      <button
                        onClick={e => { e.stopPropagation(); removeFromCart(idx); }}
                        style={{
                          backgroundColor: 'transparent', border: 'none', color: '#64748b',
                          cursor: 'pointer', padding: '0.25rem', borderRadius: '4px',
                          display: 'flex', alignItems: 'center'
                        }}
                      >
                        <X style={{ width: 15, height: 15 }} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Bottom Panel: Customer + Discount + Totals ── */}
      {cart.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

          {/* Left: Customer + Discount */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Customer selector */}
            <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <User style={{ width: 13, height: 13 }} /> CUSTOMER
              </div>
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setCustomerDropOpen(v => !v)}
                  style={{
                    width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155',
                    color: selectedCustomer ? '#f8fafc' : '#64748b',
                    padding: '0.55rem 0.85rem', borderRadius: '6px', fontSize: '0.875rem',
                    fontWeight: selectedCustomer ? 600 : 400, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left'
                  }}
                >
                  {selectedCustomer ? selectedCustomer.name : 'Walk-in Retail Customer (default)'}
                  <ChevronDown style={{ width: 14, height: 14, color: '#64748b' }} />
                </button>

                {customerDropOpen && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20,
                    backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden'
                  }}>
                    <div style={{ padding: '0.5rem' }}>
                      <input
                        type="text" placeholder="Search customer..."
                        value={customerSearch}
                        autoFocus
                        onChange={e => setCustomerSearch(e.target.value)}
                        style={{
                          width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155',
                          color: 'white', padding: '0.4rem 0.65rem', borderRadius: '5px',
                          fontSize: '0.85rem', boxSizing: 'border-box'
                        }}
                      />
                    </div>
                    <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
                      <button
                        onClick={() => { setSelectedCustomerId(''); setCustomerDropOpen(false); setCustomerSearch(''); }}
                        style={{
                          width: '100%', backgroundColor: 'transparent', border: 'none',
                          color: '#94a3b8', padding: '0.5rem 1rem', textAlign: 'left',
                          fontSize: '0.85rem', cursor: 'pointer'
                        }}
                      >
                        Walk-in Retail Customer (default)
                      </button>
                      {filteredCustomers.map(c => (
                        <button
                          key={c.id}
                          onClick={() => { setSelectedCustomerId(c.id); setCustomerDropOpen(false); setCustomerSearch(''); }}
                          style={{
                            width: '100%', backgroundColor: selectedCustomerId === c.id ? 'rgba(37,99,235,0.15)' : 'transparent',
                            border: 'none', color: '#f8fafc', padding: '0.5rem 1rem',
                            textAlign: 'left', fontSize: '0.85rem', cursor: 'pointer', borderTop: '1px solid #1e293b'
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{c.name}</div>
                          {c.phone && <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{c.phone}</div>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Invoice-level discount */}
            <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Tag style={{ width: 13, height: 13 }} /> INVOICE DISCOUNT
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                {(['NONE', 'PERCENTAGE', 'FIXED'] as const).map(dt => (
                  <button
                    key={dt}
                    onClick={() => { setDiscountType(dt); setDiscountValue(''); }}
                    style={{
                      flex: 1, padding: '0.4rem 0.5rem', borderRadius: '5px',
                      fontWeight: 600, fontSize: '0.75rem', cursor: 'pointer',
                      border: discountType === dt ? '2px solid #2563eb' : '2px solid #334155',
                      backgroundColor: discountType === dt ? 'rgba(37, 99, 235, 0.15)' : 'transparent',
                      color: discountType === dt ? '#60a5fa' : '#94a3b8'
                    }}
                  >
                    {dt === 'NONE' ? 'None' : dt === 'PERCENTAGE' ? '% Off' : '₹ Fixed'}
                  </button>
                ))}
              </div>

              {discountType !== 'NONE' && (
                <>
                  <input
                    type="number" min="0" step={discountType === 'PERCENTAGE' ? '0.1' : '0.01'}
                    placeholder={discountType === 'PERCENTAGE' ? 'Discount % (e.g. 5)' : 'Discount ₹ (e.g. 500)'}
                    value={discountValue}
                    onChange={e => setDiscountValue(e.target.value)}
                    style={{
                      width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155',
                      color: 'white', padding: '0.4rem 0.65rem', borderRadius: '5px',
                      fontSize: '0.85rem', marginBottom: '0.4rem', boxSizing: 'border-box'
                    }}
                  />
                  <input
                    type="text" placeholder="Discount reason / note (optional)"
                    value={discountNote}
                    onChange={e => setDiscountNote(e.target.value)}
                    style={{
                      width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155',
                      color: 'white', padding: '0.4rem 0.65rem', borderRadius: '5px',
                      fontSize: '0.85rem', boxSizing: 'border-box'
                    }}
                  />
                </>
              )}
            </div>
          </div>

          {/* Right: Totals + Checkout */}
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, marginBottom: '1rem' }}>
                ORDER TOTAL
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: '#94a3b8' }}>
                  <span>Subtotal ({cart.length} items)</span>
                  <span>{formatRupees(subtotalPaise)}</span>
                </div>

                {invoiceDiscountPaise > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: '#f87171' }}>
                    <span>Invoice Discount{discountType === 'PERCENTAGE' ? ` (${discountValue}%)` : ''}</span>
                    <span>− {formatRupees(invoiceDiscountPaise)}</span>
                  </div>
                )}

                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  paddingTop: '0.75rem', marginTop: '0.25rem', borderTop: '1px solid #334155'
                }}>
                  <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>Grand Total</span>
                  <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#4ade80' }}>
                    {formatRupees(grandTotalPaise)}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setStep('payment')}
              disabled={cart.length === 0}
              style={{
                width: '100%', backgroundColor: '#2563eb', color: 'white', border: 'none',
                borderRadius: '8px', padding: '0.85rem 1rem', fontSize: '0.95rem',
                fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem',
                opacity: cart.length === 0 ? 0.4 : 1
              }}
            >
              Proceed to Payment <HotkeyBadge label="F8" />
            </button>
          </div>
        </div>
      )}

      {/* ── Product Search Modal (F2) ── */}
      {searchOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(7, 15, 31, 0.82)', display: 'flex',
          alignItems: 'flex-start', justifyContent: 'center',
          paddingTop: '10vh', zIndex: 100
        }}
          onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
        >
          <div
            style={{
              backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '14px',
              width: '100%', maxWidth: '580px', overflow: 'hidden',
              boxShadow: '0 24px 64px rgba(0,0,0,0.7)'
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Search Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem 1.25rem', borderBottom: '1px solid #334155' }}>
              <Search style={{ width: 18, height: 18, color: '#60a5fa', flexShrink: 0 }} />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search by product name, SKU, or barcode..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  flex: 1, backgroundColor: 'transparent', border: 'none',
                  color: '#f8fafc', outline: 'none', fontSize: '1rem'
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <HotkeyBadge label="Esc" />
                <button
                  onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                  style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px' }}
                >
                  <X style={{ width: 16, height: 16 }} />
                </button>
              </div>
            </div>

            {/* Results */}
            <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
              {searchQuery.trim() === '' && (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#475569', fontSize: '0.875rem' }}>
                  Start typing to search the product catalog…
                </div>
              )}
              {searchQuery.trim() !== '' && searchResults.length === 0 && (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#475569', fontSize: '0.875rem' }}>
                  No active products match "<strong style={{ color: '#94a3b8' }}>{searchQuery}</strong>"
                </div>
              )}
              {searchResults.map((p, i) => {
                const priceRupees = UnitNormalizer.fromPaise(p.sellingPricePaise);
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    style={{
                      width: '100%', backgroundColor: 'transparent', border: 'none',
                      borderBottom: i < searchResults.length - 1 ? '1px solid #1e3a5f' : 'none',
                      color: '#f8fafc', padding: '0.75rem 1.25rem', textAlign: 'left',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      transition: 'background-color 0.1s ease'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(37,99,235,0.1)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.15rem' }}>{p.name}</div>
                      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#60a5fa' }}>{p.sku}</span>
                        <span style={{ fontSize: '0.72rem', backgroundColor: '#334155', color: '#94a3b8', padding: '0.1rem 0.35rem', borderRadius: '3px' }}>
                          {p.sellingUnit}
                        </span>
                        {p.barcode && (
                          <span style={{ fontSize: '0.72rem', color: '#475569' }}>{p.barcode}</span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '1rem' }}>
                      <div style={{ fontWeight: 800, fontSize: '1rem', color: '#4ade80' }}>₹{priceRupees.toFixed(2)}</div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>GST-Inclusive</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Footer hint */}
            <div style={{ padding: '0.6rem 1.25rem', borderTop: '1px solid #334155', display: 'flex', gap: '1rem', fontSize: '0.72rem', color: '#475569' }}>
              <span><HotkeyBadge label="↵" /> Add to cart</span>
              <span><HotkeyBadge label="Esc" /> Close</span>
              <span style={{ marginLeft: 'auto' }}>{products.length} products in catalog</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
