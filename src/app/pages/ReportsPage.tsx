import React from 'react';
import { BarChart3 } from 'lucide-react';

export const ReportsPage: React.FC = () => {
  return (
    <div style={{
      backgroundColor: '#1e293b',
      border: '1px solid #334155',
      borderRadius: '12px',
      padding: '3rem',
      textAlign: 'center',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '400px'
    }}>
      <BarChart3 style={{ width: 48, height: 48, color: '#3b82f6', marginBottom: '1rem' }} />
      <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc', marginBottom: '0.5rem' }}>
        Business Reports
      </h2>
      <p style={{ color: '#94a3b8', fontSize: '0.9rem', maxWidth: '450px' }}>
        Sales summaries, branch performance analytics, stock valuation reports, and GST tax reports will be implemented in later business phase.
      </p>
    </div>
  );
};
