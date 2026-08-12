export const IPC_CHANNELS = {
  // System Channels
  APP_GET_INFO: 'app:get-info',
  APP_GET_PATHS: 'app:get-paths',
  APP_PING: 'app:ping',

  // Database System Channel
  DB_HEALTH_CHECK: 'db:health-check',

  // Phase 2 Business Domain Channels
  COMPANY_GET: 'company:get',
  COMPANY_UPDATE: 'company:update',

  BRANCH_GET_ALL: 'branch:get-all',
  BRANCH_GET_BY_ID: 'branch:get-by-id',
  BRANCH_CREATE: 'branch:create',
  BRANCH_UPDATE: 'branch:update',
  BRANCH_DELETE: 'branch:delete',

  PRODUCT_GET_ALL: 'product:get-all',
  PRODUCT_CREATE: 'product:create',
  PRODUCT_UPDATE: 'product:update',
  PRODUCT_DELETE: 'product:delete',

  // Category Channels
  CATEGORY_GET_ALL: 'category:get-all',
  CATEGORY_CREATE: 'category:create',
  CATEGORY_UPDATE: 'category:update',

  INVENTORY_GET_BRANCH: 'inventory:get-branch',
  INVENTORY_ADJUST: 'inventory:adjust',
  INVENTORY_CHECK_AVAILABILITY: 'inventory:check-availability',
  INVENTORY_TRANSFER: 'inventory:transfer',
  INVENTORY_LOW_STOCK_REPORT: 'inventory:low-stock-report',

  CUSTOMER_GET_ALL: 'customer:get-all',
  CUSTOMER_CREATE: 'customer:create',
  CUSTOMER_UPDATE: 'customer:update',

  SALE_CREATE: 'sale:create',
  SALE_GET_ALL: 'sale:get-all',

  // Supplier, Purchase, and Expense Channels
  SUPPLIER_GET_ALL: 'supplier:get-all',
  SUPPLIER_CREATE: 'supplier:create',
  SUPPLIER_UPDATE: 'supplier:update',
  PURCHASE_CREATE: 'purchase:create',
  PURCHASE_GET_ALL: 'purchase:get-all',
  EXPENSE_CREATE: 'expense:create',
  EXPENSE_GET_ALL: 'expense:get-all',

  // Product Import Pipeline Channels
  PRODUCT_IMPORT_DRY_RUN: 'product:import-dry-run',
  PRODUCT_IMPORT_COMMIT:  'product:import-commit',
  PRODUCT_IMPORT_GET_DEFAULT_PATH: 'product:import-get-default-path',

  // Print Channels
  PRINT_SILENT: 'print:silent',
  PRINT_SAVE_INVOICE_PDF: 'print:save-invoice-pdf',

  // History, Returns, and Voids Channels
  SALE_GET_HISTORY: 'sale:get-history',
  SALE_RETURN: 'sale:return',
  SALE_VOID: 'sale:void',

  // Shifts and Reconciliation channels
  REPORT_OPEN_SHIFT: 'report:open-shift',
  REPORT_GET_OPEN_SHIFT: 'report:get-open-shift',
  REPORT_CLOSE_SHIFT: 'report:close-shift',
  REPORT_GET_SUMMARY: 'report:get-summary',
  REPORT_GET_TAX: 'report:get-tax',
  REPORT_GET_TOP_PRODUCTS: 'report:get-top-products',
  REPORT_GET_PROFIT: 'report:get-profit',

  // Backup and Restore Channels
  SYSTEM_BACKUP_TRIGGER: 'system:backup-trigger',
  SYSTEM_BACKUP_LIST: 'system:backup-list',
  SYSTEM_RESTORE: 'system:restore',

  // Auto-Updater Channels
  UPDATE_CHECK: 'update:check',            // renderer -> main, manual check
  UPDATE_GET_STATE: 'update:get-state',    // renderer -> main, current snapshot
  UPDATE_INSTALL_NOW: 'update:install-now',// renderer -> main, restart + apply
  UPDATE_EVENT: 'update:event'             // main -> renderer, state push
} as const;

export type IpcChannelName = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
