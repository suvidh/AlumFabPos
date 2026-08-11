import React, { useEffect, useState } from 'react';
import { DatabaseHealthResult, AppInfoResult, AppPathsResult } from '../../../electron/ipc/contracts';
import { Cpu, CheckCircle2, AlertTriangle, HardDrive, ShieldCheck } from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const [appInfo, setAppInfo] = useState<AppInfoResult | null>(null);
  const [appPaths, setAppPaths] = useState<AppPathsResult | null>(null);
  const [dbHealth, setDbHealth] = useState<DatabaseHealthResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    async function loadSystemStatus() {
      if (window.alumfab) {
        try {
          const info = await window.alumfab.getAppInfo();
          const paths = await window.alumfab.getAppPaths();
          const health = await window.alumfab.checkDatabaseHealth();

          setAppInfo(info);
          setAppPaths(paths);
          setDbHealth(health);
        } catch (e) {
          console.error('Failed querying system status via IPC bridge:', e);
        }
      }
      setLoading(false);
    }
    loadSystemStatus();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header Banner */}
      <div style={{
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '12px',
        padding: '1.5rem 2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            ALUMFAB POS
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            System Foundation Ready — Phase 1 Application Shell & Offline SQLite Architecture
          </p>
        </div>
        <div style={{
          backgroundColor: 'rgba(37, 99, 235, 0.15)',
          color: '#60a5fa',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          padding: '0.4rem 0.85rem',
          borderRadius: '9999px',
          fontSize: '0.8rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          <ShieldCheck style={{ width: 16, height: 16 }} /> 100% Offline Desktop Shell
        </div>
      </div>

      {/* System Indicators Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '1.25rem'
      }}>
        {/* Electron Shell Status */}
        <div style={{
          backgroundColor: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '10px',
          padding: '1.25rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ backgroundColor: '#2563eb', padding: '0.5rem', borderRadius: '8px', color: 'white' }}>
              <Cpu style={{ width: 20, height: 20 }} />
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#f8fafc', margin: 0 }}>
                Electron Container
              </h3>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>IPC Bridge Status</span>
            </div>
          </div>
          <div style={{ fontSize: '0.875rem', color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Status:</span>
              <span style={{ color: '#4ade80', fontWeight: 600 }}>Connected</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Platform:</span>
              <span style={{ fontWeight: 500 }}>{appInfo?.platform || 'Windows'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Version:</span>
              <span style={{ fontWeight: 500 }}>{appInfo?.version || '1.0.0'}</span>
            </div>
          </div>
        </div>

        {/* Database Engine Status */}
        <div style={{
          backgroundColor: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '10px',
          padding: '1.25rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ backgroundColor: dbHealth?.ok ? '#16a34a' : '#dc2626', padding: '0.5rem', borderRadius: '8px', color: 'white' }}>
              <HardDrive style={{ width: 20, height: 20 }} />
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#f8fafc', margin: 0 }}>
                SQLite Persistence
              </h3>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Prisma ORM Engine</span>
            </div>
          </div>
          <div style={{ fontSize: '0.875rem', color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Connection:</span>
              <span style={{ color: dbHealth?.ok ? '#4ade80' : '#f87171', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                {dbHealth?.ok ? <CheckCircle2 style={{ width: 14, height: 14 }} /> : <AlertTriangle style={{ width: 14, height: 14 }} />}
                {dbHealth?.ok ? 'Healthy' : 'Error'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Schema Version:</span>
              <span style={{ fontWeight: 500 }}>{dbHealth?.details?.schemaVersion || 1}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Message:</span>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{dbHealth?.message || 'Connecting...'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Directory Paths Summary */}
      <div style={{
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '10px',
        padding: '1.25rem'
      }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.75rem' }}>
          AppData Storage Directories
        </h3>
        <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div><strong style={{ color: '#94a3b8' }}>Database File:</strong> {appPaths?.databaseFile || '%APPDATA%\\ALUMFAB-POS\\database\\pos.db'}</div>
          <div><strong style={{ color: '#94a3b8' }}>Logs Directory:</strong> {appPaths?.logsDir || '%APPDATA%\\ALUMFAB-POS\\logs'}</div>
          <div><strong style={{ color: '#94a3b8' }}>Backups Directory:</strong> {appPaths?.backupDir || '%APPDATA%\\ALUMFAB-POS\\backups'}</div>
          <div><strong style={{ color: '#94a3b8' }}>Logos Directory:</strong> {appPaths?.logosDir || '%APPDATA%\\ALUMFAB-POS\\assets\\logos'}</div>
        </div>
      </div>
    </div>
  );
};
