import type { CachedCloudflareImage } from '@/server/cloudflareImageCache';
import { enrichImageAssetMetadata } from '@/server/assetMetadataEnrichment';
import { resolveAspectRatioClass } from '@/utils/aspectRatioClass';

type HydrationResult = {
  images: CachedCloudflareImage[];
  candidateCount: number;
  resolvedCount: number;
  unresolvedCount: number;
};

const readPositiveEnvNumber = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const HYDRATION_CONCURRENCY = Math.max(
  1,
  Math.min(16, readPositiveEnvNumber('ASPECT_METADATA_HYDRATION_CONCURRENCY', 8))
);
const RETRY_AFTER_MS = Math.max(
  30_000,
  readPositiveEnvNumber('ASPECT_METADATA_HYDRATION_RETRY_MS', 5 * 60 * 1000)
);

const attemptedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<CachedCloudflareImage | null>>();

const hasAspectMetadata = (image: CachedCloudflareImage): boolean =>
  resolveAspectRatioClass(image) !== null;

const hydrateOne = (image: CachedCloudflareImage): Promise<CachedCloudflareImage | null> => {
  const existing = inFlight.get(image.id);
  if (existing) return existing;

  attemptedAt.set(image.id, Date.now());
  const promise = enrichImageAssetMetadata(image, { includeSize: false })
    .catch((error) => {
      console.warn('[aspect-metadata] Failed to hydrate image metadata', {
        imageId: image.id,
        error,
      });
      return null;
    })
    .finally(() => {
      inFlight.delete(image.id);
    });
  inFlight.set(image.id, promise);
  return promise;
};

const isRetryable = (imageId: string): boolean => {
  const previousAttempt = attemptedAt.get(imageId);
  return previousAttempt === undefined || Date.now() - previousAttempt >= RETRY_AFTER_MS;
};

/**
 * Resolve aspect metadata for assets that are absent from the Redis side index.
 *
 * The gallery query must not treat side-index coverage as catalog coverage. A
 * bounded, deduplicated hydration pass fills historical gaps from the image
 * bytes and persists the result through the existing metadata enrichment path.
 */
export const hydrateMissingAspectMetadata = async (
  images: CachedCloudflareImage[]
): Promise<HydrationResult> => {
  const candidates = images.filter(
    (image) => !hasAspectMetadata(image) && isRetryable(image.id)
  );
  const hydratedById = new Map<string, CachedCloudflareImage>();
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < candidates.length) {
      const image = candidates[cursor];
      cursor += 1;
      const hydrated = await hydrateOne(image);
      if (hydrated && hasAspectMetadata(hydrated)) {
        hydratedById.set(hydrated.id, hydrated);
      }
    }
  };

  const workerCount = Math.min(HYDRATION_CONCURRENCY, candidates.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const hydratedImages = images.map((image) => hydratedById.get(image.id) ?? image);
  const resolvedCount = hydratedImages.filter(hasAspectMetadata).length;

  return {
    images: hydratedImages,
    candidateCount: candidates.length,
    resolvedCount,
    unresolvedCount: hydratedImages.length - resolvedCount,
  };
};

export const clearAspectMetadataHydrationState = (): void => {
  attemptedAt.clear();
  inFlight.clear();
};
