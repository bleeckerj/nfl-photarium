import { getCachedImages } from '@/server/cloudflareImageCache';
import type { CachedCloudflareImage } from '@/server/cloudflareImageCache';
import { getImageExtrasRecord, getImageExtrasRecords, patchImageExtrasRecord } from '@/server/imageExtras';
import { toExifSummaryRecord } from '@/server/imageExtrasExif';

export type ExifPropagationMode = 'fill-missing' | 'overwrite';

/** Which side of the family the source sits on, which decides the target set. */
export type ExifPropagationRelation = 'parent' | 'child';

export type ExifPropagationSkip = {
  id: string;
  reason: 'already-has-exif';
};

export type ExifPropagationFailure = {
  id: string;
  status: number;
  message: string;
};

export type ExifPropagationResult = {
  sourceId: string;
  familyRootId: string;
  relation: ExifPropagationRelation;
  mode: ExifPropagationMode;
  dryRun: boolean;
  exif: Record<string, string | number>;
  targetIds: string[];
  updatedIds: string[];
  skipped: ExifPropagationSkip[];
  failed: ExifPropagationFailure[];
};

export class ExifPropagationError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ExifPropagationError';
    this.status = status;
  }
}

const normalizeId = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const normalizeExifPropagationMode = (value: unknown): ExifPropagationMode =>
  value === 'overwrite' ? 'overwrite' : 'fill-missing';

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const current = index;
      if (current >= items.length) return;
      index += 1;
      results[current] = await worker(items[current]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Resolve the EXIF an image currently exposes. The extras record is the durable
 * store and wins; the cached Cloudflare metadata copy is a fallback for images
 * uploaded before EXIF was persisted to extras.
 */
async function resolveImageExif(
  image: CachedCloudflareImage,
  extrasExif: unknown
): Promise<Record<string, string | number> | undefined> {
  return toExifSummaryRecord(extrasExif) ?? toExifSummaryRecord(image.exif);
}

/**
 * Decide which family members receive the source's EXIF.
 *
 * - A canonical parent pushes to its direct children (the variants).
 * - A child pushes to its parent and every sibling under that parent.
 *
 * Only image records are considered: EXIF lives in the image extras store and
 * video assets have no equivalent slot.
 */
export function resolveExifPropagationTargets(
  source: CachedCloudflareImage,
  images: CachedCloudflareImage[]
): { relation: ExifPropagationRelation; familyRootId: string; targets: CachedCloudflareImage[] } {
  const parentId = normalizeId(source.parentId);
  if (parentId) {
    const parent = images.find((image) => image.id === parentId);
    const siblings = images.filter(
      (image) => normalizeId(image.parentId) === parentId && image.id !== source.id
    );
    return {
      relation: 'child',
      familyRootId: parentId,
      targets: parent ? [parent, ...siblings] : siblings,
    };
  }
  return {
    relation: 'parent',
    familyRootId: source.id,
    targets: images.filter((image) => normalizeId(image.parentId) === source.id),
  };
}

export async function propagateImageExif(
  sourceIdRaw: string,
  options?: {
    mode?: ExifPropagationMode;
    dryRun?: boolean;
    concurrency?: number;
    forceRefreshImages?: boolean;
  }
): Promise<ExifPropagationResult> {
  const sourceId = normalizeId(sourceIdRaw);
  if (!sourceId) {
    throw new ExifPropagationError(400, 'Image ID is required.');
  }

  const mode = options?.mode ?? 'fill-missing';
  const dryRun = options?.dryRun === true;
  const concurrency = Math.min(8, Math.max(1, options?.concurrency ?? 4));

  const images = await getCachedImages(options?.forceRefreshImages === true);
  const source = images.find((image) => image.id === sourceId);
  if (!source) {
    throw new ExifPropagationError(404, 'Image not found');
  }

  const sourceExtras = await getImageExtrasRecord(sourceId);
  const exif = await resolveImageExif(source, sourceExtras?.exif);
  if (!exif) {
    throw new ExifPropagationError(400, 'This image has no EXIF data to push.');
  }

  const { relation, familyRootId, targets } = resolveExifPropagationTargets(source, images);
  const targetIds = targets.map((target) => target.id);

  if (targets.length === 0) {
    return { sourceId, familyRootId, relation, mode, dryRun, exif, targetIds, updatedIds: [], skipped: [], failed: [] };
  }

  // One batched read for the skip decision instead of a read per target; the
  // patch below still does its own read-modify-write so other extras fields
  // written concurrently are not clobbered.
  const extrasById = await getImageExtrasRecords(targetIds);
  const skipped: ExifPropagationSkip[] = [];
  const pending: CachedCloudflareImage[] = [];
  for (const target of targets) {
    const existing = await resolveImageExif(target, extrasById[target.id]?.exif);
    if (mode === 'fill-missing' && existing) {
      skipped.push({ id: target.id, reason: 'already-has-exif' });
    } else {
      pending.push(target);
    }
  }

  if (dryRun) {
    return {
      sourceId,
      familyRootId,
      relation,
      mode,
      dryRun,
      exif,
      targetIds,
      updatedIds: pending.map((target) => target.id),
      skipped,
      failed: [],
    };
  }

  const outcomes = await runWithConcurrency(pending, concurrency, async (target) => {
    try {
      await patchImageExtrasRecord(target.id, { exif });
      return { ok: true as const, id: target.id };
    } catch (error) {
      return {
        ok: false as const,
        id: target.id,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  return {
    sourceId,
    familyRootId,
    relation,
    mode,
    dryRun,
    exif,
    targetIds,
    updatedIds: outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.id),
    skipped,
    failed: outcomes
      .filter((outcome): outcome is { ok: false; id: string; message: string } => !outcome.ok)
      .map((outcome) => ({ id: outcome.id, status: 500, message: outcome.message })),
  };
}
