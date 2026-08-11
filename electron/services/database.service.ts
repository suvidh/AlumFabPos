import { PrismaClient } from '@prisma/client';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { AppPathsService } from '../main/app-paths';
import { LoggerService } from './logger.service';
import { DatabaseHealthResult } from '../ipc/contracts';
import { CompanyService } from '../../src/services/companyService';
import { ProductService } from '../../src/services/productService';
import { InventoryService } from '../../src/services/inventoryService';
import { CustomerService } from '../../src/services/customerService';
import { SupplierService } from '../../src/services/supplierService';

export class DatabaseService {
  private static instance: PrismaClient | null = null;
  private static isInitialized = false;

  /**
   * Get singleton PrismaClient connected to %APPDATA%\ALUMFAB-POS\database\pos.db
   */
  public static getClient(): PrismaClient {
    if (!this.instance) {
      const paths = AppPathsService.getPaths();
      const dbPath = paths.databaseFile;

      // Set process.env.DATABASE_URL dynamically to AppData database path
      process.env.DATABASE_URL = `file:${dbPath}`;

      // Pass SQLite file path directly to PrismaClient
      this.instance = new PrismaClient({
        datasources: {
          db: {
            url: `file:${dbPath}`
          }
        }
      });
    }
    return this.instance;
  }

  /**
   * Bootstrap SQLite Database on app startup
   */
  public static async bootstrap(): Promise<boolean> {
    try {
      const paths = AppPathsService.getPaths();
      LoggerService.info(`Bootstrapping SQLite Database at: ${paths.databaseFile}`);

      // Automatic AppData DB Bootstrap: Ensure directory exists and copy template pos.db if missing/empty
      if (!fs.existsSync(paths.databaseDir)) {
        fs.mkdirSync(paths.databaseDir, { recursive: true });
      }

      const dbMissingOrEmpty = !fs.existsSync(paths.databaseFile) || fs.statSync(paths.databaseFile).size === 0;

      if (dbMissingOrEmpty) {
        const resourceDb = path.join(process.resourcesPath, 'pos.db');
        const devDb = path.join(app.getAppPath(), 'prisma/pos.db');
        const devDb2 = path.join(__dirname, '../../prisma/pos.db');

        if (fs.existsSync(resourceDb)) {
          fs.copyFileSync(resourceDb, paths.databaseFile);
          LoggerService.info(`Auto-bootstrapped AppData database from app resources: ${resourceDb}`);
        } else if (fs.existsSync(devDb)) {
          fs.copyFileSync(devDb, paths.databaseFile);
          LoggerService.info(`Auto-bootstrapped AppData database from dev path: ${devDb}`);
        } else if (fs.existsSync(devDb2)) {
          fs.copyFileSync(devDb2, paths.databaseFile);
          LoggerService.info(`Auto-bootstrapped AppData database from dev path: ${devDb2}`);
        } else {
          fs.writeFileSync(paths.databaseFile, '');
          LoggerService.info(`Created empty database file at ${paths.databaseFile}`);
        }
      }

      const client = this.getClient();
      await client.$connect();

      // Ensure AppMeta row exists
      let meta = await client.appMeta.findUnique({ where: { id: 1 } });
      if (!meta) {
        meta = await client.appMeta.create({
          data: {
            id: 1,
            schemaVersion: 2,
            appVersion: '1.0.0'
          }
        });
        LoggerService.info('Initialized new AppMeta database record', meta);
      } else {
        LoggerService.info('Connected to existing AppMeta database record', meta);
      }

      // Seed Phase 2 Core Business Entities
      try {
        const { company, defaultBranch } = await CompanyService.getCompany(client);
        LoggerService.info(`Phase 2 Company Profile Verified: ${company.name}`);

        const productCount = await ProductService.seedDefaultProducts(client);
        LoggerService.info(`Phase 2 Product Catalog Ready: ${productCount} products`);

        if (defaultBranch) {
          const invCount = await InventoryService.seedDefaultBranchInventory(client, defaultBranch.id);
          LoggerService.info(`Phase 2 Stock Balances Initialized for Branch ${defaultBranch.code}: ${invCount} items`);
        }

        const customer = await CustomerService.seedDefaultCustomer(client);
        LoggerService.info(`Phase 2 Default Customer Verified: ${customer.name}`);

        const supplier = await SupplierService.seedDefaultSupplier(client);
        LoggerService.info(`Phase 2 Default Supplier Verified: ${supplier.name}`);
      } catch (seedErr) {
        LoggerService.warn('Phase 2 Domain Seeding Notice:', seedErr);
      }

      this.isInitialized = true;
      return true;
    } catch (error) {
      LoggerService.error('Database bootstrap failed:', error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Run Database Health Check
   */
  public static async checkHealth(): Promise<DatabaseHealthResult> {
    const timestamp = new Date().toISOString();
    try {
      const client = this.getClient();
      const meta = await client.appMeta.findUnique({ where: { id: 1 } });

      if (meta) {
        return {
          ok: true,
          message: 'SQLite database connection healthy',
          timestamp,
          details: {
            schemaVersion: meta.schemaVersion,
            appVersion: meta.appVersion || '1.0.0',
            path: AppPathsService.getPaths().databaseFile
          }
        };
      } else {
        return {
          ok: false,
          message: 'AppMeta record missing in SQLite database',
          timestamp
        };
      }
    } catch (error: any) {
      LoggerService.error('Database health check failed:', error);
      return {
        ok: false,
        message: `Database health check error: ${error.message || String(error)}`,
        timestamp
      };
    }
  }

  /**
   * Safely disconnect Prisma client on app exit
   */
  public static async shutdown(): Promise<void> {
    if (this.instance) {
      try {
        await this.instance.$disconnect();
        LoggerService.info('Prisma client disconnected cleanly.');
      } catch (e) {
        LoggerService.error('Error disconnecting Prisma client:', e);
      }
      this.instance = null;
    }
  }
}
