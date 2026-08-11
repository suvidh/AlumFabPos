import { ipcMain, app } from 'electron';
import * as path from 'path';
import { IPC_CHANNELS } from './channels';
import { SystemService } from '../services/system.service';
import { DatabaseService } from '../services/database.service';
import { LoggerService } from '../services/logger.service';
import { CompanyService } from '../../src/services/companyService';
import { BranchService } from '../../src/services/branchService';
import { ProductService } from '../../src/services/productService';
import { CategoryService } from '../../src/services/categoryService';
import { InventoryService } from '../../src/services/inventoryService';
import { CustomerService } from '../../src/services/customerService';
import { SalesService } from '../../src/services/salesService';
import { AuthService } from '../../src/services/authService';
import { SupplierService } from '../../src/services/supplierService';
import { PurchaseService } from '../../src/services/purchaseService';
import { ExpenseService } from '../../src/services/expenseService';
import { runImportDryRun, commitImport } from '../services/productImportService';

export function registerIpcHandlers(): void {
  LoggerService.info('Registering production Phase 2 IPC domain handlers...');

  // System Channels
  ipcMain.handle(IPC_CHANNELS.APP_GET_INFO, async () => SystemService.getAppInfo());
  ipcMain.handle(IPC_CHANNELS.APP_GET_PATHS, async () => SystemService.getAppPaths());
  ipcMain.handle(IPC_CHANNELS.APP_PING, async () => SystemService.ping());
  ipcMain.handle(IPC_CHANNELS.DB_HEALTH_CHECK, async () => DatabaseService.checkHealth());

  // Company Domain Handlers
  ipcMain.handle(IPC_CHANNELS.COMPANY_GET, async () => {
    const client = DatabaseService.getClient();
    return CompanyService.getCompany(client);
  });

  ipcMain.handle(IPC_CHANNELS.COMPANY_UPDATE, async (_, { companyId, data }) => {
    const client = DatabaseService.getClient();
    return CompanyService.updateCompany(client, companyId, data);
  });

  // Branch Domain Handlers
  ipcMain.handle(IPC_CHANNELS.BRANCH_GET_ALL, async () => {
    const client = DatabaseService.getClient();
    return BranchService.getAllBranches(client);
  });

  ipcMain.handle(IPC_CHANNELS.BRANCH_GET_BY_ID, async (_, { branchId }) => {
    const client = DatabaseService.getClient();
    return BranchService.getBranchById(client, branchId);
  });

  ipcMain.handle(IPC_CHANNELS.BRANCH_CREATE, async (_, data) => {
    const client = DatabaseService.getClient();
    return BranchService.createBranch(client, data);
  });

  ipcMain.handle(IPC_CHANNELS.BRANCH_UPDATE, async (_, { branchId, data }) => {
    const client = DatabaseService.getClient();
    return BranchService.updateBranch(client, branchId, data);
  });

  // Product Domain Handlers
  ipcMain.handle(IPC_CHANNELS.PRODUCT_GET_ALL, async (_, { includeInactive }) => {
    const client = DatabaseService.getClient();
    return ProductService.getAllProducts(client, includeInactive);
  });

  // Category Domain Handlers
  ipcMain.handle(IPC_CHANNELS.CATEGORY_GET_ALL, async (_, { includeInactive }) => {
    const client = DatabaseService.getClient();
    return CategoryService.getAllCategories(client, includeInactive);
  });

  ipcMain.handle(IPC_CHANNELS.CATEGORY_CREATE, async (_, { name }) => {
    const client = DatabaseService.getClient();
    return CategoryService.createCategory(client, name);
  });

  ipcMain.handle(IPC_CHANNELS.CATEGORY_UPDATE, async (_, { categoryId, data }) => {
    const client = DatabaseService.getClient();
    return CategoryService.updateCategory(client, categoryId, data);
  });

  ipcMain.handle(IPC_CHANNELS.PRODUCT_CREATE, async (_, data) => {
    const client = DatabaseService.getClient();
    return ProductService.createProduct(client, data);
  });

  ipcMain.handle(IPC_CHANNELS.PRODUCT_UPDATE, async (_, { productId, data }) => {
    const client = DatabaseService.getClient();
    return ProductService.updateProduct(client, productId, data);
  });

  // Inventory Domain Handlers
  ipcMain.handle(IPC_CHANNELS.INVENTORY_GET_BRANCH, async (_, { branchId }) => {
    const client = DatabaseService.getClient();
    return InventoryService.getBranchInventory(client, branchId);
  });

  ipcMain.handle(IPC_CHANNELS.INVENTORY_ADJUST, async (_, { branchId, productId, deltaQuantityDecimal, type, reason }) => {
    const client = DatabaseService.getClient();
    return InventoryService.adjustStock(client, branchId, productId, deltaQuantityDecimal, type, reason);
  });

  // Customer Domain Handlers
  ipcMain.handle(IPC_CHANNELS.CUSTOMER_GET_ALL, async (_, { includeInactive }) => {
    const client = DatabaseService.getClient();
    return CustomerService.getAllCustomers(client, includeInactive);
  });

  ipcMain.handle(IPC_CHANNELS.CUSTOMER_CREATE, async (_, data) => {
    const client = DatabaseService.getClient();
    return CustomerService.createCustomer(client, data);
  });

  ipcMain.handle(IPC_CHANNELS.CUSTOMER_UPDATE, async (_, { customerId, data }) => {
    const client = DatabaseService.getClient();
    return CustomerService.updateCustomer(client, customerId, data);
  });

  // Sales Domain Handlers
  ipcMain.handle(IPC_CHANNELS.SALE_CREATE, async (_, data) => {
    const client = DatabaseService.getClient();
    return SalesService.createSale(client, data);
  });

  ipcMain.handle(IPC_CHANNELS.SALE_GET_ALL, async (_, { branchId }) => {
    const client = DatabaseService.getClient();
    return SalesService.getAllSales(client, branchId);
  });

  // Auth Handlers
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_, { username, password }) => {
    const client = DatabaseService.getClient();
    return AuthService.login(client, username, password);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_UPDATE_PASSWORD, async (_, { userId, oldPassword, newPassword }) => {
    const client = DatabaseService.getClient();
    return AuthService.updatePassword(client, userId, oldPassword, newPassword);
  });

  // Supplier Domain Handlers
  ipcMain.handle(IPC_CHANNELS.SUPPLIER_GET_ALL, async (_, { includeInactive }) => {
    const client = DatabaseService.getClient();
    return SupplierService.getAllSuppliers(client, includeInactive);
  });

  ipcMain.handle(IPC_CHANNELS.SUPPLIER_CREATE, async (_, data) => {
    const client = DatabaseService.getClient();
    return SupplierService.createSupplier(client, data);
  });

  ipcMain.handle(IPC_CHANNELS.SUPPLIER_UPDATE, async (_, { supplierId, data }) => {
    const client = DatabaseService.getClient();
    return SupplierService.updateSupplier(client, supplierId, data);
  });

  // Purchase Domain Handlers
  ipcMain.handle(IPC_CHANNELS.PURCHASE_CREATE, async (_, data) => {
    const client = DatabaseService.getClient();
    return PurchaseService.createPurchase(client, data);
  });

  ipcMain.handle(IPC_CHANNELS.PURCHASE_GET_ALL, async (_, { branchId }) => {
    const client = DatabaseService.getClient();
    return PurchaseService.getAllPurchases(client, branchId);
  });

  // Expense Domain Handlers
  ipcMain.handle(IPC_CHANNELS.EXPENSE_CREATE, async (_, data) => {
    const client = DatabaseService.getClient();
    return ExpenseService.createExpense(client, data);
  });

  ipcMain.handle(IPC_CHANNELS.EXPENSE_GET_ALL, async (_, { branchId }) => {
    const client = DatabaseService.getClient();
    return ExpenseService.getAllExpenses(client, branchId);
  });

  // ─────────────────────────────────────────────────────────
  // Product Import Pipeline Handlers
  // ─────────────────────────────────────────────────────────

  /**
   * Returns the default ODS file path (read-only source file location).
   * Renderer uses this to pre-fill the file picker or display the path.
   */
  ipcMain.handle(IPC_CHANNELS.PRODUCT_IMPORT_GET_DEFAULT_PATH, async () => {
    // The canonical source file ships alongside the app in the project root
    // In production it could be in app.getPath('userData') or a user-selected location
    const defaultPath = path.join(app.getAppPath(), 'hardware.ods');
    return defaultPath;
  });

  /**
   * Dry-run: parse ODS + validate + DB conflict check.
   * NO database writes. Returns ImportDryRunResult for preview UI.
   */
  ipcMain.handle(IPC_CHANNELS.PRODUCT_IMPORT_DRY_RUN, async (_, { filePath }: { filePath: string }) => {
    const client = DatabaseService.getClient();
    LoggerService.info(`Product import dry-run requested for: ${filePath}`);
    try {
      const result = await runImportDryRun(client, filePath);
      LoggerService.info(
        `Dry-run complete — total:${result.totalRows} new:${result.newProducts} ` +
        `warn:${result.warningRows} err:${result.errorRows}`
      );
      return result;
    } catch (err: any) {
      LoggerService.error(`Product import dry-run failed: ${err.message}`);
      throw err;
    }
  });

  /**
   * Commit: write import to DB in a single Prisma transaction.
   * Rolls back entirely on any failure — no partial import.
   * Conflict strategy must be chosen explicitly by Admin:
   *   SKIP | UPDATE_EXISTING | CANCEL_IMPORT
   */
  ipcMain.handle(
    IPC_CHANNELS.PRODUCT_IMPORT_COMMIT,
    async (_, { dryRunResult, conflictStrategy }: { dryRunResult: any; conflictStrategy: any }) => {
      const client = DatabaseService.getClient();
      LoggerService.info(`Product import commit requested — strategy: ${conflictStrategy}`);
      try {
        const result = await commitImport(client, dryRunResult, conflictStrategy);
        if (result.success) {
          LoggerService.info(
            `Import committed — imported:${result.importedCount} ` +
            `updated:${result.updatedCount} skipped:${result.skippedCount}`
          );
        } else {
          LoggerService.error(`Import commit failed: ${result.errors.join('; ')}`);
        }
        return result;
      } catch (err: any) {
        LoggerService.error(`Product import commit exception: ${err.message}`);
        throw err;
      }
    }
  );
}
