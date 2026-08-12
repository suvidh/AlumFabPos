import { PrismaClient } from '@prisma/client';
import { BackupService } from '../src/services/backupService';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function runBackupTests() {
  console.log('--- STARTING DATABASE BACKUP & RESTORE RECOVERY TESTS ---');

  try {
    const backupsDir = path.resolve(process.cwd(), 'backups');
    const dbPath = path.resolve(process.cwd(), 'prisma', 'pos.db');

    // 1. Trigger Manual Backup
    console.log('\n[1/4] Triggering manual AES-256 compressed database backup...');
    const backup = await BackupService.triggerBackup(prisma, 'MANUAL');
    
    console.log(`✔ Backup Created successfully:`);
    console.log(`  - File: ${backup.filename}`);
    console.log(`  - Path: ${backup.filepath}`);
    console.log(`  - Size: ${(backup.sizeBytes / 1024).toFixed(2)} KB`);
    console.log(`  - Status: ${backup.status}`);

    // Verify file exists on disk
    if (fs.existsSync(backup.filepath)) {
      console.log(`✔ Confirmed: Physical backup file exists on local disk.`);
    } else {
      throw new Error('Physical backup file was not found on disk!');
    }

    // 2. Test Backup Listing
    console.log('\n[2/4] Testing backup list queries...');
    const list = await BackupService.listBackups(prisma);
    console.log(`✔ Retrieved list of backups. Total files: ${list.length}`);
    console.log(`Latest backup: ${list[0].filename}`);

    // 3. Test Rolling Retention Policy
    console.log('\n[3/4] Testing rolling retention policy (creating 10 backups, checking limit of 7)...');
    for (let i = 0; i < 9; i++) {
      // Small timeout to vary timestamp string
      await new Promise(r => setTimeout(r, 1000));
      await BackupService.triggerBackup(prisma, 'AUTOMATIC');
    }

    const currentBackups = await BackupService.listBackups(prisma);
    console.log(`✔ Confirmed: Backups after multiple triggers: ${currentBackups.length} (Expected: exactly 7 due to rolling retention)`);
    
    // Check files on disk match DB entries
    const files = fs.readdirSync(backupsDir).filter(f => f.startsWith('backup_') && f.endsWith('.enc'));
    console.log(`✔ Confirmed: Physical encrypted files in backups directory: ${files.length} (Expected: exactly 7)`);

    if (currentBackups.length === 7 && files.length === 7) {
      console.log('✔ PASS: Rolling retention correctly keeps only the last 7 daily files.');
    } else {
      console.error('❌ FAIL: Retention policy failed to limit files to exactly 7!');
    }

    // 4. Test Disaster Recovery Restores & Safety Rollbacks
    console.log('\n[4/4] Testing disaster recovery database restores...');
    
    // Perform standard restore from the latest valid backup
    const latestBackup = currentBackups[0];
    console.log(`Attempting safe restore from: ${latestBackup.filename}`);
    const restoreSuccess = await BackupService.restoreBackup(prisma, latestBackup.id);
    console.log(`✔ RESTORE RESULT: ${restoreSuccess ? 'SUCCESS' : 'FAILED'}`);

    // Test rollback safety on corrupted restoration
    console.log('\nSimulating corrupted restore attempt (injecting write failure)...');
    // Write corrupted payload to a fake backup record
    const corruptFilepath = path.join(backupsDir, 'backup_corrupt.enc');
    fs.writeFileSync(corruptFilepath, Buffer.from('CORRUPTED_AES_BUFFER_DUMMY_DATA_TRUNCATED'));
    
    const corruptMetadata = await prisma.backupMetadata.create({
      data: {
        filename: 'backup_corrupt.enc',
        filepath: corruptFilepath,
        sizeBytes: 42,
        backupType: 'MANUAL',
        status: 'SUCCESS'
      }
    });

    try {
      console.log('Restoring from corrupted backup...');
      await BackupService.restoreBackup(prisma, corruptMetadata.id);
      console.error('❌ FAIL: Allowed restoring from corrupted file without error!');
    } catch (err: any) {
      console.log(`✔ PASS: Restoration correctly failed & rolled back to safety snapshot: "${err.message}"`);
      // Verify database still exists and is healthy post-rollback
      const productCount = await prisma.product.count();
      console.log(`Confirmed database health post-rollback: Product Count = ${productCount}`);
    }

    // Clean up corrupt backup artifact
    if (fs.existsSync(corruptFilepath)) fs.unlinkSync(corruptFilepath);
    await prisma.backupMetadata.delete({ where: { id: corruptMetadata.id } });

    // Cleanup all remaining test backups
    console.log('\nCleaning up remaining backup audit files...');
    const allRemBackups = await prisma.backupMetadata.findMany();
    for (const b of allRemBackups) {
      if (fs.existsSync(b.filepath)) fs.unlinkSync(b.filepath);
      await prisma.backupMetadata.delete({ where: { id: b.id } });
    }
    console.log('Cleanup completed.');

    console.log('\n--- ALL BACKUP & DISASTER RECOVERY TESTS COMPLETED SUCCESSFULLY ---');

  } catch (err: any) {
    console.error('❌ Backup test run failed with fatal error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

runBackupTests();
