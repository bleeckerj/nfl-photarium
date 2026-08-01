/**
 * Reference-image search ("find images that look like this").
 *
 * Accepts raw bytes of an ephemeral reference image (never uploaded to the
 * catalog) and returns two result tracks:
 *   - exactMatches: catalog images whose contentHash matches the reference
 *     bytes (raw or prepared-for-upload form)
 *   - results: CLIP nearest neighbors of the reference embedding
 */

import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  generateClipEmbeddingFromBytes,
  type EmbeddingLogContext,
} from '@/server/embeddingService';
import { searchByCLIP, isVectorSearchAvailable } from '@/server/vectorSearch';
import { findDuplicatesByContentHash } from '@/server/duplicateDetector';
import { getCachedImages, type CachedCloudflareImage } from '@/server/cloudflareImageCache';
import { prepareImageForUpload } from '@/server/uploadPreparation';
import {
  filterResultsByNamespace,
  loadSearchScopeAssets,
  normalizeSearchResults,
  type SearchResultNormalized,
  type SearchResultRow,
} from '@/server/imageSearchRoute';
import { shouldExcludeFromCLIP } from '@/utils/searchExclusion';

export const MAX_REFERENCE_BYTES = 25 * 1024 * 1024;

/** Longest edge of the downscaled reference sent to the CLIP provider. */
const CLIP_REFERENCE_EDGE = 512;

export class ReferenceDecodeError extends Error {
  constructor(message = 'Unsupported or corrupt image format') {
    super(message);
    this.name = 'ReferenceDecodeError';
  }
}

export type ReferenceSearchWarning = 'clip-unavailable' | 'vector-search-unavailable';

export interface ReferenceSearchOptions {
  fileName: string;
  fileType: string;
  limit: number;
  namespace: string | null;
  context?: EmbeddingLogContext;
}

export interface ReferenceSearchCoverage {
  totalImages: number;
  withClip: number;
  notIndexed: number;
}

export interface ReferenceSearchOutcome {
  exactMatches: SearchResultNormalized[];
  results: SearchResultNormalized[];
  coverage: ReferenceSearchCoverage;
  warnings: ReferenceSearchWarning[];
}

const sha256Hex = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * Downscale/transcode the reference for the CLIP provider. Animated inputs
 * are reduced to their first frame (sharp default without `animated: true`).
 */
export async function prepareReferenceForClip(rawBytes: Buffer): Promise<Buffer> {
  try {
    return await sharp(rawBytes)
      .resize(CLIP_REFERENCE_EDGE, CLIP_REFERENCE_EDGE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    throw new ReferenceDecodeError(
      'Unsupported or corrupt image format (JPEG/PNG/WebP/GIF/AVIF supported)'
    );
  }
}

/**
 * Catalog contentHash is the sha256 of the *prepared* upload buffer
 * (uploadService), and small files pass through preparation unchanged — so we
 * hash both the raw bytes and, best-effort, the prepared form.
 */
export async function findExactCatalogMatches(
  rawBytes: Buffer,
  fileName: string,
  fileType: string
): Promise<CachedCloudflareImage[]> {
  const hashes = new Set<string>([sha256Hex(rawBytes)]);

  try {
    const prepared = await prepareImageForUpload({ buffer: rawBytes, fileType, fileName });
    if (prepared.ok) {
      hashes.add(sha256Hex(prepared.data.buffer));
    }
  } catch {
    // Preparation failures just mean we only match on the raw-bytes hash.
  }

  const matchesById = new Map<string, CachedCloudflareImage>();
  for (const hash of hashes) {
    const matches = await findDuplicatesByContentHash(hash);
    for (const match of matches) {
      matchesById.set(match.id, match);
    }
  }
  return Array.from(matchesById.values());
}

async function computeClipCoverage(): Promise<ReferenceSearchCoverage> {
  const images = await getCachedImages();
  const withClip = images.filter((img) => img.hasClipEmbedding).length;
  return {
    totalImages: images.length,
    withClip,
    notIndexed: images.length - withClip,
  };
}

export async function searchByReferenceImage(
  rawBytes: Buffer,
  options: ReferenceSearchOptions
): Promise<ReferenceSearchOutcome> {
  const { fileName, fileType, namespace, context } = options;
  const limit = Math.min(100, Math.max(1, options.limit));
  const warnings: ReferenceSearchWarning[] = [];

  // CLIP needs a decodable reference; fail fast before any catalog work.
  const clipBytes = await prepareReferenceForClip(rawBytes);

  const [exactImages, coverage, allAssets, vectorAvailable] = await Promise.all([
    findExactCatalogMatches(rawBytes, fileName, fileType),
    computeClipCoverage(),
    loadSearchScopeAssets(),
    isVectorSearchAvailable(),
  ]);

  // Exact matches are intentionally not namespace-scoped and ignore search
  // exclusion tags: the user has the file in hand, so hiding the catalog copy
  // would defeat the "I know this image is in there" use case.
  const exactRows: SearchResultRow[] = exactImages.map((img) => ({
    imageId: img.id,
    id: img.id,
    filename: img.filename,
    displayName: img.displayName,
    folder: img.folder,
    namespace: img.namespace,
    score: 1,
    matchType: 'exact',
  }));
  const exactMatches = normalizeSearchResults(exactRows, allAssets);
  const exactIds = new Set(exactMatches.map((row) => row.canonicalImageId));

  let similar: SearchResultNormalized[] = [];
  if (!vectorAvailable) {
    warnings.push('vector-search-unavailable');
  } else {
    const embedding = await generateClipEmbeddingFromBytes(clipBytes, context);
    if (!embedding) {
      warnings.push('clip-unavailable');
    } else {
      // Over-fetch headroom: namespace filtering, exclusion tags, and exact-ID
      // dedupe all happen after KNN.
      const internalLimit = Math.min(250, (namespace === null ? limit : limit * 10) + 10);
      let rows = await searchByCLIP(embedding, internalLimit);

      const tagsById = new Map(allAssets.map((asset) => [asset.id, asset.tags]));
      rows = rows.filter((row) => !shouldExcludeFromCLIP(tagsById.get(row.imageId)));

      if (namespace !== null) {
        rows = filterResultsByNamespace(rows, allAssets, namespace);
      }

      similar = normalizeSearchResults(rows as SearchResultRow[], allAssets)
        .filter((row) => !exactIds.has(row.canonicalImageId))
        .slice(0, limit);
    }
  }

  return { exactMatches, results: similar, coverage, warnings };
}
