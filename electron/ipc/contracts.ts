import { 
  Company, Branch, Product, BranchInventory, 
  Customer, Sale, StockMovement, PaymentMethod, 
  DiscountType, StockMovementType, SellingUnit,
  Supplier, Purchase, Expense, Category
} from '@prisma/client';

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
    items: { productId: string; quantityDecimal: number; rateRupees?: number }[];
    discountType?: DiscountType;
    discountValueBasisPoints?: number;
    discountRupees?: number;
    discountNote?: string;
    paymentMethod?: PaymentMethod;
    chequeNumber?: string;
    chequeBank?: string;
    chequeDate?: Date;
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
}
