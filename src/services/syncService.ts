import { PrismaClient, Sale, SaleItem, Payment } from '@prisma/client';
import { SalesService, CreateSaleInput } from './salesService';

export class SyncService {
  /**
   * Synchronizes an offline transaction with full server-side idempotency guards
   */
  public static async syncOfflineSale(
    prisma: PrismaClient,
    input: CreateSaleInput & { offlineUuid: string }
  ): Promise<Sale & { items: SaleItem[]; payments: Payment[] }> {
    // 1. Idempotency Check: Verify if this client UUID has already been synced
    const existing = await prisma.sale.findUnique({
      where: { offlineUuid: input.offlineUuid },
      include: { items: true, payments: true }
    });

    if (existing) {
      console.log(`[Idempotency ACK] Transaction with offline_uuid ${input.offlineUuid} already exists. Returning existing sale.`);
      return existing;
    }

    // 2. Not synced yet: Process checkout atomically and log restocks/credits
    console.log(`[Syncing] Processing fresh offline sale with offline_uuid ${input.offlineUuid}...`);
    return SalesService.createSale(prisma, {
      ...input,
      syncStatus: 'SYNCED'
    });
  }
}
