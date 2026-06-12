import { apiRequest } from '../shared/api-client.js';

export interface BackupInfo {
  filename: string;
  timestamp: string;
  size: number;
  sizeHuman: string;
  type: 'rdb' | 'bundle';
  path: string;
}

export interface BackupResult {
  success: boolean;
  backup?: {
    rdb: { filename: string; path: string; size: number; sizeHuman: string };
    bundle: { filename: string; path: string; size: number; sizeHuman: string; includesAof: boolean };
  };
  timestamp?: string;
  steps?: string[];
  dryRun?: boolean;
  wouldCreate?: { rdb: string; bundle: string };
}

export interface ListBackupsResult {
  backups: BackupInfo[];
  grouped: Record<string, { rdb: BackupInfo | null; bundle: BackupInfo | null }>;
  count: number;
  backupDir: string;
  keepCount: number;
}

export async function createBackup(options: { keepCount?: number; dryRun?: boolean } = {}): Promise<BackupResult> {
  return apiRequest('/api/backup', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export async function listBackups(): Promise<ListBackupsResult> {
  return apiRequest('/api/backup');
}
