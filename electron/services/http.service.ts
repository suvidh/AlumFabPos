import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as http from 'http';
import path from 'path';
import { app } from 'electron';
import { DatabaseService } from './database.service';
import { LoggerService } from './logger.service';
import { SystemService } from './system.service';
import { CompanyService } from '../../src/services/companyService';
import { BranchService } from '../../src/services/branchService';
import { ProductService } from '../../src/services/productService';
import { InventoryService } from '../../src/services/inventoryService';
import { CustomerService } from '../../src/services/customerService';
import { CategoryService } from '../../src/services/categoryService';
import { SalesService } from '../../src/services/salesService';
import { SupplierService } from '../../src/services/supplierService';
import { PurchaseService } from '../../src/services/purchaseService';
import { ExpenseService } from '../../src/services/expenseService';
import { runImportDryRun, commitImport } from './productImportService';

export const HTTP_PORT = 3333;

// ---------------------------------------------------------------------------
// Helper: wrap async route handlers so errors propagate to Express error handler
// ---------------------------------------------------------------------------
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

let server: http.Server | null = null;

export class HttpService {
  /**
   * Start the Express REST API server on HTTP_PORT.
   * Safe to call multiple times — only starts once.
   */
  public static start(): void {
    if (server) return;

    const expressApp = express();

    // ── Middleware ──────────────────────────────────────────────────────────
    expressApp.use(cors({ origin: '*' }));
    expressApp.use(express.json());

    // Request logger
    expressApp.use((req: Request, _res: Response, next: NextFunction) => {
      LoggerService.info(`[HTTP] ${req.method} ${req.path}`);
      next();
    });

    // ── System Routes ───────────────────────────────────────────────────────
    expressApp.get('/api/ping', asyncHandler(async (_req, res) => {
      res.json(SystemService.ping());
    }));

    expressApp.get('/api/app-info', asyncHandler(async (_req, res) => {
      res.json(SystemService.getAppInfo());
    }));

    expressApp.get('/api/app-paths', asyncHandler(async (_req, res) => {
      res.json(SystemService.getAppPaths());
    }));

    expressApp.get('/api/db/health', asyncHandler(async (_req, res) => {
      res.json(await DatabaseService.checkHealth());
    }));

    // ── Company Routes ──────────────────────────────────────────────────────
    expressApp.get('/api/company', asyncHandler(async (_req, res) => {
      const client = DatabaseService.getClient();
      res.json(await CompanyService.getCompany(client));
    }));

    expressApp.patch('/api/company/:companyId', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.json(await CompanyService.updateCompany(client, req.params.companyId as string, req.body));
    }));

    // ── Branch Routes ───────────────────────────────────────────────────────
    expressApp.get('/api/branches', asyncHandler(async (_req, res) => {
      const client = DatabaseService.getClient();
      res.json(await BranchService.getAllBranches(client));
    }));

    expressApp.get('/api/branches/:branchId', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.json(await BranchService.getBranchById(client, req.params.branchId as string));
    }));

    expressApp.post('/api/branches', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.status(201).json(await BranchService.createBranch(client, req.body));
    }));

    expressApp.patch('/api/branches/:branchId', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.json(await BranchService.updateBranch(client, req.params.branchId as string, req.body));
    }));

    expressApp.delete('/api/branches/:branchId', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.json(await BranchService.deleteBranch(client, req.params.branchId as string));
    }));

    // ── Product Routes ──────────────────────────────────────────────────────
    expressApp.get('/api/products', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      const includeInactive = req.query.includeInactive === 'true';
      res.json(await ProductService.getAllProducts(client, includeInactive));
    }));

    expressApp.post('/api/products', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.status(201).json(await ProductService.createProduct(client, req.body));
    }));

    expressApp.patch('/api/products/:productId', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.json(await ProductService.updateProduct(client, req.params.productId as string, req.body));
    }));

    // ── Inventory Routes ────────────────────────────────────────────────────
    expressApp.get('/api/inventory/:branchId', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.json(await InventoryService.getBranchInventory(client, req.params.branchId as string));
    }));

    expressApp.post('/api/inventory/adjust', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      const { branchId, productId, deltaQuantityDecimal, type, reason } = req.body;
      res.json(await InventoryService.adjustStock(client, branchId, productId, deltaQuantityDecimal, type, reason));
    }));

    // ── Customer Routes ─────────────────────────────────────────────────────
    expressApp.get('/api/customers', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      const includeInactive = req.query.includeInactive === 'true';
      res.json(await CustomerService.getAllCustomers(client, includeInactive));
    }));

    expressApp.post('/api/customers', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.status(201).json(await CustomerService.createCustomer(client, req.body));
    }));

    expressApp.patch('/api/customers/:customerId', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.json(await CustomerService.updateCustomer(client, req.params.customerId as string, req.body));
    }));

    // ── Sales Routes ────────────────────────────────────────────────────────
    expressApp.get('/api/sales', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      const branchId = req.query.branchId as string | undefined;
      res.json(await SalesService.getAllSales(client, branchId));
    }));

    expressApp.post('/api/sales', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.status(201).json(await SalesService.createSale(client, req.body));
    }));

    // ── Category Routes ──────────────────────────────────────────────────────
    expressApp.get('/api/categories', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      const includeInactive = req.query.includeInactive === 'true';
      res.json(await CategoryService.getAllCategories(client, includeInactive));
    }));

    expressApp.post('/api/categories', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      const { name } = req.body;
      res.status(201).json(await CategoryService.createCategory(client, name));
    }));

    expressApp.patch('/api/categories/:categoryId', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.json(await CategoryService.updateCategory(client, req.params.categoryId as string, req.body));
    }));

    // ── Supplier Routes ──────────────────────────────────────────────────────
    expressApp.get('/api/suppliers', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      const includeInactive = req.query.includeInactive === 'true';
      res.json(await SupplierService.getAllSuppliers(client, includeInactive));
    }));

    expressApp.post('/api/suppliers', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.status(201).json(await SupplierService.createSupplier(client, req.body));
    }));

    expressApp.patch('/api/suppliers/:supplierId', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.json(await SupplierService.updateSupplier(client, req.params.supplierId as string, req.body));
    }));

    // ── Purchase Routes ──────────────────────────────────────────────────────
    expressApp.get('/api/purchases', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      const branchId = req.query.branchId as string | undefined;
      res.json(await PurchaseService.getAllPurchases(client, branchId));
    }));

    expressApp.post('/api/purchases', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.status(201).json(await PurchaseService.createPurchase(client, req.body));
    }));

    // ── Expense Routes ───────────────────────────────────────────────────────
    expressApp.get('/api/expenses', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      const branchId = req.query.branchId as string | undefined;
      res.json(await ExpenseService.getAllExpenses(client, branchId));
    }));

    expressApp.post('/api/expenses', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      res.status(201).json(await ExpenseService.createExpense(client, req.body));
    }));

    // ── Payment Gateway Routes ───────────────────────────────────────────────
    expressApp.post('/api/payments/create-qr', asyncHandler(async (req, res) => {
      const { amount, orderId } = req.body;
      const amountInPaise = Math.round(amount * 100);

      const keyId = process.env.RAZORPAY_KEY_ID || '';
      const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

      if (!keyId || !keySecret) {
        // Fallback to simulated offline QR Code if API credentials are not set
        const mockQrId = 'mock_qr_' + Date.now().toString().slice(-6);
        
        // Return a mock payload with local scan URI
        const upiId = 'alumfab@okaxis';
        const merchName = 'AlumFab Hardware';
        const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(merchName)}&am=${amount.toFixed(2)}&tr=${mockQrId}&tn=Order%20${orderId}&cu=INR`;
        
        res.json({
          id: mockQrId,
          upiUri,
          isMock: true,
          closeBy: Math.floor(Date.now() / 1000) + 300
        });
        return;
      }

      try {
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const expireTimestamp = Math.floor(Date.now() / 1000) + 300; // 5 mins

        const response = await fetch('https://api.razorpay.com/v1/payments/qr_codes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${auth}`
          },
          body: JSON.stringify({
            type: 'upi_qr',
            name: 'AlumFab POS Store',
            usage: 'single_use',
            fixed_amount: true,
            amount: amountInPaise,
            description: `Payment for Order ${orderId}`,
            close_by: expireTimestamp
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Razorpay API Error: ${errText}`);
        }

        const data: any = await response.json();
        res.json({
          id: data.id,
          upiUri: data.short_url || data.image_url,
          imageUrl: data.image_url,
          isMock: false,
          closeBy: expireTimestamp
        });
      } catch (err: any) {
        LoggerService.error('[HTTP] Payment gateway error:', err);
        res.status(500).json({ error: err.message || 'Failed to create Razorpay QR Code' });
      }
    }));

    expressApp.get('/api/payments/status/:qrId', asyncHandler(async (req, res) => {
      const qrId = req.params.qrId as string;

      if (qrId.startsWith('mock_qr_')) {
        // Simulation mode check: auto capture after 7s
        const timestampPart = qrId.replace('mock_qr_', '');
        const age = Date.now() - (parseInt(timestampPart, 10) || Date.now());
        if (age > 7000) {
          res.json({ status: 'SUCCESS', isMock: true });
        } else {
          res.json({ status: 'PENDING', isMock: true });
        }
        return;
      }

      const keyId = process.env.RAZORPAY_KEY_ID || '';
      const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

      if (!keyId || !keySecret) {
        res.status(400).json({ error: 'Razorpay keys not configured' });
        return;
      }

      try {
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const response = await fetch(`https://api.razorpay.com/v1/payments?qr_code_id=${qrId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${auth}`
          }
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Razorpay Status API Error: ${errText}`);
        }

        const data: any = await response.json();
        const payments = data.items || [];
        const capturedPayment = payments.find((p: any) => p.status === 'captured');

        if (capturedPayment) {
          res.json({ status: 'SUCCESS', transactionId: capturedPayment.id });
        } else {
          res.json({ status: 'PENDING' });
        }
      } catch (err: any) {
        LoggerService.error('[HTTP] Payment status fetch error:', err);
        res.status(500).json({ error: err.message || 'Failed to check payment status' });
      }
    }));

    // ── Product Import Routes ───────────────────────────────────────────────
    expressApp.get('/api/import/default-path', asyncHandler(async (_req, res) => {
      const defaultPath = path.join(app.getAppPath(), 'hardware.ods');
      res.json({ path: defaultPath });
    }));

    expressApp.post('/api/import/dry-run', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      const { filePath } = req.body as { filePath: string };
      res.json(await runImportDryRun(client, filePath));
    }));

    expressApp.post('/api/import/commit', asyncHandler(async (req, res) => {
      const client = DatabaseService.getClient();
      const { dryRunResult, conflictStrategy } = req.body;
      res.json(await commitImport(client, dryRunResult, conflictStrategy));
    }));

    // ── Global Error Handler ────────────────────────────────────────────────
    expressApp.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      LoggerService.error('[HTTP] Unhandled route error:', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    });

    // ── Start Listening ─────────────────────────────────────────────────────
    server = expressApp.listen(HTTP_PORT, '0.0.0.0', () => {
      LoggerService.info(`[HTTP] REST API listening on http://0.0.0.0:${HTTP_PORT}`);
    });

    server.on('error', (err) => {
      LoggerService.error('[HTTP] Server error:', err);
    });
  }

  /**
   * Gracefully close the HTTP server. Called on app quit.
   */
  public static async stop(): Promise<void> {
    if (!server) return;
    return new Promise((resolve) => {
      server!.close(() => {
        LoggerService.info('[HTTP] REST API server stopped.');
        server = null;
        resolve();
      });
    });
  }
}
