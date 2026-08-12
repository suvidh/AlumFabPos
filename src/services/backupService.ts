import { PrismaClient, BackupMetadata } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';

const ENCRYPTION_SECRET = 'alumfab-secure-encryption-key-32';

export class BackupService {
  /**
   * Generates a 32-byte cryptographic key from our secret string
   */
  private static getEncryptionKey(): Buffer {
    return crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();
  }

  /**
   * Triggers a manual or automatic backup
   */
  public static async triggerBackup(
    prisma: PrismaClient,
    type: 'MANUAL' | 'AUTOMATIC' = 'MANUAL'
  ): Promise<BackupMetadata> {
    const dbPath = path.resolve(process.cwd(), 'prisma', 'pos.db');
    const backupsDir = path.resolve(process.cwd(), 'backups');

    if (!fs.existsSync(dbPath)) {
      throw new Error(`Active SQLite database file not found at: ${dbPath}`);
    }

    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    // 1. Read active database file
    const dbBuffer = fs.readFileSync(dbPath);

    // 2. Compress the database buffer using Gzip
    const compressed = zlib.gzipSync(dbBuffer);

    // 3. Encrypt the compressed buffer with AES-256-CBC
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);

    // Combine IV (first 16 bytes) and encrypted payload
    const finalBackupBuffer = Buffer.concat([iv, encrypted]);

    // 4. Save file to backups folder
    const timestampStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const filename = `backup_${timestampStr}.enc`;
    const filepath = path.join(backupsDir, filename);
    fs.writeFileSync(filepath, finalBackupBuffer);

    const sizeBytes = finalBackupBuffer.length;

    // 5. Insert audit log metadata
    const metadata = await prisma.backupMetadata.create({
      data: {
        filename,
        filepath,
        sizeBytes,
        backupType: type,
        status: 'SUCCESS'
      }
    });

    console.log(`[Backup System] Database backup generated: ${filename} (${(sizeBytes / 1024).toFixed(2)} KB)`);

    // 6. Enforce Rolling Retention Policy (Retain last 7, purge older ones)
    try {
      const allBackups = await prisma.backupMetadata.findMany({
        orderBy: { createdAt: 'asc' }
      });

      if (allBackups.length > 7) {
        const excessCount = allBackups.length - 7;
        const toDelete = allBackups.slice(0, excessCount);

        for (const oldBackup of toDelete) {
          if (fs.existsSync(oldBackup.filepath)) {
            fs.unlinkSync(oldBackup.filepath);
          }
          await prisma.backupMetadata.delete({
            where: { id: oldBackup.id }
          });
          console.log(`[Backup Retention] Purged excess old backup file: ${oldBackup.filename}`);
        }
      }
    } catch (e: any) {
      console.warn('[Backup Retention] Failed to process rolling retention checks:', e.message);
    }

    return metadata;
  }

  /**
   * Retrieves all available database backup files
   */
  public static async listBackups(prisma: PrismaClient): Promise<BackupMetadata[]> {
    return prisma.backupMetadata.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  /**
   * Safely restores the database from a backup file, verified with integrity checks
   */
  public static async restoreBackup(
    prisma: PrismaClient,
    backupId: string
  ): Promise<boolean> {
    const backup = await prisma.backupMetadata.findUnique({
      where: { id: backupId }
    });

    if (!backup) {
      throw new Error(`Backup record with ID ${backupId} not found in database.`);
    }

    if (!fs.existsSync(backup.filepath)) {
      throw new Error(`Backup file does not exist on disk: ${backup.filepath}`);
    }

    const dbPath = path.resolve(process.cwd(), 'prisma', 'pos.db');
    const safetySnapshotPath = path.resolve(process.cwd(), 'prisma', 'pos.db.bak');

    console.log(`[Disaster Recovery] Preparing database restore from file: ${backup.filename}`);

    // 1. Terminate current database connection
    await prisma.$disconnect();

    // 2. Create temporary safety snapshot backup of active pos.db
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, safetySnapshotPath);
    }

    try {
      // 3. Read and decrypt backup file
      const backupBuffer = fs.readFileSync(backup.filepath);
      
      const iv = backupBuffer.slice(0, 16);
      const encryptedData = backupBuffer.slice(16);

      const key = this.getEncryptionKey();
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      const decryptedCompressed = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

      // 4. Decompress Gzipped buffer
      const dbContent = zlib.gunzipSync(decryptedCompressed);

      // 5. Overwrite active database file
      fs.writeFileSync(dbPath, dbContent);

      // 6. Reconnect Prisma Client
      await prisma.$connect();

      // 7. Run database integrity validation checks
      // Verify file structure
      const integrity: any[] = await prisma.$queryRawUnsafe('PRAGMA integrity_check;');
      if (!integrity || integrity.length === 0 || integrity[0].integrity_check !== 'ok') {
        throw new Error('SQLite structure integrity validation failed.');
      }

      // Verify master table consistency
      await prisma.company.count();
      await prisma.branch.count();
      await prisma.product.count();

      // Integrity checks passed - clean up safety snapshot
      if (fs.existsSync(safetySnapshotPath)) {
        fs.unlinkSync(safetySnapshotPath);
      }

      console.log(`[Disaster Recovery] Restore from ${backup.filename} completed successfully. Safety snapshot cleared.`);
      return true;

    } catch (restoreErr: any) {
      console.error(`[Restore Failed] Error encountered: ${restoreErr.message}. Executing rollback recovery...`);

      // Rollback: Revert to safety snapshot pos.db.bak
      if (fs.existsSync(safetySnapshotPath)) {
        fs.copyFileSync(safetySnapshotPath, dbPath);
        fs.unlinkSync(safetySnapshotPath);
      }

      // Reconnect Prisma Client to rolled-back state
      await prisma.$connect();

      throw new Error(`Database restoration failed and was safely rolled back: ${restoreErr.message}`);
    }
  }
}
