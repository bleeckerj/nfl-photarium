import { useCallback, useEffect, useMemo, useState } from 'react';

interface BackupInfo {
  timestamp: string;
  date: Date;
  sizeHuman: string;
  type: 'bundle' | 'rdb';
}

export const useGalleryBackup = (toastPush: (message: string) => void) => {
  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  const parseBackupTimestamp = useCallback((timestamp: string) => {
    const match = timestamp.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})([+-]\d{4})?/);
    if (!match) return null;
    const [, year, month, day, hour, minute, second, tzOffset] = match;
    const utcMs = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
    if (!tzOffset) {
      return new Date(utcMs);
    }
    const sign = tzOffset.startsWith('-') ? -1 : 1;
    const offsetHours = Number(tzOffset.slice(1, 3));
    const offsetMinutes = Number(tzOffset.slice(3, 5));
    const offsetTotalMinutes = sign * (offsetHours * 60 + offsetMinutes);
    return new Date(utcMs - offsetTotalMinutes * 60 * 1000);
  }, []);

  const fetchLatestBackup = useCallback(async () => {
    try {
      setBackupError(null);
      const response = await fetch('/api/backup');
      if (!response.ok) {
        throw new Error('Failed to load backups');
      }
      const data = await response.json();
      const backups = (data?.backups ?? []) as Array<{
        timestamp: string;
        sizeHuman: string;
        type: 'bundle' | 'rdb';
      }>;
      if (!backups.length) {
        setBackupInfo(null);
        return;
      }
      const latestTimestamp = backups
        .map((backup) => backup.timestamp)
        .sort()
        .reverse()[0];
      const latestBundle = backups.find(
        (backup) => backup.timestamp === latestTimestamp && backup.type === 'bundle'
      );
      const latestRdb = backups.find(
        (backup) => backup.timestamp === latestTimestamp && backup.type === 'rdb'
      );
      const chosen = latestBundle ?? latestRdb;
      if (!chosen) {
        setBackupInfo(null);
        return;
      }
      const date = parseBackupTimestamp(chosen.timestamp);
      if (!date) {
        setBackupInfo(null);
        return;
      }
      setBackupInfo({
        timestamp: chosen.timestamp,
        date,
        sizeHuman: chosen.sizeHuman,
        type: chosen.type,
      });
    } catch (error) {
      console.error('Failed to load backup info', error);
      setBackupError(error instanceof Error ? error.message : 'Backup info unavailable');
    }
  }, [parseBackupTimestamp]);

  useEffect(() => {
    void fetchLatestBackup();
  }, [fetchLatestBackup]);

  const handleCreateBackup = useCallback(async () => {
    try {
      setBackupLoading(true);
      setBackupError(null);
      const response = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to create backup');
      }
      toastPush('Backup created');
      await fetchLatestBackup();
    } catch (error) {
      console.error('Backup failed', error);
      setBackupError(error instanceof Error ? error.message : 'Backup failed');
      toastPush('Backup failed');
    } finally {
      setBackupLoading(false);
    }
  }, [fetchLatestBackup, toastPush]);

  const labels = useMemo(() => {
    const backupAgeDays = backupInfo
      ? (Date.now() - backupInfo.date.getTime()) / (1000 * 60 * 60 * 24)
      : null;
    return {
      backupAgeLabel: backupAgeDays !== null ? `${backupAgeDays.toFixed(1)}d old` : '—',
      backupTimeLabel: backupInfo ? backupInfo.date.toLocaleString() : '—',
      backupSizeLabel: backupInfo ? backupInfo.sizeHuman : '—',
    };
  }, [backupInfo]);

  return {
    backupLoading,
    backupError,
    handleCreateBackup,
    ...labels,
  };
};
