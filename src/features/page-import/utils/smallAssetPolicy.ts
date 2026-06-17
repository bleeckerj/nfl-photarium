export const DEFAULT_SMALL_ASSET_THRESHOLD_MB = 0.05;
export const SMALL_ASSET_THRESHOLD_STEP_MB = 0.025;
export const MIN_SMALL_ASSET_THRESHOLD_MB = 0.05;
export const SMALL_ASSET_MB_TO_BYTES = 1_000_000;
export const MIN_SMALL_ASSET_DIMENSION = 50;

export type SmallAssetReviewReason = 'file-size' | 'dimensions';

export type SmallAssetReview = {
  thresholdBytes: number;
  reason: SmallAssetReviewReason;
};

type SmallAssetDimensions = {
  width: number;
  height: number;
};

type SmallAssetMetadata = {
  fileSizeBytes?: number;
  dimensions?: SmallAssetDimensions;
};

export const mbToSmallAssetThresholdBytes = (value: number): number =>
  Math.round(value * SMALL_ASSET_MB_TO_BYTES);

export const DEFAULT_SMALL_ASSET_THRESHOLD_BYTES = mbToSmallAssetThresholdBytes(
  DEFAULT_SMALL_ASSET_THRESHOLD_MB
);

export const normalizeSmallAssetThresholdBytes = (value: unknown): number => {
  const numericValue = typeof value === 'string' ? Number(value) : value;
  if (typeof numericValue !== 'number' || !Number.isFinite(numericValue)) {
    return DEFAULT_SMALL_ASSET_THRESHOLD_BYTES;
  }
  return Math.max(DEFAULT_SMALL_ASSET_THRESHOLD_BYTES, Math.round(numericValue));
};

export const normalizeSmallAssetThresholdMb = (value: string): string => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return String(DEFAULT_SMALL_ASSET_THRESHOLD_MB);
  }
  return String(Math.max(MIN_SMALL_ASSET_THRESHOLD_MB, parsed));
};

export const formatSmallAssetThresholdMb = (thresholdBytes: number): string => {
  const mb = thresholdBytes / SMALL_ASSET_MB_TO_BYTES;
  return mb.toFixed(3).replace(/\.?0+$/, '');
};

export const buildSmallAssetFileSizeReview = (
  fileSizeBytes: number | undefined,
  thresholdBytes: number
): SmallAssetReview | undefined => {
  if (typeof fileSizeBytes !== 'number' || !Number.isFinite(fileSizeBytes)) {
    return undefined;
  }
  return fileSizeBytes < thresholdBytes
    ? { thresholdBytes, reason: 'file-size' }
    : undefined;
};

export const buildSmallAssetDimensionReview = (
  dimensions: SmallAssetDimensions | undefined,
  thresholdBytes: number
): SmallAssetReview | undefined => {
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return undefined;
  }
  return dimensions.width < MIN_SMALL_ASSET_DIMENSION &&
    dimensions.height < MIN_SMALL_ASSET_DIMENSION
    ? { thresholdBytes, reason: 'dimensions' }
    : undefined;
};

export const reconcileSmallAssetReview = (
  currentReview: SmallAssetReview | undefined,
  metadata: SmallAssetMetadata | undefined
): SmallAssetReview | undefined => {
  if (!currentReview || !metadata) {
    return currentReview;
  }

  const thresholdBytes = currentReview.thresholdBytes;
  const fileSizeReview = buildSmallAssetFileSizeReview(metadata.fileSizeBytes, thresholdBytes);
  if (fileSizeReview) return fileSizeReview;

  const dimensionReview = buildSmallAssetDimensionReview(metadata.dimensions, thresholdBytes);
  if (dimensionReview) return dimensionReview;

  const hasResolvedFileSize =
    typeof metadata.fileSizeBytes === 'number' && Number.isFinite(metadata.fileSizeBytes);
  if (currentReview.reason === 'file-size' && hasResolvedFileSize) {
    return undefined;
  }

  const hasResolvedDimensions = Boolean(
    metadata.dimensions && metadata.dimensions.width > 0 && metadata.dimensions.height > 0
  );
  if (currentReview.reason === 'dimensions' && hasResolvedDimensions) {
    return undefined;
  }

  return currentReview;
};
