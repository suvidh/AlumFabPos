import React, { useState } from 'react';
import { 
  LayoutDashboard, ShoppingCart, Package, Layers, 
  Users, FileText, BarChart3, Settings, ShieldCheck, Cpu, UserCheck, Building2
} from 'lucide-react';
import { DashboardPage } from '../pages/DashboardPage';
import { BillingPage } from '../pages/BillingPage';
import { ProductsPage } from '../pages/ProductsPage';
import { InventoryPage } from '../pages/InventoryPage';
import { CustomersPage } from '../pages/CustomersPage';
import { SalesPage } from '../pages/SalesPage';
import { ReportsPage } from '../pages/ReportsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { useUser } from '../context/UserContext';
import { usePOSConfigStore } from '../context/POSConfigStore';

export type NavTab = 'dashboard' | 'billing' | 'products' | 'inventory' | 'customers' | 'sales' | 'reports' | 'settings';

export const MainLayout: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const { user } = useUser();
  const { activeBoundBranch } = usePOSConfigStore();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'billing', label: 'Billing POS', icon: ShoppingCart },
    { id: 'products', label: 'Products', icon: Package },
    { id: 'inventory', label: 'Inventory', icon: Layers },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'sales', label: 'Sales History', icon: FileText },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#0f172a', color: '#f8fafc' }}>
      {/* Sidebar Layout */}
      <aside style={{
        width: '240px',
        backgroundColor: '#1e293b',
        borderRight: '1px solid #334155',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '1.25rem 1rem'
      }}>
        <div>
          {/* App Brand Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', marginBottom: '1.5rem' }}>
            <div style={{ backgroundColor: '#2563eb', padding: '0.4rem', borderRadius: '8px', color: 'white', display: 'flex' }}>
              <Cpu style={{ width: 22, height: 22 }} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em', color: '#f8fafc' }}>ALUMFAB POS</div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600, marginTop: '-2px' }}>Offline Desktop V1</div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as NavTab)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: isActive ? '#2563eb' : 'transparent',
                    color: isActive ? '#ffffff' : '#cbd5e1',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Icon style={{ width: 18, height: 18 }} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {/* Bound Branch Status Pill */}
          <div style={{
            backgroundColor: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '6px',
            padding: '0.65rem',
            fontSize: '0.75rem',
            color: '#cbd5e1',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <Building2 style={{ width: 16, height: 16, color: '#10b981' }} />
            <div>
              <div style={{ fontWeight: 600, color: '#f8fafc' }}>{activeBoundBranch ? activeBoundBranch.branchName : 'No Branch Bound'}</div>
              <div style={{ fontSize: '0.68rem', color: '#10b981', textTransform: 'uppercase' }}>Bound Branch ({activeBoundBranch?.branchCode || 'N/A'})</div>
            </div>
          </div>

          {/* Operator Info Pill */}
          <div style={{
            backgroundColor: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '6px',
            padding: '0.65rem',
            fontSize: '0.75rem',
            color: '#cbd5e1',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <UserCheck style={{ width: 16, height: 16, color: '#38bdf8' }} />
            <div>
              <div style={{ fontWeight: 600, color: '#f8fafc' }}>{user.name}</div>
              <div style={{ fontSize: '0.68rem', color: '#38bdf8', textTransform: 'uppercase' }}>Role: {user.role}</div>
            </div>
          </div>

          {/* Footer Status Pill */}
          <div style={{
            backgroundColor: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '6px',
            padding: '0.65rem',
            fontSize: '0.75rem',
            color: '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <ShieldCheck style={{ width: 16, height: 16, color: '#4ade80' }} />
            <span>100% Offline Desktop Shell</span>
          </div>
        </div>
      </aside>

      {/* Main Content View Area */}
      <main style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
        {activeTab === 'dashboard' && <DashboardPage />}
        {activeTab === 'billing' && <BillingPage />}
        {activeTab === 'products' && <ProductsPage />}
        {activeTab === 'inventory' && <InventoryPage />}
        {activeTab === 'customers' && <CustomersPage />}
        {activeTab === 'sales' && <SalesPage />}
        {activeTab === 'reports' && <ReportsPage />}
        {activeTab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
};
