import React, { useState, useEffect } from 'react';
import { Branch, Product, BranchInventory, StockMovementType } from '@prisma/client';
import { Layers, Plus, Building, AlertCircle, Printer } from 'lucide-react';
import { UnitNormalizer } from '../../services/unitNormalizer';

// ── Code 39 Barcode SVG Generator Subcomponent ──────────────────────────────
const Barcode: React.FC<{ value: string }> = ({ value }) => {
  if (!value) return <span style={{ color: '#64748b' }}>—</span>;
  const uppercaseValue = value.toUpperCase().trim();
  const barcodeText = uppercaseValue.startsWith('*') && uppercaseValue.endsWith('*') 
    ? uppercaseValue 
    : `*${uppercaseValue}*`;

  const ENCODING: Record<string, string> = {
    '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
    '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
    '8': '100100100', '9': '001100100', 'A': '100001001', 'B': '001001001',
    'C': '101001000', 'D': '000011001', 'E': '100011000', 'F': '001011000',
    'G': '000001101', 'H': '100001100', 'I': '001001100', 'J': '000011100',
    'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011',
    'O': '100010010', 'P': '001010010', 'Q': '000000111', 'R': '100000110',
    'S': '001000110', 'T': '000010110', 'U': '110000001', 'V': '011000001',
    'W': '111000000', 'X': '010010001', 'Y': '110010000', 'Z': '011010000',
    '-': '010000101', '.': '110000100', ' ': '011000100', '*': '010010100',
    '$': '010101000', '/': '010100010', '+': '010001010', '%': '000101010'
  };

  let elements: { isBar: boolean; isWide: boolean }[] = [];
  for (let i = 0; i < barcodeText.length; i++) {
    const char = barcodeText[i];
    const pattern = ENCODING[char];
    if (!pattern) continue;

    for (let j = 0; j < 9; j++) {
      elements.push({ isBar: j % 2 === 0, isWide: pattern[j] === '1' });
    }
    if (i < barcodeText.length - 1) {
      elements.push({ isBar: false, isWide: false });
    }
  }

  const NARROW_WIDTH = 1.25;
  const WIDE_WIDTH = NARROW_WIDTH * 3;
  let totalWidth = 0;
  elements.forEach(el => { totalWidth += el.isWide ? WIDE_WIDTH : NARROW_WIDTH; });

  let currentX = 0;
  const rects = elements.map((el, idx) => {
    const width = el.isWide ? WIDE_WIDTH : NARROW_WIDTH;
    const x = currentX;
    currentX += width;
    if (el.isBar) {
      return <rect key={idx} x={x} y={0} width={width} height={30} fill="#f8fafc" />;
    }
    return null;
  });

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
      <svg width={totalWidth} height={30} viewBox={`0 0 ${totalWidth} 30`}>
        {rects}
      </svg>
      <span style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: '#94a3b8', letterSpacing: '0.5px' }}>
        {value}
      </span>
    </div>
  );
};

export const InventoryPage: React.FC = () => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [inventory, setInventory] = useState<(BranchInventory & { product: Product })[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showModal, setShowModal] = useState<boolean>(false);

  // Stock Adjustment Form
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [qtyChange, setQtyChange] = useState<string>('10');
  const [adjustType, setAdjustType] = useState<StockMovementType>(StockMovementType.ADJUSTMENT_IN);
  const [reason, setReason] = useState<string>('Stock Audit Adjustment');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handlePrintBarcode = (barcodeText: string, productName: string) => {
    const printWindow = window.open('', '_blank', 'width=600,height=400');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Print Barcode - ${barcodeText}</title>
          <style>
            body {
              margin: 0;
              padding: 20px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              font-family: 'Courier New', monospace;
              text-align: center;
              background-color: white;
              color: black;
            }
            .barcode-container {
              border: 1px dashed #999;
              padding: 25px;
              display: inline-block;
            }
            .title {
              font-size: 14px;
              font-weight: bold;
              margin-bottom: 12px;
              max-width: 280px;
              word-wrap: break-word;
            }
            .placeholder {
              margin-top: 10px;
            }
            @media print {
              body { padding: 0; }
              .barcode-container { border: none; }
            }
          </style>
        </head>
        <body>
          <div class="barcode-container">
            <div class="title">${productName}</div>
            <div id="barcode-placeholder" class="placeholder"></div>
          </div>
          <script>
            const value = "${barcodeText}";
            const uppercase = value.toUpperCase().trim();
            const text = uppercase.startsWith('*') && uppercase.endsWith('*') ? uppercase : '*' + uppercase + '*';
            
            const ENCODING = {
              '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
              '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
              '8': '100100100', '9': '001100100', 'A': '100001001', 'B': '001001001',
              'C': '101001000', 'D': '000011001', 'E': '100011000', 'F': '001011000',
              'G': '000001101', 'H': '100001100', 'I': '001001100', 'J': '000011100',
              'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011',
              'O': '100010010', 'P': '001010010', 'Q': '000000111', 'R': '100000110',
              'S': '001000110', 'T': '000010110', 'U': '110000001', 'V': '011000001',
              'W': '111000000', 'X': '010010001', 'Y': '110010000', 'Z': '011010000',
              '-': '010000101', '.': '110000100', ' ': '011000100', '*': '010010100',
              '$': '010101000', '/': '010100010', '+': '010001010', '%': '000101010'
            };

            let elements = [];
            for (let i = 0; i < text.length; i++) {
              const char = text[i];
              const pattern = ENCODING[char];
              if (!pattern) continue;
              for (let j = 0; j < 9; j++) {
                elements.push({ isBar: j % 2 === 0, isWide: pattern[j] === '1' });
              }
              if (i < text.length - 1) {
                elements.push({ isBar: false, isWide: false });
              }
            }

            const NARROW_WIDTH = 2;
            const WIDE_WIDTH = 6;
            let totalWidth = 0;
            elements.forEach(el => { totalWidth += el.isWide ? WIDE_WIDTH : NARROW_WIDTH; });

            let svgHtml = '<svg width="' + totalWidth + '" height="60" viewBox="0 0 ' + totalWidth + ' 60">';
            let currentX = 0;
            elements.forEach(el => {
              const width = el.isWide ? WIDE_WIDTH : NARROW_WIDTH;
              if (el.isBar) {
                svgHtml += '<rect x="' + currentX + '" y="0" width="' + width + '" height="60" fill="black" />';
              }
              currentX += width;
            });
            svgHtml += '</svg><div style="font-size: 14px; margin-top: 8px; font-weight: bold; letter-spacing: 2px;">' + value + '</div>';

            document.getElementById("barcode-placeholder").innerHTML = svgHtml;

            setTimeout(() => {
              window.print();
              window.close();
            }, 500);
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const fetchBranches = async () => {
    if (window.alumfab) {
      const bList = await window.alumfab.getAllBranches();
      setBranches(bList);
      if (bList.length > 0 && !selectedBranchId) {
        setSelectedBranchId(bList[0].id);
      }
    }
  };

  const fetchInventory = async (bId: string) => {
    if (!bId || !window.alumfab) return;
    setLoading(true);
    try {
      const invList = await window.alumfab.getBranchInventory(bId);
      setInventory(invList);
    } catch (e) {
      console.error('Failed fetching branch inventory:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    if (selectedBranchId) {
      fetchInventory(selectedBranchId);
    }
  }, [selectedBranchId]);

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranchId || !selectedProductId || !qtyChange) return;
    setSubmitting(true);
    setErrorMsg(null);

    const delta = adjustType === StockMovementType.ADJUSTMENT_IN ? parseFloat(qtyChange) : -parseFloat(qtyChange);

    try {
      await window.alumfab.adjustStock(
        selectedBranchId,
        selectedProductId,
        delta,
        adjustType,
        reason
      );
      setShowModal(false);
      await fetchInventory(selectedBranchId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed adjusting stock');
    }
    setSubmitting(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header Banner */}
      <div style={{
        backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px',
        padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ backgroundColor: '#2563eb', padding: '0.5rem', borderRadius: '8px', color: 'white' }}>
            <Layers style={{ width: 20, height: 20 }} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Branch Stock Balances (Milli-Units Engine)
            </h2>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Phase 2 Domain Engine — Branch-Scoped Stock Isolation
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Active Branch Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '6px', padding: '0.4rem 0.75rem' }}>
            <Building style={{ width: 16, height: 16, color: '#60a5fa' }} />
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              style={{ backgroundColor: 'transparent', border: 'none', color: '#f8fafc', fontWeight: 600, fontSize: '0.85rem', outline: 'none' }}
            >
              {branches.map(b => (
                <option key={b.id} value={b.id} style={{ backgroundColor: '#0f172a' }}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowModal(true)}
            style={{
              backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '6px',
              padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
            }}
          >
            <Plus style={{ width: 16, height: 16 }} /> Adjust Stock
          </button>
        </div>
      </div>

      {/* Inventory Table */}
      <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#0f172a', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: '0.85rem 1rem' }}>SKU Code</th>
              <th style={{ padding: '0.85rem 1rem' }}>Product Name</th>
              <th style={{ padding: '0.85rem 1rem' }}>Selling Unit</th>
              <th style={{ padding: '0.85rem 1rem' }}>Stock Balance</th>
              <th style={{ padding: '0.85rem 1rem' }}>Raw Milli-Units</th>
              <th style={{ padding: '0.85rem 1rem' }}>Status</th>
              <th style={{ padding: '0.85rem 1rem' }}>1D Barcode Label</th>
              <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map((inv) => {
              const qtyDecimal = UnitNormalizer.fromMilliUnits(inv.quantityMilli);
              const minStockDecimal = UnitNormalizer.fromMilliUnits(inv.product.minimumStockMilli || 0);
              const isLow = qtyDecimal <= minStockDecimal;
              const hasBarcode = !!inv.product.barcode;
              return (
                <tr key={inv.id} style={{ borderBottom: '1px solid #334155', color: '#f8fafc' }}>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontWeight: 600, color: '#60a5fa' }}>{inv.product.sku}</td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 500 }}>{inv.product.name}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{ backgroundColor: '#334155', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                      {inv.product.sellingUnit}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 800, fontSize: '1rem', color: isLow ? '#f87171' : '#4ade80' }}>
                    {qtyDecimal.toFixed(3)} {inv.product.sellingUnit}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', color: '#94a3b8' }}>{inv.quantityMilli}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{
                      backgroundColor: isLow ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                      color: isLow ? '#f87171' : '#4ade80',
                      padding: '0.25rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600
                    }}>
                      {isLow ? 'Low Stock' : 'Healthy'}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', verticalAlign: 'middle' }}>
                    {inv.product.barcode ? (
                      <Barcode value={inv.product.barcode} />
                    ) : (
                      <span style={{ color: '#64748b' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                    {hasBarcode && (
                      <button
                        onClick={() => handlePrintBarcode(inv.product.barcode || '', inv.product.name)}
                        style={{
                          backgroundColor: '#334155', border: 'none', color: '#f8fafc', 
                          padding: '0.35rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', 
                          fontWeight: 600, cursor: 'pointer', display: 'inline-flex', 
                          alignItems: 'center', gap: '0.3rem'
                        }}
                        title="Print Barcode Label"
                      >
                        <Printer style={{ width: 14, height: 14 }} /> Print Label
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Stock Adjustment Modal */}
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
              Branch Stock Adjustment
            </h3>

            {errorMsg && (
              <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#f87171', padding: '0.75rem', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertCircle style={{ width: 16, height: 16 }} /> {errorMsg}
              </div>
            )}

            <form onSubmit={handleAdjustStock} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Select Product *</label>
                <select
                  required value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}
                  style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                >
                  <option value="">-- Choose Product --</option>
                  {inventory.map(inv => (
                    <option key={inv.product.id} value={inv.product.id}>
                      {inv.product.name} (Current: {UnitNormalizer.fromMilliUnits(inv.quantityMilli)} {inv.product.sellingUnit})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Movement Type *</label>
                  <select
                    value={adjustType} onChange={e => setAdjustType(e.target.value as any)}
                    style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                  >
                    <option value={StockMovementType.ADJUSTMENT_IN}>+ ADJUSTMENT IN</option>
                    <option value={StockMovementType.ADJUSTMENT_OUT}>- ADJUSTMENT OUT</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Quantity *</label>
                  <input
                    type="number" min="0.001" step="0.001" required value={qtyChange} onChange={e => setQtyChange(e.target.value)}
                    style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>Audit Notes</label>
                <input
                  type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="Physical stock audit count"
                  style={{ width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.5rem', borderRadius: '6px', marginTop: '0.2rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button" onClick={() => setShowModal(false)}
                  style={{ backgroundColor: '#334155', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={submitting}
                  style={{ backgroundColor: '#2563eb', color: 'white', border: 'none', padding: '0.5rem 1.25rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                  {submitting ? 'Updating...' : 'Commit Movement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
