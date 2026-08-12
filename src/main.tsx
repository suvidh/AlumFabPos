import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from './app/components/ErrorBoundary';
import { MainLayout } from './app/layouts/MainLayout';
import { UserProvider } from './app/context/UserContext';
import { POSConfigProvider } from './app/context/POSConfigStore';
import { polyfillWindowAlumfab } from './api';
import { SyncCoordinator } from './services/syncCoordinator';
import './index.css';

// Polyfill window.alumfab with HTTP fetch implementation when not in Electron
polyfillWindowAlumfab();

// Initialize offline background sync listener
SyncCoordinator.init();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <UserProvider>
        <POSConfigProvider>
          <MainLayout />
        </POSConfigProvider>
      </UserProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

