import React, { useState, useEffect } from 'react';
import { seedDatabaseIfEmpty } from './db';
import { BranchService } from './services/branchService';
import PosTerminal from './components/PosTerminal';
import InventoryManager from './components/InventoryManager';
import InvoiceHistory from './components/InvoiceHistory';
import SyncHub from './components/SyncHub';
import { BarcodeScannerProvider } from './components/BarcodeScannerProvider';

import { 
  ShoppingCart, Package, FileText, HardDrive, 
  Sun, Moon, Cpu, Building2
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('pos');
  const [theme, setTheme] = useState('dark');
  const [isDbReady, setIsDbReady] = useState(false);
  const [activeBranch, setActiveBranch] = useState(null);

  useEffect(() => {
    async function initDB() {
      await seedDatabaseIfEmpty();
      try {
        const branch = await BranchService.getActiveBranch();
        setActiveBranch(branch);
      } catch (e) {
        console.warn('BranchService fallback:', e);
      }
      setIsDbReady(true);
    }
    initDB();
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  if (!isDbReady) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0b0f19', color: '#f1f5f9' }}>
        <Cpu style={{ width: 48, height: 48, color: '#3b82f6', marginBottom: '1rem' }} className="animate-spin" />
        <h2 style={{ fontWeight: 700 }}>Initializing ALUMFAB Offline Engine...</h2>
        <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.4rem' }}>Connecting SQLite Database & Active Branch Profile (%APPDATA%\ALUMFAB-POS\database\pos.db)</p>
      </div>
    );
  }

  return (
    <BarcodeScannerProvider
      onBarcodeScanned={(result) => {
        console.log('[Barcode Interceptor] Dispatching barcode event:', result);
        const event = new CustomEvent('globalBarcodeScanned', { detail: result });
        window.dispatchEvent(event);
      }}
    >
      <div className="app-container">
        {/* Top Navbar */}
        <header className="top-navbar">
          <div className="brand-logo">
            <div className="brand-icon">
              <Cpu style={{ width: 22, height: 22 }} />
            </div>
            <div>
              ALUMFAB <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginTop: '-4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Offline POS Phase 1</span>
            </div>
          </div>

          {/* Tab Navigation (Version 1 In-Scope Modules) */}
          <nav className="nav-tabs">
            <button 
              className={`nav-btn ${activeTab === 'pos' ? 'active' : ''}`}
              onClick={() => setActiveTab('pos')}
            >
              <ShoppingCart style={{ width: 16, height: 16 }} /> Billing POS Desk
            </button>

            <button 
              className={`nav-btn ${activeTab === 'inventory' ? 'active' : ''}`}
              onClick={() => setActiveTab('inventory')}
            >
              <Package style={{ width: 16, height: 16 }} /> Master Inventory
            </button>

            <button 
              className={`nav-btn ${activeTab === 'invoices' ? 'active' : ''}`}
              onClick={() => setActiveTab('invoices')}
            >
              <FileText style={{ width: 16, height: 16 }} /> Sales History
            </button>

            <button 
              className={`nav-btn ${activeTab === 'sync' ? 'active' : ''}`}
              onClick={() => setActiveTab('sync')}
            >
              <HardDrive style={{ width: 16, height: 16 }} /> Backup & System Settings
            </button>
          </nav>

          {/* Right Status Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="status-pill" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.3)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Building2 style={{ width: 14, height: 14 }} />
              <span>Branch: {activeBranch ? activeBranch.name : 'Surat Main Store'}</span>
            </div>

            <div className="status-pill offline">
              <span className="status-dot"></span> 100% Offline SQLite Engine
            </div>

            <button 
              onClick={toggleTheme} 
              className="btn btn-secondary btn-sm" 
              style={{ padding: '0.4rem 0.6rem', borderRadius: 'var(--radius-md)' }}
              title="Toggle Theme"
            >
              {theme === 'dark' ? <Sun style={{ width: 16, height: 16, color: '#f59e0b' }} /> : <Moon style={{ width: 16, height: 16 }} />}
            </button>
          </div>
        </header>

        {/* Main View Area (Version 1 In-Scope Views) */}
        <main className="main-content">
          {activeTab === 'pos' && <PosTerminal />}
          {activeTab === 'inventory' && <InventoryManager />}
          {activeTab === 'invoices' && <InvoiceHistory />}
          {activeTab === 'sync' && <SyncHub />}
        </main>
      </div>
    </BarcodeScannerProvider>
  );
}
