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

  PRODUCT_GET_ALL: 'product:get-all',
  PRODUCT_CREATE: 'product:create',
  PRODUCT_UPDATE: 'product:update',

  // Category Channels
  CATEGORY_GET_ALL: 'category:get-all',
  CATEGORY_CREATE: 'category:create',
  CATEGORY_UPDATE: 'category:update',

  INVENTORY_GET_BRANCH: 'inventory:get-branch',
  INVENTORY_ADJUST: 'inventory:adjust',

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
  PRODUCT_IMPORT_GET_DEFAULT_PATH: 'product:import-get-default-path'
} as const;

export type IpcChannelName = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
