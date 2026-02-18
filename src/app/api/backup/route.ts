/**
 * Redis Backup API
 * 
 * POST /api/backup - Trigger a Redis backup
 * GET /api/backup - List existing backups
 * 
 * This provides programmatic access to the backup functionality.
 */

import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

// Backup configuration
const BACKUP_DIR = process.env.BACKUP_DIR || './backups/redis';
const KEEP_COUNT = parseInt(process.env.BACKUP_KEEP_COUNT || '10', 10);
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
const CONTAINER = process.env.REDIS_CONTAINER || 'photarium-redis';

interface BackupInfo {
  filename: string;
  timestamp: string;
  size: number;
  sizeHuman: string;
  type: 'rdb' | 'bundle';
  path: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function parseBackupFilename(filename: string): { timestamp: string; type: 'rdb' | 'bundle' } | null {
  const rdbMatch = filename.match(/^redis-backup-(\d{8}-\d{6}(?:[+-]\d{4})?)\.*\.rdb$/);
  if (rdbMatch) {
    return { timestamp: rdbMatch[1], type: 'rdb' };
  }
  const bundleMatch = filename.match(/^redis-backup-(\d{8}-\d{6}(?:[+-]\d{4})?)\.*\.tgz$/);
  if (bundleMatch) {
    return { timestamp: bundleMatch[1], type: 'bundle' };
  }
  return null;
}

/**
 * GET /api/backup - List existing backups
 */
export async function GET() {
  try {
    const backupPath = path.resolve(BACKUP_DIR);
    
    // Ensure directory exists
    try {
      await fs.access(backupPath);
    } catch {
      return NextResponse.json({
        backups: [],
        backupDir: backupPath,
        message: 'Backup directory does not exist yet',
      });
    }

    const files = await fs.readdir(backupPath);
    const backups: BackupInfo[] = [];

    for (const file of files) {
      const parsed = parseBackupFilename(file);
      if (!parsed) continue;

      const filePath = path.join(backupPath, file);
      const stats = await fs.stat(filePath);
      
      backups.push({
        filename: file,
        timestamp: parsed.timestamp,
        size: stats.size,
        sizeHuman: formatBytes(stats.size),
        type: parsed.type,
        path: filePath,
      });
    }

    // Sort by timestamp descending (newest first)
    backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // Group by timestamp
    const grouped = backups.reduce((acc, backup) => {
      if (!acc[backup.timestamp]) {
        acc[backup.timestamp] = { rdb: null as BackupInfo | null, bundle: null as BackupInfo | null };
      }
      acc[backup.timestamp][backup.type] = backup;
      return acc;
    }, {} as Record<string, { rdb: BackupInfo | null; bundle: BackupInfo | null }>);

    return NextResponse.json({
      backups,
      grouped,
      count: Object.keys(grouped).length,
      backupDir: backupPath,
      keepCount: KEEP_COUNT,
      retentionDays: RETENTION_DAYS,
    });
  } catch (error) {
    console.error('List backups error:', error);
    return NextResponse.json(
      { error: 'Failed to list backups', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/backup - Trigger a new backup
 * 
 * Body options:
 *   - keepCount: number - Override the number of backups to keep
 *   - retentionDays: number - Override age retention in days (default 30)
 *   - dryRun: boolean - If true, return what would be done without doing it
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const keepCount = body.keepCount ?? KEEP_COUNT;
    const retentionDays = body.retentionDays ?? RETENTION_DAYS;
    const dryRun = body.dryRun ?? false;

    // Check if Docker is available
    try {
      await execAsync('docker --version');
    } catch {
      return NextResponse.json(
        { error: 'Docker is not available or not in PATH' },
        { status: 500 }
      );
    }

    // Check if container is running
    try {
      const { stdout } = await execAsync(`docker ps --format '{{.Names}}' | grep -E '^${CONTAINER}$'`);
      if (!stdout.trim()) {
        throw new Error('Container not found');
      }
    } catch {
      return NextResponse.json(
        { error: `Redis container '${CONTAINER}' is not running` },
        { status: 500 }
      );
    }

    const rawTimestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const timestamp = rawTimestamp.replace(/(\d{8})(\d{6})/, '$1-$2');
    const backupFile = `redis-backup-${timestamp}.rdb`;
    const bundleFile = `redis-backup-${timestamp}.tgz`;
    const backupPath = path.resolve(BACKUP_DIR);

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        wouldCreate: {
          rdb: path.join(backupPath, backupFile),
          bundle: path.join(backupPath, bundleFile),
        },
        container: CONTAINER,
        keepCount,
        retentionDays,
      });
    }

    // Create backup directory
    await fs.mkdir(backupPath, { recursive: true });

    const steps: string[] = [];

    // Step 1: Trigger BGSAVE
    steps.push('Triggering Redis BGSAVE...');
    await execAsync(`docker exec ${CONTAINER} redis-cli BGSAVE`);
    
    // Wait for background save to complete (poll for up to 2 minutes)
    steps.push('Waiting for BGSAVE to complete...');
    const maxWait = 120;
    let waited = 0;
    while (waited < maxWait) {
      const { stdout } = await execAsync(
        `docker exec ${CONTAINER} redis-cli INFO persistence | grep rdb_bgsave_in_progress`
      );
      if (stdout.includes(':0')) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
      waited++;
    }

    // Step 2: Trigger BGREWRITEAOF (for AOF compaction)
    steps.push('Triggering BGREWRITEAOF...');
    try {
      await execAsync(`docker exec ${CONTAINER} redis-cli BGREWRITEAOF`);
      // Wait for AOF rewrite to complete (poll for up to 3 minutes)
      const maxAofWait = 180;
      let aofWaited = 0;
      while (aofWaited < maxAofWait) {
        const { stdout } = await execAsync(
          `docker exec ${CONTAINER} redis-cli INFO persistence | grep aof_rewrite_in_progress`
        );
        if (stdout.includes(':0')) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
        aofWaited++;
      }
    } catch {
      steps.push('BGREWRITEAOF skipped (not critical)');
    }

    // Step 3: Copy dump.rdb
    steps.push('Copying dump.rdb from container...');
    const rdbPath = path.join(backupPath, backupFile);
    await execAsync(`docker cp ${CONTAINER}:/data/dump.rdb "${rdbPath}"`);
    
    const rdbStats = await fs.stat(rdbPath);
    steps.push(`Created ${backupFile} (${formatBytes(rdbStats.size)})`);

    // Step 4: Create bundle with dump.rdb + AOF
    steps.push('Creating backup bundle...');
    const tempDir = path.join(backupPath, `.aof-tmp-${timestamp}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    // Copy rdb to temp
    await fs.copyFile(rdbPath, path.join(tempDir, 'dump.rdb'));
    
    // Try to copy AOF files
    let hasAof = false;
    try {
      await execAsync(`docker exec ${CONTAINER} sh -c 'test -f /data/appendonly.aof'`);
      await execAsync(`docker cp ${CONTAINER}:/data/appendonly.aof "${path.join(tempDir, 'appendonly.aof')}"`);
      hasAof = true;
    } catch {
      // No single AOF file
    }
    
    try {
      await execAsync(`docker exec ${CONTAINER} sh -c 'test -d /data/appendonlydir'`);
      await execAsync(`docker cp ${CONTAINER}:/data/appendonlydir "${path.join(tempDir, 'appendonlydir')}"`);
      hasAof = true;
    } catch {
      // No AOF directory
    }

    // Create tarball
    const bundlePath = path.join(backupPath, bundleFile);
    await execAsync(`tar -czf "${bundlePath}" -C "${tempDir}" .`);
    
    // Cleanup temp
    await fs.rm(tempDir, { recursive: true, force: true });
    
    const bundleStats = await fs.stat(bundlePath);
    steps.push(`Created ${bundleFile} (${formatBytes(bundleStats.size)})${!hasAof ? ' (RDB only, no AOF)' : ''}`);

    // Step 5: Rotate old backups
    steps.push(`Rotating old backups (older than ${retentionDays} days, then keeping ${keepCount})...`);
    const files = await fs.readdir(backupPath);
    let rdbFiles = files
      .filter(f => f.match(/^redis-backup-\d{8}-\d{6}(?:[+-]\d{4})?\.*\.rdb$/))
      .sort()
      .reverse();

    const nowMs = Date.now();
    const retentionMs = Math.max(0, Number(retentionDays)) * 24 * 60 * 60 * 1000;
    let agedRemovedCount = 0;

    for (const file of rdbFiles) {
      const rdbPathToCheck = path.join(backupPath, file);
      const stats = await fs.stat(rdbPathToCheck);
      if (nowMs - stats.mtimeMs <= retentionMs) {
        continue;
      }

      const ts = file.match(/redis-backup-(\d{8}-\d{6}(?:[+-]\d{4})?)\.*\.rdb$/)?.[1];
      await fs.unlink(rdbPathToCheck).catch(() => {});
      steps.push(`Removed (age>${retentionDays}d) ${file}`);
      agedRemovedCount++;
      if (ts) {
        const bundleName = `redis-backup-${ts}.tgz`;
        const bundleAltName = `redis-backup-${ts}..tgz`;
        await fs.unlink(path.join(backupPath, bundleName)).catch(() => {});
        await fs.unlink(path.join(backupPath, bundleAltName)).catch(() => {});
      }
    }

    const filesAfterAgeRotation = await fs.readdir(backupPath);
    rdbFiles = filesAfterAgeRotation
      .filter(f => f.match(/^redis-backup-\d{8}-\d{6}(?:[+-]\d{4})?\.*\.rdb$/))
      .sort()
      .reverse();
    
    if (rdbFiles.length > keepCount) {
      const toDelete = rdbFiles.slice(keepCount);
      for (const file of toDelete) {
        const ts = file.match(/redis-backup-(\d{8}-\d{6}(?:[+-]\d{4})?)\.*\.rdb$/)?.[1];
        await fs.unlink(path.join(backupPath, file)).catch(() => {});
        steps.push(`Removed (count) ${file}`);
        if (ts) {
          const bundleName = `redis-backup-${ts}.tgz`;
          const bundleAltName = `redis-backup-${ts}..tgz`;
          await fs.unlink(path.join(backupPath, bundleName)).catch(() => {});
          await fs.unlink(path.join(backupPath, bundleAltName)).catch(() => {});
        }
      }
    } else {
      if (agedRemovedCount > 0) {
        steps.push(`Removed ${agedRemovedCount} backup(s) by age; ${rdbFiles.length} backups remain`);
      } else {
        steps.push(`${rdbFiles.length} backups found, no rotation needed`);
      }
    }

    return NextResponse.json({
      success: true,
      backup: {
        rdb: {
          filename: backupFile,
          path: rdbPath,
          size: rdbStats.size,
          sizeHuman: formatBytes(rdbStats.size),
        },
        bundle: {
          filename: bundleFile,
          path: bundlePath,
          size: bundleStats.size,
          sizeHuman: formatBytes(bundleStats.size),
          includesAof: hasAof,
        },
      },
      timestamp,
      retentionDays,
      steps,
    });
  } catch (error) {
    console.error('Backup error:', error);
    return NextResponse.json(
      { error: 'Backup failed', details: String(error) },
      { status: 500 }
    );
  }
}
