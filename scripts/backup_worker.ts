import { PrismaClient } from '@prisma/client';
import { BackupService } from '../src/services/backupService';

const prisma = new PrismaClient();

async function runScheduledBackup() {
  console.log('[Automatic Backup Worker] Starting scheduled backup routine...');
  try {
    const backup = await BackupService.triggerBackup(prisma, 'AUTOMATIC');
    console.log(`[Automatic Backup Worker] SUCCESS: File: ${backup.filename} | Size: ${(backup.sizeBytes / 1024).toFixed(2)} KB`);
  } catch (err: any) {
    console.error('[Automatic Backup Worker] FATAL: Scheduled backup failed:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

runScheduledBackup();
