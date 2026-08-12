import { api } from '../api';
// @ts-ignore
import { db } from '../db';

export class SyncCoordinator {
  private static isSyncing = false;

  /**
   * Monitor online events to trigger automatic background synchronization
   */
  public static init() {
    window.addEventListener('online', () => {
      console.log('[Sync Engine] Internet connection restored. Initiating automatic sync...');
      this.syncPendingInvoices();
    });

    // Run sync on load if online
    if (navigator.onLine) {
      this.syncPendingInvoices();
    }
  }

  /**
   * Synchronizes queued offline invoices to the SQLite / cloud server
   */
  public static async syncPendingInvoices(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      const pending = await db.invoices.where('syncStatus').equals('LOCAL_ONLY').toArray();
      if (pending.length === 0) {
        this.isSyncing = false;
        return;
      }

      console.log(`[Sync Engine] Found ${pending.length} pending offline invoices. Syncing...`);

      for (const inv of pending) {
        try {
          // Construct payload compatible with api.createSale
          const payload = {
            branchId: inv.branchId || 'branch-a-id',
            customerId: inv.customerId || undefined,
            items: inv.items.map((item: any) => ({
              productId: item.productId,
              quantityDecimal: item.qty,
              rateRupees: item.unitPrice,
              discountRupees: (item.qty * item.unitPrice * (item.lineDiscountPercent || 0)) / 100
            })),
            payments: inv.payments || [
              { method: inv.paymentMethod || 'CASH', amountRupees: inv.total }
            ],
            offlineUuid: inv.offlineUuid || inv.invoiceNo
          };

          // Post to SQLite via contextBridge API
          const syncedSale = await api.createSale(payload);
          
          // Update local Dexie record to SYNCED
          await db.invoices.update(inv.id, {
            syncStatus: 'SYNCED',
            invoiceNo: syncedSale.invoiceNumber
          });

          console.log(`[Sync Engine] Successfully synced invoice ${inv.invoiceNo} -> ${syncedSale.invoiceNumber}`);
        } catch (err: any) {
          console.error(`[Sync Engine] Failed to sync invoice ${inv.invoiceNo}:`, err.message);
        }
      }
    } catch (e: any) {
      console.error('[Sync Engine] Sync run error:', e.message);
    } finally {
      this.isSyncing = false;
    }
  }
}
