import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from './app/components/ErrorBoundary';
import { MainLayout } from './app/layouts/MainLayout';
import { polyfillWindowAlumfab } from './api';
import './index.css';

// Polyfill window.alumfab with HTTP fetch implementation when not in Electron
polyfillWindowAlumfab();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MainLayout />
    </ErrorBoundary>
  </React.StrictMode>
);
