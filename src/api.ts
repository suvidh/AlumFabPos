/**
 * alumfab-api.ts — Renderer-side API singleton
 *
 * Returns window.alumfab when running inside Electron (injected by contextBridge).
 * When running in a plain browser (e.g. Tailscale remote access), returns an HTTP
 * fetch-based implementation that talks to the Express server on port 3333.
 *
 * Usage:
 *   import { api } from '@/api';
 *   const products = await api.getAllProducts();
 *
 * IMPORTANT: this file must NOT import from 'electron' — it runs in the renderer.
 */

import type { 
  AlumfabAPI, 
  ConflictStrategy, 
  ImportDryRunResult,
  ImportCommitResult,
  AppInfoResult,
  AppPathsResult,
  DatabaseHealthResult,
  PingResult,
  UpdateState
} from '../electron/ipc/contracts';
import type { 
  Company, 
  Branch, 
  Product, 
  BranchInventory, 
  Customer, 
  Sale, 
  StockMovement, 
  StockMovementType,
  Supplier,
  Purchase,
  Expense,
  Category,
  SalesReturn,
  VoidAuditLog,
  CashShift,
  BackupMetadata
} from '@prisma/client';

// ── Browser-mode updater stub ──────────────────────────────────────────────
const BROWSER_UPDATE_STATE: UpdateState = {
  status: 'idle',
  currentVersion: 'browser',
  availableVersion: null,
  releaseNotes: null,
  releaseDate: null,
  downloadPercent: 0,
  bytesPerSecond: 0,
  error: null,
  lastCheckedAt: null,
  updateReadyToInstall: false
};

// ── HTTP base URL ──────────────────────────────────────────────────────────
// Route api calls relatively through the Vite dev-server proxy to avoid CORS/Mixed Content.
const API_BASE = '/api';

// ── Helpers ────────────────────────────────────────────────────────────────
async function http<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── HTTP implementation (used in plain browser) ────────────────────────────
const httpAPI: AlumfabAPI = {
  // System
  getAppInfo:           () => http<AppInfoResult>('GET', '/app-info'),
  getAppPaths:          () => http<AppPathsResult>('GET', '/app-paths'),
  checkDatabaseHealth:  () => http<DatabaseHealthResult>('GET', '/db/health'),
  ping:                 () => http<PingResult>('GET', '/ping'),

  // Company
  getCompany:           () => http<{ company: Company; defaultBranch: Branch | null }>('GET', '/company'),
  updateCompany:        (companyId: string, data: Partial<Company>) => 
    http<Company>('PATCH', `/company/${companyId}`, data),

  // Branches
  getAllBranches:        () => http<Branch[]>('GET', '/branches'),
  getBranchById:        (branchId: string) => http<Branch | null>('GET', `/branches/${branchId}`),
  createBranch:         (data: {
    companyId: string;
    code: string;
    name: string;
    address?: string;
    gstin?: string;
    phone?: string;
    state?: string;
    invoicePrefix?: string;
    logoPath?: string;
  }) => http<Branch>('POST', '/branches', data),
  updateBranch:         (branchId: string, data: {
    name?: string;
    address?: string;
    gstin?: string;
    phone?: string;
    state?: string;
    invoicePrefix?: string;
    logoPath?: string;
    isActive?: boolean;
  }) => http<Branch>('PATCH', `/branches/${branchId}`, data),
  deleteBranch:         (branchId: string) =>
    http<{ softDeleted: boolean }>('DELETE', `/branches/${branchId}`),

  // Categories
  getAllCategories:      (includeInactive?: boolean) =>
    http<Category[]>('GET', `/categories${includeInactive ? '?includeInactive=true' : ''}`),
  createCategory:        (name: string) =>
    http<Category>('POST', '/categories', { name }),
  updateCategory:        (categoryId: string, data: { name?: string; isActive?: boolean }) =>
    http<Category>('PATCH', `/categories/${categoryId}`, data),

  // Products
  getAllProducts:        (includeInactive?: boolean) =>
    http<Product[]>('GET', `/products${includeInactive ? '?includeInactive=true' : ''}`),
  createProduct:        (data: {
    sku: string;
    name: string;
    barcode?: string;
    categoryId?: string;
    brand?: string;
    profile?: string;
    size?: string;
    finish?: string;
    sellingPrice: number;
    sellingUnit?: string;
    sourceUnit?: string;
    weightPerPiece?: number;
    length?: number;
    minimumStock?: number;
  }) => http<Product>('POST', '/products', data),
  updateProduct:        (productId: string, data: {
    name?: string;
    barcode?: string;
    brand?: string;
    profile?: string;
    size?: string;
    finish?: string;
    sellingPrice?: number;
    sellingUnit?: string;
    sourceUnit?: string;
    minimumStock?: number;
    isActive?: boolean;
  }) => http<Product>('PATCH', `/products/${productId}`, data),

  // Inventory
  getBranchInventory:   (branchId: string) => 
    http<(BranchInventory & { product: Product })[]>('GET', `/inventory/${branchId}`),
  adjustStock:          (
    branchId: string, 
    productId: string, 
    deltaQuantityDecimal: number, 
    type: StockMovementType, 
    reason?: string
  ) =>
    http<{ inventory: BranchInventory; movement: StockMovement }>('POST', '/inventory/adjust', { 
      branchId, 
      productId, 
      deltaQuantityDecimal, 
      type, 
      reason 
    }),

  // Customers
  getAllCustomers:       (includeInactive?: boolean) =>
    http<Customer[]>('GET', `/customers${includeInactive ? '?includeInactive=true' : ''}`),
  createCustomer:       (data: {
    name: string;
    phone?: string;
    gstin?: string;
    state?: string;
    address?: string;
    notes?: string;
  }) => http<Customer>('POST', '/customers', data),
  updateCustomer:       (customerId: string, data: {
    name?: string;
    phone?: string;
    gstin?: string;
    state?: string;
    address?: string;
    notes?: string;
    isActive?: boolean;
  }) => http<Customer>('PATCH', `/customers/${customerId}`, data),

  createSale:           (data: {
    branchId: string;
    customerId?: string;
    items: { productId: string; quantityDecimal: number; rateRupees?: number; discountRupees?: number }[];
    discountType?: any;
    discountValueBasisPoints?: number;
    discountRupees?: number;
    discountNote?: string;
    paymentMethod?: any;
    paymentAmountRupees?: number;
    chequeNumber?: string;
    chequeBank?: string;
    chequeDate?: Date;
    payments?: {
      method: any;
      amountRupees: number;
      chequeNumber?: string;
    }[];
  }) => http<Sale>('POST', '/sales', data),
  getAllSales:           (branchId?: string) =>
    http<Sale[]>('GET', `/sales${branchId ? `?branchId=${branchId}` : ''}`),

  // Supplier
  getAllSuppliers:       (includeInactive?: boolean) =>
    http<Supplier[]>('GET', `/suppliers${includeInactive ? '?includeInactive=true' : ''}`),
  createSupplier:        (data: { name: string; phone?: string; address?: string; gstin?: string; notes?: string }) =>
    http<Supplier>('POST', '/suppliers', data),
  updateSupplier:        (supplierId: string, data: { name?: string; phone?: string; address?: string; gstin?: string; notes?: string; isActive?: boolean }) =>
    http<Supplier>('PATCH', `/suppliers/${supplierId}`, data),

  // Purchase
  createPurchase:        (data: { branchId: string; supplierId?: string; referenceNumber?: string; notes?: string; items: { productId: string; quantityDecimal: number; rateRupees: number }[] }) =>
    http<Purchase>('POST', '/purchases', data),
  getAllPurchases:       (branchId?: string) =>
    http<Purchase[]>('GET', `/purchases${branchId ? `?branchId=${branchId}` : ''}`),

  // Expense
  createExpense:         (data: { branchId: string; categoryDescription: string; amountRupees: number; notes?: string }) =>
    http<Expense>('POST', '/expenses', data),
  getAllExpenses:        (branchId?: string) =>
    http<Expense[]>('GET', `/expenses${branchId ? `?branchId=${branchId}` : ''}`),

  // Product Import
  getImportDefaultPath: () =>
    http<{ path: string }>('GET', '/import/default-path').then(r => r.path),
  runImportDryRun:      (filePath: string) => http<ImportDryRunResult>('POST', '/import/dry-run', { filePath }),
  commitImport:         (dryRunResult: ImportDryRunResult, conflictStrategy: ConflictStrategy) =>
    http<ImportCommitResult>('POST', '/import/commit', { dryRunResult, conflictStrategy }),
  printSilent:          (htmlContent: string, options?: { silent?: boolean; deviceName?: string }) =>
    http<boolean>('POST', '/print/silent', { htmlContent, options }),
  downloadInvoicePdf:   (htmlContent: string, suggestedFileName: string) => {
    // Remote/browser tabs (e.g. Tailscale access) have no native Save dialog
    // or PDF renderer to call into. Fall back to downloading the invoice as
    // an .html file — the browser's own Print > Save as PDF covers the rest.
    try {
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggestedFileName.endsWith('.html') ? suggestedFileName : `${suggestedFileName}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return Promise.resolve({ success: true });
    } catch (err) {
      return Promise.resolve({
        success: false,
        error: err instanceof Error ? err.message : 'Failed to download invoice.'
      });
    }
  },
  getSalesHistory:      (filters: any) =>
    http<{ sales: Sale[]; totalCount: number }>('POST', '/sales/history', filters),
  processReturn:        (data: any) =>
    http<SalesReturn>('POST', '/sales/return', data),
  voidSale:             (data: any) =>
    http<VoidAuditLog>('POST', '/sales/void', data),
  openShift:            (branchId: string, cashierId: string, startingFloatRupees: number) =>
    http<CashShift>('POST', '/reports/z-report/open', { branchId, cashierId, startingFloatRupees }),
  getOpenShift:         (branchId: string, cashierId: string) =>
    http<CashShift | null>('GET', `/reports/z-report/open?branchId=${branchId}&cashierId=${cashierId}`),
  closeShift:           (data: any) =>
    http<CashShift>('POST', '/reports/z-report/close', data),
  getSalesSummary:      (branchId: string, filters: any) =>
    http<any>('POST', `/reports/summary?branchId=${branchId}`, filters),
  getTaxLiabilityReport: (branchId: string, filters: any) =>
    http<any[]>('POST', `/reports/tax-liability?branchId=${branchId}`, filters),
  getTopSellingProducts: (branchId: string, limit?: number) =>
    http<any[]>('GET', `/reports/top-products?branchId=${branchId}&limit=${limit || 10}`),
  getProfitMarginAnalysis: (branchId: string, filters: any) =>
    http<any>('POST', `/reports/profit-margin?branchId=${branchId}`, filters),
  triggerBackup:        (backupType?: 'MANUAL' | 'AUTOMATIC') =>
    http<BackupMetadata>('POST', '/system/backup/trigger', { backupType }),
  listBackups:          () =>
    http<BackupMetadata[]>('GET', '/system/backup/list'),
  restoreBackup:        (backupId: string) =>
    http<boolean>('POST', '/system/restore', { backupId }),

  // ── Auto-Updater ─────────────────────────────────────────────────────────
  // A plain browser session (remote stock-take tablet over Tailscale) is not
  // the thing being updated — the desktop till is. These resolve to a benign
  // "nothing to do" so shared UI can render the update panel unconditionally.
  checkForUpdates:      () => Promise.resolve(BROWSER_UPDATE_STATE),
  getUpdateState:       () => Promise.resolve(BROWSER_UPDATE_STATE),
  installUpdateNow:     () => Promise.resolve(false),
  onUpdateEvent:        () => () => undefined
};

// ── Export the right implementation ───────────────────────────────────────
// `window.alumfab` is set by Electron's contextBridge preload.
// If it doesn't exist we're in a plain browser → use HTTP.
function getAPI(): AlumfabAPI {
  if (typeof window !== 'undefined' && (window as Window & { alumfab?: AlumfabAPI }).alumfab) {
    return (window as Window & { alumfab: AlumfabAPI }).alumfab;
  }
  return httpAPI;
}

/**
 * Single entry-point for all data operations in the renderer.
 * Works in both Electron (IPC) and browser (HTTP) environments.
 */
export const api: AlumfabAPI = getAPI();

/**
 * Polyfill window.alumfab with the HTTP implementation so all existing
 * `window.alumfab` call-sites in page components continue to work
 * without any changes.
 */
export function polyfillWindowAlumfab(): void {
  const w = window as Window & { alumfab?: AlumfabAPI };
  if (!w.alumfab) {
    w.alumfab = httpAPI;
  }
}
