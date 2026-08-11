import React, { useState } from 'react';
import { Scissors, Plus, Trash2, Layers, CheckCircle, RefreshCw, BarChart3, Info } from 'lucide-react';

export default function CutOptimizer() {
  const [stockLengthFt, setStockLengthFt] = useState('14.5'); // Default 14.5 ft standard aluminum section
  const [kerfMm, setKerfMm] = useState('3'); // 3mm cutting blade kerf

  const [cuts, setCuts] = useState([
    { id: 1, label: 'Window Outer Left/Right', lengthFt: 4.2, qty: 4 },
    { id: 2, label: 'Window Outer Top/Bottom', lengthFt: 3.5, qty: 4 },
    { id: 3, label: 'Shutter Handle Profile', lengthFt: 4.0, qty: 4 },
    { id: 4, label: 'Interlock Profile', lengthFt: 2.2, qty: 2 },
  ]);

  const [newLabel, setNewLabel] = useState('');
  const [newLengthFt, setNewLengthFt] = useState('');
  const [newQty, setNewQty] = useState('1');

  const [optimizationResult, setOptimizationResult] = useState(null);

  const addCut = () => {
    const length = parseFloat(newLengthFt);
    const qty = parseInt(newQty);
    if (!length || length <= 0 || !qty || qty <= 0) return;

    setCuts([
      ...cuts,
      {
        id: Date.now(),
        label: newLabel || `Cut #${cuts.length + 1}`,
        lengthFt: length,
        qty: qty
      }
    ]);
    setNewLabel('');
    setNewLengthFt('');
    setNewQty('1');
  };

  const removeCut = (id) => {
    setCuts(cuts.filter(c => c.id !== id));
  };

  const runOptimization = () => {
    const stockFt = parseFloat(stockLengthFt);
    const kerfFt = (parseFloat(kerfMm) || 3) / 304.8; // convert mm to ft
    if (!stockFt || stockFt <= 0) return;

    // Expand required cut list into individual piece items
    let pieces = [];
    cuts.forEach(c => {
      for (let i = 0; i < c.qty; i++) {
        pieces.push({
          label: c.label,
          lengthFt: c.lengthFt
        });
      }
    });

    // Sort pieces descending for First Fit Decreasing algorithm
    pieces.sort((a, b) => b.lengthFt - a.lengthFt);

    let bars = []; // Each bar = { usedFt, remainingFt, cuts: [] }

    pieces.forEach(p => {
      let placed = false;
      for (let bar of bars) {
        // Required space includes item length + kerf loss
        const needed = p.lengthFt + kerfFt;
        if (bar.remainingFt >= needed) {
          bar.cuts.push(p);
          bar.usedFt += needed;
          bar.remainingFt -= needed;
          placed = true;
          break;
        }
      }

      if (!placed) {
        // Need a new stock bar
        const needed = p.lengthFt + kerfFt;
        bars.push({
          cuts: [p],
          usedFt: needed,
          remainingFt: stockFt - needed
        });
      }
    });

    const totalStockUsedFt = bars.length * stockFt;
    const totalCutPiecesLengthFt = pieces.reduce((sum, p) => sum + p.lengthFt, 0);
    const totalScrapFt = totalStockUsedFt - totalCutPiecesLengthFt;
    const efficiency = totalStockUsedFt > 0 ? (totalCutPiecesLengthFt / totalStockUsedFt) * 100 : 0;

    setOptimizationResult({
      bars,
      stockFt,
      totalStockUsedFt,
      totalCutPiecesLengthFt,
      totalScrapFt,
      efficiency,
      totalBarsCount: bars.length
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Title & Info Banner */}
      <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-primary)' }}>
            <Scissors style={{ color: 'var(--accent-primary)' }} /> Aluminum Section Cut-List Scrap Optimizer
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Minimize profile scrap and cut waste using automated stock length bin-packing algorithms.
          </p>
        </div>

        <button className="btn btn-primary" onClick={runOptimization}>
          <RefreshCw style={{ width: 18, height: 18 }} /> Calculate Optimal Cuts
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.5rem' }}>
        {/* Left Column: Settings & Input List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Stock Configuration Panel */}
          <div className="glass-panel-solid" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-primary)' }}>
              <Layers style={{ width: 16, height: 16, color: 'var(--accent-cyan)' }} /> Stock Section Setup
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Stock Length (ft)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={stockLengthFt} 
                  onChange={(e) => setStockLengthFt(e.target.value)}
                  placeholder="14.5"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Blade Kerf (mm)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={kerfMm} 
                  onChange={(e) => setKerfMm(e.target.value)}
                  placeholder="3"
                />
              </div>
            </div>
          </div>

          {/* Cut List Input Panel */}
          <div className="glass-panel-solid" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Required Profile Cut List</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div className="form-group">
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Cut Label (e.g. Shutter Left)"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <input 
                  type="number" 
                  className="form-input" 
                  placeholder="Length (ft)" 
                  value={newLengthFt}
                  onChange={(e) => setNewLengthFt(e.target.value)}
                />
                <input 
                  type="number" 
                  className="form-input" 
                  placeholder="Qty (pcs)" 
                  value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                />
              </div>

              <button className="btn btn-secondary btn-sm" onClick={addCut} style={{ marginTop: '0.2rem' }}>
                <Plus style={{ width: 14, height: 14 }} /> Add Cut Piece
              </button>
            </div>

            {/* List of Cut Entries */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '280px', overflowY: 'auto' }}>
              {cuts.map((c) => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-input)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.label}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.lengthFt} ft × {c.qty} pcs</div>
                  </div>
                  <button onClick={() => removeCut(c.id)} style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer' }}>
                    <Trash2 style={{ width: 16, height: 16 }} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Visualization & Results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {optimizationResult ? (
            <>
              {/* Summary KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                <div className="glass-panel" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Stock Bars Required</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-primary)', marginTop: '0.2rem' }}>
                    {optimizationResult.totalBarsCount} <span style={{ fontSize: '0.85rem', fontWeight: 400 }}>bars ({optimizationResult.stockFt}ft ea)</span>
                  </div>
                </div>

                <div className="glass-panel" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Material Utilization</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-success)', marginTop: '0.2rem' }}>
                    {optimizationResult.efficiency.toFixed(1)}%
                  </div>
                </div>

                <div className="glass-panel" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Useful Cut Length</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
                    {optimizationResult.totalCutPiecesLengthFt.toFixed(1)} ft
                  </div>
                </div>

                <div className="glass-panel" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Scrap & Waste Scrap</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-warning)', marginTop: '0.2rem' }}>
                    {optimizationResult.totalScrapFt.toFixed(1)} ft
                  </div>
                </div>
              </div>

              {/* Visual Stock Bar Cut Diagram */}
              <div className="glass-panel-solid" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <BarChart3 style={{ color: 'var(--accent-cyan)' }} /> Visual Stock Bar Cut Diagrams
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {optimizationResult.bars.map((bar, barIdx) => (
                    <div key={barIdx} style={{ background: 'var(--bg-input)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Stock Bar #{barIdx + 1} ({optimizationResult.stockFt} ft)</span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Scrap Leftover: <strong style={{ color: 'var(--accent-warning)' }}>{Math.max(0, bar.remainingFt).toFixed(2)} ft</strong>
                        </span>
                      </div>

                      {/* Bar Visualization Progress Track */}
                      <div style={{ height: '36px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', display: 'flex', overflow: 'hidden', position: 'relative' }}>
                        {bar.cuts.map((cutPiece, cutIdx) => {
                          const widthPct = (cutPiece.lengthFt / optimizationResult.stockFt) * 100;
                          return (
                            <div 
                              key={cutIdx} 
                              style={{ 
                                width: `${widthPct}%`, 
                                height: '100%', 
                                background: `hsl(${ (cutIdx * 65 + 190) % 360 }, 70%, 50%)`, 
                                borderRight: '2px solid rgba(0, 0, 0, 0.5)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                color: 'white',
                                textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whitespace: 'nowrap',
                                padding: '0 4px'
                              }}
                              title={`${cutPiece.label}: ${cutPiece.lengthFt} ft`}
                            >
                              {cutPiece.lengthFt}ft ({cutPiece.label})
                            </div>
                          );
                        })}

                        {/* Scrap Piece Visual */}
                        {bar.remainingFt > 0 && (
                          <div 
                            style={{ 
                              flex: 1, 
                              height: '100%', 
                              background: 'repeating-linear-gradient(45deg, rgba(245,158,11,0.1), rgba(245,158,11,0.1) 10px, rgba(245,158,11,0.2) 10px, rgba(245,158,11,0.2) 20px)', 
                              display: 'flex',
                              alignItems: 'center',
                              justify: 'center',
                              fontSize: '0.75rem',
                              color: 'var(--accent-warning)',
                              fontWeight: 600
                            }}
                          >
                            Scrap ({bar.remainingFt.toFixed(2)}ft)
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '400px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Scissors style={{ width: 48, height: 48, strokeWidth: 1.5, marginBottom: '1rem', opacity: 0.5 }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Click "Calculate Optimal Cuts" to view scrap optimization</h3>
              <p style={{ fontSize: '0.85rem', maxWidth: '400px', marginTop: '0.4rem' }}>
                Add your project section cut sizes on the left and click calculate to minimize material scrap.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
