import { ipcMain, app, BrowserWindow, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
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
import { SupplierService } from '../../src/services/supplierService';
import { PurchaseService } from '../../src/services/purchaseService';
import { ExpenseService } from '../../src/services/expenseService';
import { runImportDryRun, commitImport } from '../services/productImportService';
import { ReportService } from '../../src/services/reportService';
import { BackupService } from '../../src/services/backupService';
import { UpdaterService } from '../services/updater.service';

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

  ipcMain.handle(IPC_CHANNELS.BRANCH_DELETE, async (_, { branchId }) => {
    const client = DatabaseService.getClient();
    return BranchService.deleteBranch(client, branchId);
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
    if (!data.sku || !data.name || data.sellingPrice === undefined) {
      throw new Error('Missing required product fields: sku, name, or sellingPrice.');
    }
    return ProductService.createProduct(client, data);
  });

  ipcMain.handle(IPC_CHANNELS.PRODUCT_UPDATE, async (_, { productId, data }) => {
    const client = DatabaseService.getClient();
    if (!productId) {
      throw new Error('Product ID is required for updates.');
    }
    return ProductService.updateProduct(client, productId, data);
  });

  ipcMain.handle(IPC_CHANNELS.PRODUCT_DELETE, async (_, { productId }) => {
    const client = DatabaseService.getClient();
    if (!productId) {
      throw new Error('Product ID is required for deletion.');
    }
    return ProductService.deleteProduct(client, productId);
  });

  // Inventory Domain Handlers
  //
  // NOTE: these handlers used to return { success, data } / { success, error }
  // envelopes while every other handler in this file — and the AlumfabAPI
  // contract, and every renderer page — returns/expects the raw value with
  // errors surfaced as a rejected promise (ipcMain.handle does this for free
  // when a handler throws). The mismatch broke InventoryPage: `getInventory`
  // resolved to `{ success: true, data: [...] }` instead of an array, so
  // `inventory.map()` threw "inventory.map is not a function". It also meant
  // failures here were silently swallowed instead of hitting the renderer's
  // try/catch. Kept consistent with the rest of the file now.
  ipcMain.handle(IPC_CHANNELS.INVENTORY_GET_BRANCH, async (_, { branchId }) => {
    const client = DatabaseService.getClient();
    if (!branchId) {
      throw new Error('Branch ID is required.');
    }
    return InventoryService.getBranchInventory(client, branchId);
  });

  ipcMain.handle(IPC_CHANNELS.INVENTORY_ADJUST, async (_, { branchId, productId, deltaQuantityDecimal, type, reason }) => {
    const client = DatabaseService.getClient();
    if (!branchId || !productId || deltaQuantityDecimal === undefined || !type) {
      throw new Error('Missing required adjustment parameters.');
    }
    // If a specific audit reason is provided or if type indicates a manual count, route to manual absolute adjust
    if (reason && ['Damaged', 'Audit Variance', 'Initial Stock'].includes(reason)) {
      return InventoryService.manualStockAdjustment(client, branchId, productId, deltaQuantityDecimal, reason);
    }
    return InventoryService.adjustStock(client, branchId, productId, deltaQuantityDecimal, type, undefined, reason);
  });

  ipcMain.handle(IPC_CHANNELS.INVENTORY_CHECK_AVAILABILITY, async (_, { branchId, productId }) => {
    const client = DatabaseService.getClient();
    if (!branchId || !productId) {
      throw new Error('Branch ID and Product ID are required.');
    }
    return InventoryService.checkStockAvailability(client, branchId, productId);
  });

  ipcMain.handle(IPC_CHANNELS.INVENTORY_TRANSFER, async (_, { fromBranchId, toBranchId, productId, quantityDecimal, notes }) => {
    const client = DatabaseService.getClient();
    if (!fromBranchId || !toBranchId || !productId || quantityDecimal === undefined) {
      throw new Error('Missing required transfer parameters: fromBranchId, toBranchId, productId, or quantityDecimal.');
    }
    return InventoryService.transferStock(client, fromBranchId, toBranchId, productId, quantityDecimal, notes);
  });

  ipcMain.handle(IPC_CHANNELS.INVENTORY_LOW_STOCK_REPORT, async (_, { branchId }) => {
    const client = DatabaseService.getClient();
    if (!branchId) {
      throw new Error('Branch ID is required.');
    }
    return InventoryService.getLowStockAlerts(client, branchId);
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

  // Silent Printing Handler
  ipcMain.handle(
    IPC_CHANNELS.PRINT_SILENT,
    async (_, { htmlContent, options }: { htmlContent: string; options?: { silent?: boolean; deviceName?: string } }) => {
      LoggerService.info('Silent print request received');
      try {
        const printWindow = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        });

        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

        return new Promise<boolean>((resolve) => {
          printWindow.webContents.print(
            {
              silent: options?.silent !== false,
              printBackground: true,
              deviceName: options?.deviceName || ''
            },
            (success, errorType) => {
              printWindow.close();
              if (!success) {
                LoggerService.error(`Silent print execution failed: ${errorType}`);
                resolve(false);
              } else {
                LoggerService.info('Silent print completed successfully.');
                resolve(true);
              }
            }
          );
        });
      } catch (err: any) {
        LoggerService.error(`Silent print exception encountered: ${err.message}`);
        return false;
      }
    }
  );

  // Invoice PDF Export — renders the same HTML used for the A4 print layout
  // to a real PDF via Chromium's print pipeline (no external PDF library
  // needed) and lets the operator choose where to save it.
  ipcMain.handle(
    IPC_CHANNELS.PRINT_SAVE_INVOICE_PDF,
    async (event, { htmlContent, suggestedFileName }: { htmlContent: string; suggestedFileName: string }) => {
      const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;

      const safeName = (suggestedFileName || 'invoice').replace(/[/\\?%*:|"<>]/g, '-');
      const defaultPath = path.join(app.getPath('downloads'), safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`);

      const { canceled, filePath } = await dialog.showSaveDialog(parentWindow as any, {
        title: 'Save Invoice as PDF',
        defaultPath,
        filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      let pdfWindow: BrowserWindow | null = null;
      try {
        pdfWindow = new BrowserWindow({
          show: false,
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        });

        await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

        // marginType: 'none' — the invoice HTML already declares its own
        // @page margin inside @media print (see printService.ts); adding PDF
        // margins on top of that would double the whitespace.
        //
        // landscape: true — the invoice renders two copies (Customer / Office)
        // side by side and only fits in landscape. The HTML's own `@page` rule
        // also declares `size: A4 landscape`, but Electron's printToPDF option
        // is the one Chromium's print pipeline actually honors reliably, so
        // both are set to the same orientation rather than relying on the CSS
        // alone.
        const pdfBuffer = await pdfWindow.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          landscape: true,
          margins: { marginType: 'none' }
        });

        fs.writeFileSync(filePath, pdfBuffer);
        LoggerService.info(`Invoice PDF saved to ${filePath}`);
        return { success: true, filePath };
      } catch (err: any) {
        LoggerService.error(`Invoice PDF export failed: ${err.message}`);
        return { success: false, error: err.message || 'Failed to export invoice PDF.' };
      } finally {
        pdfWindow?.close();
      }
    }
  );

  // Sales History Query
  ipcMain.handle(IPC_CHANNELS.SALE_GET_HISTORY, async (_, { filters }) => {
    const client = DatabaseService.getClient();
    return SalesService.getSalesHistory(client, filters);
  });

  // Sales Returns
  ipcMain.handle(IPC_CHANNELS.SALE_RETURN, async (_, { data }) => {
    const client = DatabaseService.getClient();
    return SalesService.processReturn(client, data);
  });

  // Sales Void
  ipcMain.handle(IPC_CHANNELS.SALE_VOID, async (_, { data }) => {
    const client = DatabaseService.getClient();
    return SalesService.voidSale(client, data);
  });

  // Shifts and Reconciliation
  ipcMain.handle(IPC_CHANNELS.REPORT_OPEN_SHIFT, async (_, { branchId, cashierId, startingFloatRupees }) => {
    const client = DatabaseService.getClient();
    return ReportService.openShift(client, branchId, cashierId, startingFloatRupees);
  });

  ipcMain.handle(IPC_CHANNELS.REPORT_GET_OPEN_SHIFT, async (_, { branchId, cashierId }) => {
    const client = DatabaseService.getClient();
    return ReportService.getOpenShift(client, branchId, cashierId);
  });

  ipcMain.handle(IPC_CHANNELS.REPORT_CLOSE_SHIFT, async (_, { data }) => {
    const client = DatabaseService.getClient();
    return ReportService.closeShift(client, data);
  });

  // Analytics Reports
  ipcMain.handle(IPC_CHANNELS.REPORT_GET_SUMMARY, async (_, { branchId, filters }) => {
    const client = DatabaseService.getClient();
    return ReportService.getSalesSummary(client, branchId, filters);
  });

  ipcMain.handle(IPC_CHANNELS.REPORT_GET_TAX, async (_, { branchId, filters }) => {
    const client = DatabaseService.getClient();
    return ReportService.getTaxLiabilityReport(client, branchId, filters);
  });

  ipcMain.handle(IPC_CHANNELS.REPORT_GET_TOP_PRODUCTS, async (_, { branchId, limit }) => {
    const client = DatabaseService.getClient();
    return ReportService.getTopSellingProducts(client, branchId, limit);
  });

  ipcMain.handle(IPC_CHANNELS.REPORT_GET_PROFIT, async (_, { branchId, filters }) => {
    const client = DatabaseService.getClient();
    return ReportService.getProfitMarginAnalysis(client, branchId, filters);
  });

  // Backups and Restore Handlers
  ipcMain.handle(IPC_CHANNELS.SYSTEM_BACKUP_TRIGGER, async (_, { backupType }) => {
    const client = DatabaseService.getClient();
    return BackupService.triggerBackup(client, backupType);
  });

  ipcMain.handle(IPC_CHANNELS.SYSTEM_BACKUP_LIST, async () => {
    const client = DatabaseService.getClient();
    return BackupService.listBackups(client);
  });

  ipcMain.handle(IPC_CHANNELS.SYSTEM_RESTORE, async (_, { backupId }) => {
    const client = DatabaseService.getClient();
    return BackupService.restoreBackup(client, backupId);
  });

  // Auto-Updater Handlers
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => UpdaterService.checkNow());
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_STATE, async () => UpdaterService.getState());

  // Applying an update tears the app down and relaunches it. The renderer is
  // responsible for gating this on "no open cart, no open cash shift" — the
  // main process cannot know whether a customer is standing at the counter.
  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL_NOW, async () => {
    LoggerService.info('[IPC] Operator requested immediate update install.');
    return UpdaterService.installNow();
  });
}
