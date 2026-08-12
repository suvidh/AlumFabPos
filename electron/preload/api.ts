/**
 * alumfabAPI — dual-mode API bridge
 *
 * • In Electron (desktop app): calls are routed through ipcRenderer (zero network).
 * • In a plain browser (e.g. Tailscale remote access): calls are routed through
 *   the Express REST API running on port 3333 inside the Electron main process.
 */

// ── Runtime detection ────────────────────────────────────────────────────────
// `ipcRenderer` is only available inside the Electron preload/renderer context.
// When this module is loaded by a plain browser, ipcRenderer is undefined.
let ipcRenderer: typeof import('electron').ipcRenderer | undefined;
try {
  // This will throw / be undefined in a browser environment
  ipcRenderer = require('electron').ipcRenderer;
} catch {
  ipcRenderer = undefined;
}

const IS_ELECTRON = typeof ipcRenderer !== 'undefined';

// ── HTTP base URL ────────────────────────────────────────────────────────────
// When running in a browser, target the machine that serves the Vite dev-server
// (same hostname, port 3333).
const API_BASE = `${window.location.protocol}//${window.location.hostname}:3333/api`;

// ── Helper: HTTP fetch ───────────────────────────────────────────────────────
async function http<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── IPC_CHANNELS mirror ──────────────────────────────────────────────────────
import { IPC_CHANNELS } from '../ipc/channels';
import { AlumfabAPI, UpdateState } from '../ipc/contracts';

// Browser-mode fallback: a remote tablet reaching the till over Tailscale is
// not the thing that gets updated, so the updater reports a benign idle state.
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

// ── API implementation ───────────────────────────────────────────────────────
export const alumfabAPI: AlumfabAPI = {
  // ── System ─────────────────────────────────────────────────────────────
  getAppInfo: () =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.APP_GET_INFO)
      : http('GET', '/app-info'),

  getAppPaths: () =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.APP_GET_PATHS)
      : http('GET', '/app-paths'),

  checkDatabaseHealth: () =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.DB_HEALTH_CHECK)
      : http('GET', '/db/health'),

  ping: () =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.APP_PING)
      : http('GET', '/ping'),

  // ── Company ─────────────────────────────────────────────────────────────
  getCompany: () =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.COMPANY_GET)
      : http('GET', '/company'),

  updateCompany: (companyId, data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.COMPANY_UPDATE, { companyId, data })
      : http('PATCH', `/company/${companyId}`, data),

  // ── Branch ──────────────────────────────────────────────────────────────
  getAllBranches: () =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.BRANCH_GET_ALL)
      : http('GET', '/branches'),

  getBranchById: (branchId) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.BRANCH_GET_BY_ID, { branchId })
      : http('GET', `/branches/${branchId}`),

  createBranch: (data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.BRANCH_CREATE, data)
      : http('POST', '/branches', data),

  updateBranch: (branchId, data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.BRANCH_UPDATE, { branchId, data })
      : http('PATCH', `/branches/${branchId}`, data),

  deleteBranch: (branchId) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.BRANCH_DELETE, { branchId })
      : http('DELETE', `/branches/${branchId}`),

  // ── Categories ──────────────────────────────────────────────────────────
  getAllCategories: (includeInactive) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.CATEGORY_GET_ALL, { includeInactive })
      : http('GET', `/categories${includeInactive ? '?includeInactive=true' : ''}`),

  createCategory: (name) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.CATEGORY_CREATE, { name })
      : http('POST', '/categories', { name }),

  updateCategory: (categoryId, data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.CATEGORY_UPDATE, { categoryId, data })
      : http('PATCH', `/categories/${categoryId}`, data),

  // ── Products ────────────────────────────────────────────────────────────
  getAllProducts: (includeInactive) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.PRODUCT_GET_ALL, { includeInactive })
      : http('GET', `/products${includeInactive ? '?includeInactive=true' : ''}`),

  createProduct: (data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.PRODUCT_CREATE, data)
      : http('POST', '/products', data),

  updateProduct: (productId, data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.PRODUCT_UPDATE, { productId, data })
      : http('PATCH', `/products/${productId}`, data),

  // ── Inventory ───────────────────────────────────────────────────────────
  getBranchInventory: (branchId) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.INVENTORY_GET_BRANCH, { branchId })
      : http('GET', `/inventory/${branchId}`),

  adjustStock: (branchId, productId, deltaQuantityDecimal, type, reason) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.INVENTORY_ADJUST, { branchId, productId, deltaQuantityDecimal, type, reason })
      : http('POST', '/inventory/adjust', { branchId, productId, deltaQuantityDecimal, type, reason }),

  // ── Customers ───────────────────────────────────────────────────────────
  getAllCustomers: (includeInactive) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.CUSTOMER_GET_ALL, { includeInactive })
      : http('GET', `/customers${includeInactive ? '?includeInactive=true' : ''}`),

  createCustomer: (data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.CUSTOMER_CREATE, data)
      : http('POST', '/customers', data),

  updateCustomer: (customerId, data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.CUSTOMER_UPDATE, { customerId, data })
      : http('PATCH', `/customers/${customerId}`, data),

  // ── Sales ───────────────────────────────────────────────────────────────
  createSale: (data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.SALE_CREATE, data)
      : http('POST', '/sales', data),

  getAllSales: (branchId) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.SALE_GET_ALL, { branchId })
      : http('GET', `/sales${branchId ? `?branchId=${branchId}` : ''}`),

  // ── Suppliers ───────────────────────────────────────────────────────────
  getAllSuppliers: (includeInactive) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.SUPPLIER_GET_ALL, { includeInactive })
      : http('GET', `/suppliers${includeInactive ? '?includeInactive=true' : ''}`),

  createSupplier: (data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.SUPPLIER_CREATE, data)
      : http('POST', '/suppliers', data),

  updateSupplier: (supplierId, data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.SUPPLIER_UPDATE, { supplierId, data })
      : http('PATCH', `/suppliers/${supplierId}`, data),

  // ── Purchases ───────────────────────────────────────────────────────────
  createPurchase: (data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.PURCHASE_CREATE, data)
      : http('POST', '/purchases', data),

  getAllPurchases: (branchId) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.PURCHASE_GET_ALL, { branchId })
      : http('GET', `/purchases${branchId ? `?branchId=${branchId}` : ''}`),

  // ── Expenses ────────────────────────────────────────────────────────────
  createExpense: (data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.EXPENSE_CREATE, data)
      : http('POST', '/expenses', data),

  getAllExpenses: (branchId) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.EXPENSE_GET_ALL, { branchId })
      : http('GET', `/expenses${branchId ? `?branchId=${branchId}` : ''}`),

  // ── Product Import ──────────────────────────────────────────────────────
  getImportDefaultPath: () =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.PRODUCT_IMPORT_GET_DEFAULT_PATH)
      : http<{ path: string }>('GET', '/import/default-path').then(r => r.path),

  runImportDryRun: (filePath) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.PRODUCT_IMPORT_DRY_RUN, { filePath })
      : http('POST', '/import/dry-run', { filePath }),

  commitImport: (dryRunResult, conflictStrategy) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.PRODUCT_IMPORT_COMMIT, { dryRunResult, conflictStrategy })
      : http('POST', '/import/commit', { dryRunResult, conflictStrategy }),

  printSilent: (htmlContent, options) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.PRINT_SILENT, { htmlContent, options })
      : Promise.resolve(false),

  downloadInvoicePdf: (htmlContent, suggestedFileName) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.PRINT_SAVE_INVOICE_PDF, { htmlContent, suggestedFileName })
      : // Remote/browser mode (e.g. Tailscale access) has no native Save
        // dialog or PDF renderer to call into. Fall back to downloading the
        // invoice as an .html file — the browser's own Print > Save as PDF
        // covers the rest, and this is still strictly better than failing.
        (() => {
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
        })(),

  getSalesHistory: (filters) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.SALE_GET_HISTORY, { filters })
      : Promise.resolve({ sales: [], totalCount: 0 }),

  processReturn: (data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.SALE_RETURN, { data })
      : Promise.reject(new Error('IPC only')),

  voidSale: (data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.SALE_VOID, { data })
      : Promise.reject(new Error('IPC only')),

  openShift: (branchId, cashierId, startingFloatRupees) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.REPORT_OPEN_SHIFT, { branchId, cashierId, startingFloatRupees })
      : Promise.reject(new Error('IPC only')),

  getOpenShift: (branchId, cashierId) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.REPORT_GET_OPEN_SHIFT, { branchId, cashierId })
      : Promise.resolve(null),

  closeShift: (data) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.REPORT_CLOSE_SHIFT, { data })
      : Promise.reject(new Error('IPC only')),

  getSalesSummary: (branchId, filters) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.REPORT_GET_SUMMARY, { branchId, filters })
      : Promise.reject(new Error('IPC only')),

  getTaxLiabilityReport: (branchId, filters) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.REPORT_GET_TAX, { branchId, filters })
      : Promise.reject(new Error('IPC only')),

  getTopSellingProducts: (branchId, limit) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.REPORT_GET_TOP_PRODUCTS, { branchId, limit })
      : Promise.reject(new Error('IPC only')),

  getProfitMarginAnalysis: (branchId, filters) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.REPORT_GET_PROFIT, { branchId, filters })
      : Promise.reject(new Error('IPC only')),

  triggerBackup: (backupType) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.SYSTEM_BACKUP_TRIGGER, { backupType })
      : Promise.reject(new Error('IPC only')),

  listBackups: () =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.SYSTEM_BACKUP_LIST)
      : Promise.resolve([]),

  restoreBackup: (backupId) =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.SYSTEM_RESTORE, { backupId })
      : Promise.reject(new Error('IPC only')),

  // ── Auto-Updater ────────────────────────────────────────────────────────
  checkForUpdates: () =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.UPDATE_CHECK)
      : Promise.resolve(BROWSER_UPDATE_STATE),

  getUpdateState: () =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.UPDATE_GET_STATE)
      : Promise.resolve(BROWSER_UPDATE_STATE),

  installUpdateNow: () =>
    IS_ELECTRON
      ? ipcRenderer!.invoke(IPC_CHANNELS.UPDATE_INSTALL_NOW)
      : Promise.resolve(false),

  onUpdateEvent: (callback) => {
    if (!IS_ELECTRON) return () => undefined;
    // Deliberately drop the IpcRendererEvent argument: never hand a renderer a
    // live `sender` handle across the context bridge.
    const listener = (_event: unknown, state: UpdateState) => callback(state);
    ipcRenderer!.on(IPC_CHANNELS.UPDATE_EVENT, listener as never);
    return () => {
      ipcRenderer!.removeListener(IPC_CHANNELS.UPDATE_EVENT, listener as never);
    };
  }
};
