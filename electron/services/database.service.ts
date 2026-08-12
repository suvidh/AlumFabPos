import { PrismaClient } from '@prisma/client';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { AppPathsService } from '../main/app-paths';
import { LoggerService } from './logger.service';
import { SchemaGuard } from './schema-guard.service';
import { DatabaseHealthResult } from '../ipc/contracts';
import { CompanyService } from '../../src/services/companyService';
import { ProductService } from '../../src/services/productService';
import { InventoryService } from '../../src/services/inventoryService';
import { CustomerService } from '../../src/services/customerService';
import { SupplierService } from '../../src/services/supplierService';

export class DatabaseService {
  private static instance: PrismaClient | null = null;
  private static isInitialized = false;
  private static engineResolved = false;

  /**
   * Set when the schema guard refuses to start. Surfaced verbatim to the
   * operator so a technician gets the diagnosis instead of "something failed".
   */
  private static fatalSchemaMessage: string | null = null;

  /** Non-null when bootstrap was aborted by incompatible schema drift. */
  public static getFatalSchemaMessage(): string | null {
    return this.fatalSchemaMessage;
  }

  /**
   * Point Prisma at the query engine inside app.asar.unpacked.
   *
   * PACKAGING NOTE — this is the single most common way an Electron + Prisma
   * build dies in production. `query_engine-windows.dll.node` is a native
   * addon: it must be dlopen()'d from a real path on disk, and nothing can be
   * loaded from inside an asar archive. electron-builder.yml lists
   * `node_modules/.prisma/**` under `asarUnpack`, which mirrors the engine to
   *
   *   resources\app.asar.unpacked\node_modules\.prisma\client\
   *
   * Prisma's own resolver still looks next to the asar-packed client and
   * fails, so we set PRISMA_QUERY_ENGINE_LIBRARY explicitly. In dev this is a
   * no-op and the normal node_modules resolution applies.
   */
  private static resolveQueryEngine(): void {
    if (this.engineResolved) return;
    this.engineResolved = true;

    if (!app.isPackaged) return;

    const engineName = 'query_engine-windows.dll.node';
    const unpacked = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '.prisma',
      'client',
      engineName
    );

    if (fs.existsSync(unpacked)) {
      process.env.PRISMA_QUERY_ENGINE_LIBRARY = unpacked;
      // Schema copy sits beside the engine; some Prisma code paths look for it.
      process.env.PRISMA_SCHEMA_PATH = path.join(path.dirname(unpacked), 'schema.prisma');
      LoggerService.info(`Prisma query engine resolved: ${unpacked}`);
    } else {
      LoggerService.error(
        `Prisma query engine NOT FOUND at ${unpacked}. ` +
        'Check the asarUnpack globs in electron-builder.yml — the app will fail to reach the database.'
      );
    }
  }

  /**
   * Get singleton PrismaClient connected to %APPDATA%\ALUMFAB-POS\database\pos.db
   */
  public static getClient(): PrismaClient {
    if (!this.instance) {
      this.resolveQueryEngine();

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

      // ── Schema drift guard ─────────────────────────────────────────────
      // MUST run before any model query. The database above is whatever the
      // shop already had — the template is only copied when the file is
      // absent, so a terminal that has been selling since an earlier release
      // can be missing columns this build expects.
      //
      // Discovering that lazily is what produced the bulk-import failure:
      // Prisma reads every model column back after a write, so
      // `product.update()` threw P2022 on `costPricePaise` and rolled back the
      // entire ODS ingestion transaction. Additive gaps are closed here, under
      // a backup, before a single row is touched.
      // appPath / resourcesPath let the guard find the recorded DDL in
      // prisma/migrations (dev) or resources/migrations (packaged), which is
      // what lets it create whole missing tables instead of refusing.
      const guard = await SchemaGuard.ensureCompatible(client, paths.databaseFile, paths.backupDir, {
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath
      });

      if (!guard.safeToProceed) {
        this.fatalSchemaMessage = guard.fatalMessage;
        this.isInitialized = false;
        LoggerService.error('Database bootstrap aborted by the schema guard.');
        return false;
      }

      if (guard.repaired) {
        LoggerService.info(
          `Database schema repaired during startup (snapshot: ${guard.backupPath}). Continuing bootstrap.`
        );
      }

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
