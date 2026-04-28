import type { ClientAsset } from '@client/domain/types';
import { formatVideoDuration, resolveVideoPlayback } from '@client/rendering/media';

const formatAspectRatioFromDimensions = (
  dimensions: ClientAsset['dimensions']
): string | null => {
  if (!dimensions?.width || !dimensions?.height) return null;
  const divisor = greatestCommonDivisor(dimensions.width, dimensions.height);
  return `${Math.round(dimensions.width / divisor)}:${Math.round(dimensions.height / divisor)}`;
};

export const formatAssetAspectRatio = (asset: ClientAsset): string =>
  asset.aspectRatio || formatAspectRatioFromDimensions(asset.dimensions) || '';

export const formatAssetFileSize = (bytes: number | null): string =>
  typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0
    ? formatBytes(bytes)
    : '';

export const formatAssetRuntime = (asset: ClientAsset): string | null => {
  if (asset.assetType !== 'video') return null;
  return formatVideoDuration(resolveVideoPlayback(asset).durationSeconds);
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${rounded} ${units[unitIndex]}`;
};

const greatestCommonDivisor = (a: number, b: number): number => {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
};
