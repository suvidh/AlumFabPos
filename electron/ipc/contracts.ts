import { 
  Company, Branch, Product, BranchInventory, 
  Customer, Sale, StockMovement, PaymentMethod, 
  DiscountType, StockMovementType, SellingUnit,
  Supplier, Purchase, Expense, Category,
  SalesReturn, VoidAuditLog, SaleStatus, CashShift, BackupMetadata
} from '@prisma/client';
import { SalesHistoryFilters, ProcessReturnInput, ProcessVoidInput } from '../../src/services/salesService';
import { CloseShiftInput, DateRangeFilters } from '../../src/services/reportService';

// ============================================================
// Product Import Pipeline Contracts
// (mirrored from productImportService.ts for type-safe IPC)
// ============================================================

export type ConflictStrategy = 'SKIP' | 'UPDATE_EXISTING' | 'CANCEL_IMPORT';
export type RowStatus = 'NEW' | 'SKIP' | 'UPDATE' | 'ERROR';

export interface ImportRowResult {
  rowNumber:   number;
  sku:         string;
  name:        string;
  price:       number;      // rupees (display)
  pricePaise:  number;      // paise (storage)
  sellingUnit: SellingUnit;
  sourceUnit:  string;
  barcode:     string;
  status:      RowStatus;
  warnings:    string[];
  errors:      string[];
}

export interface ImportDryRunResult {
  sourceFile:            string;
  sheetName:             string;
  totalRows:             number;
  validRows:             number;
  warningRows:           number;
  errorRows:             number;
  newProducts:           number;
  existingSkuConflicts:  number;
  barcodeConflicts:      number;
  rows:                  ImportRowResult[];
}

export interface ImportCommitResult {
  success:       boolean;
  importedCount: number;
  skippedCount:  number;
  updatedCount:  number;
  errors:        string[];
}

export interface AppInfoResult {
  name: string;
  version: string;
  platform: string;
  arch: string;
  isOffline: boolean;
}

export interface AppPathsResult {
  rootDir: string;
  databaseDir: string;
  databaseFile: string;
  backupDir: string;
  logsDir: string;
  logosDir: string;
}

export interface DatabaseHealthResult {
  ok: boolean;
  message: string;
  timestamp: string;
  details?: {
    schemaVersion: number;
    appVersion?: string;
    path?: string;
  };
}

export interface PingResult {
  pong: boolean;
  timestamp: string;
}

// ============================================================
// Auto-Updater Contracts
// ============================================================

/**
 * idle        — nothing to do, or the last check found no newer build
 * checking    — talking to the update feed right now
 * downloading — a newer build is being pulled in the background
 * ready       — package staged on disk; applies on restart or next quit
 * error       — last operation failed (usually just "shop is offline")
 */
export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  /** Version currently running. */
  currentVersion: string;
  /** Version on the feed, once known. */
  availableVersion: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  /** 0-100, only meaningful while status === 'downloading'. */
  downloadPercent: number;
  bytesPerSecond: number;
  error: string | null;
  /** ISO timestamp of the last completed check. */
  lastCheckedAt: string | null;
  /**
   * True once the package is on disk. The UI should surface a non-blocking
   * "Restart to update" affordance — never an automatic restart mid-shift.
   */
  updateReadyToInstall: boolean;
}

export interface AlumfabAPI {
  // System Methods
  getAppInfo: () => Promise<AppInfoResult>;
  getAppPaths: () => Promise<AppPathsResult>;
  checkDatabaseHealth: () => Promise<DatabaseHealthResult>;
  ping: () => Promise<PingResult>;

  // Company Domain Methods
  getCompany: () => Promise<{ company: Company; defaultBranch: Branch | null }>;
  updateCompany: (companyId: string, data: Partial<Company>) => Promise<Company>;

  // Branch Domain Methods
  getAllBranches: () => Promise<Branch[]>;
  getBranchById: (branchId: string) => Promise<Branch | null>;
  createBranch: (data: {
    companyId: string;
    code: string;
    name: string;
    address?: string;
    gstin?: string;
    phone?: string;
    state?: string;
    invoicePrefix?: string;
    logoPath?: string;
  }) => Promise<Branch>;
  updateBranch: (branchId: string, data: {
    name?: string;
    address?: string;
    gstin?: string;
    phone?: string;
    state?: string;
    invoicePrefix?: string;
    logoPath?: string;
    isActive?: boolean;
  }) => Promise<Branch>;
  deleteBranch: (branchId: string) => Promise<{ softDeleted: boolean }>;

  // Product Domain Methods
  getAllProducts: (includeInactive?: boolean) => Promise<Product[]>;
  createProduct: (data: {
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
  }) => Promise<Product>;
  updateProduct: (productId: string, data: {
    name?: string;
    categoryId?: string;
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
  }) => Promise<Product>;

  // Inventory Domain Methods
  getBranchInventory: (branchId: string) => Promise<(BranchInventory & { product: Product })[]>;
  adjustStock: (
    branchId: string,
    productId: string,
    deltaQuantityDecimal: number,
    type: StockMovementType,
    reason?: string
  ) => Promise<{ inventory: BranchInventory; movement: StockMovement }>;

  // Customer Domain Methods
  getAllCustomers: (includeInactive?: boolean) => Promise<Customer[]>;
  createCustomer: (data: {
    name: string;
    phone?: string;
    gstin?: string;
    state?: string;
    address?: string;
    notes?: string;
  }) => Promise<Customer>;
  updateCustomer: (customerId: string, data: {
    name?: string;
    phone?: string;
    gstin?: string;
    state?: string;
    address?: string;
    notes?: string;
    isActive?: boolean;
  }) => Promise<Customer>;

  // Sales Domain Methods
  createSale: (data: {
    branchId: string;
    customerId?: string;
    items: { productId: string; quantityDecimal: number; rateRupees?: number; discountRupees?: number }[];
    discountType?: DiscountType;
    discountValueBasisPoints?: number;
    discountRupees?: number;
    discountNote?: string;
    paymentMethod?: PaymentMethod;
    paymentAmountRupees?: number;
    chequeNumber?: string;
    chequeBank?: string;
    chequeDate?: Date;
    payments?: {
      method: PaymentMethod;
      amountRupees: number;
      chequeNumber?: string;
    }[];
  }) => Promise<Sale>;
  getAllSales: (branchId?: string) => Promise<Sale[]>;

  // Category Methods
  getAllCategories: (includeInactive?: boolean) => Promise<Category[]>;
  createCategory: (name: string) => Promise<Category>;
  updateCategory: (categoryId: string, data: { name?: string; isActive?: boolean }) => Promise<Category>;

  // Supplier Methods
  getAllSuppliers: (includeInactive?: boolean) => Promise<Supplier[]>;
  createSupplier: (data: {
    name: string;
    phone?: string;
    address?: string;
    gstin?: string;
    notes?: string;
  }) => Promise<Supplier>;
  updateSupplier: (supplierId: string, data: {
    name?: string;
    phone?: string;
    address?: string;
    gstin?: string;
    notes?: string;
    isActive?: boolean;
  }) => Promise<Supplier>;

  // Purchase Methods
  createPurchase: (data: {
    branchId: string;
    supplierId?: string;
    referenceNumber?: string;
    notes?: string;
    items: {
      productId: string;
      quantityDecimal: number;
      rateRupees: number;
    }[];
  }) => Promise<Purchase>;
  getAllPurchases: (branchId?: string) => Promise<Purchase[]>;

  // Expense Methods
  createExpense: (data: {
    branchId: string;
    categoryDescription: string;
    amountRupees: number;
    notes?: string;
  }) => Promise<Expense>;
  getAllExpenses: (branchId?: string) => Promise<Expense[]>;

  // Product Import Pipeline Methods
  /** Returns the default expected path of the ODS file (read-only source) */
  getImportDefaultPath: () => Promise<string>;
  /** Dry-run: parse + validate the ODS at filePath, check DB conflicts, return summary (no writes) */
  runImportDryRun: (filePath: string) => Promise<ImportDryRunResult>;
  /** Commit: write validated rows to DB in a single transaction using chosen conflict strategy */
  commitImport: (dryRunResult: ImportDryRunResult, conflictStrategy: ConflictStrategy) => Promise<ImportCommitResult>;

  /** Direct silent printing of compiled HTML content to default printer or named device */
  printSilent: (htmlContent: string, options?: { silent?: boolean; deviceName?: string }) => Promise<boolean>;

  /**
   * Renders an invoice HTML document to PDF and prompts the operator with a
   * native Save dialog. Resolves with the chosen path, or `canceled: true`
   * if the operator dismissed the dialog without saving.
   */
  downloadInvoicePdf: (
    htmlContent: string,
    suggestedFileName: string
  ) => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>;

  // History, Returns, and Voids Methods
  getSalesHistory: (filters: SalesHistoryFilters) => Promise<{ sales: Sale[]; totalCount: number }>;
  processReturn: (data: ProcessReturnInput) => Promise<SalesReturn>;
  voidSale: (data: ProcessVoidInput) => Promise<VoidAuditLog>;

  // Shift and Reconciliation Methods
  openShift: (branchId: string, cashierId: string, startingFloatRupees: number) => Promise<CashShift>;
  getOpenShift: (branchId: string, cashierId: string) => Promise<CashShift | null>;
  closeShift: (data: CloseShiftInput) => Promise<CashShift>;

  // Analytics Reports Methods
  getSalesSummary: (branchId: string, filters: DateRangeFilters) => Promise<{ grossSales: number; discounts: number; netSales: number; taxesCollected: number; salesCount: number }>;
  getTaxLiabilityReport: (branchId: string, filters: DateRangeFilters) => Promise<any[]>;
  getTopSellingProducts: (branchId: string, limit?: number) => Promise<any[]>;
  getProfitMarginAnalysis: (branchId: string, filters: DateRangeFilters) => Promise<{ revenue: number; cogs: number; grossProfit: number; profitMarginPercent: number }>;

  // Backup and Disaster Recovery Methods
  triggerBackup: (backupType?: 'MANUAL' | 'AUTOMATIC') => Promise<BackupMetadata>;
  listBackups: () => Promise<BackupMetadata[]>;
  restoreBackup: (backupId: string) => Promise<boolean>;

  // Auto-Updater Methods
  /** Force a feed check now (Settings > Updates). Resolves with the new state. */
  checkForUpdates: () => Promise<UpdateState>;
  /** Current updater snapshot — safe to call on mount. */
  getUpdateState: () => Promise<UpdateState>;
  /**
   * Restart and apply a staged update. Call ONLY after confirming the cart is
   * empty and no cash shift is open. Resolves false when nothing is staged.
   */
  installUpdateNow: () => Promise<boolean>;
  /**
   * Subscribe to updater state pushes. Returns an unsubscribe function; call it
   * from your effect cleanup or you will leak a listener per remount.
   */
  onUpdateEvent: (callback: (state: UpdateState) => void) => () => void;
}
