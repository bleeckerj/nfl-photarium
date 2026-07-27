import { normalizeHashKey, normalizeUrlKey } from '@/components/gallery/utils';
import type { GalleryDuplicateSummary, GalleryQueryAsset } from './galleryQuery';

export type GalleryDuplicateAnalysis = GalleryDuplicateSummary & {
  status: 'ready';
  catalogVersion: number;
  analyzedCount: number;
};

type CachedAnalysis = {
  key: string;
  promise: Promise<GalleryDuplicateAnalysis>;
};

const GLOBAL_KEY = Symbol.for('photarium.galleryDuplicateAnalysis');
const globalObject = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: CachedAnalysis[];
};
const analyses = globalObject[GLOBAL_KEY] ?? [];
if (!globalObject[GLOBAL_KEY]) {
  globalObject[GLOBAL_KEY] = analyses;
}

const yieldToRequestLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

const parseUploadedAt = (asset: GalleryQueryAsset) => {
  const parsed = Date.parse(asset.uploaded ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildAnalysis = async (
  assets: GalleryQueryAsset[],
  catalogVersion: number,
  pageIds: string[]
): Promise<GalleryDuplicateAnalysis> => {
  const groups = new Map<string, GalleryQueryAsset[]>();
  const seenByGroup = new Map<string, Set<string>>();

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    const urlKey = normalizeUrlKey(asset.originalUrlNormalized);
    const hashKey = normalizeHashKey(asset.contentHash);
    if (urlKey && hashKey) {
      const key = `${urlKey}|${hashKey}`;
      const seen = seenByGroup.get(key) ?? new Set<string>();
      if (!seen.has(asset.id)) {
        seen.add(asset.id);
        seenByGroup.set(key, seen);
        const group = groups.get(key) ?? [];
        group.push(asset);
        groups.set(key, group);
      }
    }
    if (index > 0 && index % 1_000 === 0) {
      await yieldToRequestLoop();
    }
  }

  const duplicateGroups = Array.from(groups.values()).filter((group) => group.length > 1);
  const allDuplicateIds: string[] = [];
  const excludingNewest: string[] = [];
  const excludingOldest: string[] = [];
  for (let index = 0; index < duplicateGroups.length; index += 1) {
    const group = duplicateGroups[index];
    allDuplicateIds.push(...group.map((asset) => asset.id));
    const newestFirst = [...group].sort((a, b) => parseUploadedAt(b) - parseUploadedAt(a));
    const oldestFirst = [...newestFirst].reverse();
    excludingNewest.push(...newestFirst.slice(1).map((asset) => asset.id));
    excludingOldest.push(...oldestFirst.slice(1).map((asset) => asset.id));
    if (index > 0 && index % 250 === 0) {
      await yieldToRequestLoop();
    }
  }

  const duplicateIdSet = new Set(allDuplicateIds);
  return {
    status: 'ready',
    catalogVersion,
    analyzedCount: assets.length,
    groupCount: duplicateGroups.length,
    imageCount: duplicateIdSet.size,
    pageDuplicateIds: pageIds.filter((id) => duplicateIdSet.has(id)),
    allDuplicateIds,
    duplicateIdsExcludingNewest: excludingNewest,
    duplicateIdsExcludingOldest: excludingOldest,
  };
};

export const analyzeGalleryDuplicates = (
  assets: GalleryQueryAsset[],
  options: {
    catalogVersion: number;
    scopeKey: string;
    pageIds?: string[];
  }
): Promise<GalleryDuplicateAnalysis> => {
  const pageIds = options.pageIds ?? [];
  const key = `${options.catalogVersion}|${options.scopeKey}|${pageIds.join(',')}`;
  const cached = analyses.find((entry) => entry.key === key);
  if (cached) return cached.promise;

  const entry: CachedAnalysis = {
    key,
    promise: buildAnalysis(assets, options.catalogVersion, pageIds),
  };
  analyses.unshift(entry);
  analyses.splice(8);
  entry.promise.catch(() => {
    const index = analyses.indexOf(entry);
    if (index >= 0) analyses.splice(index, 1);
  });
  return entry.promise;
};

export const clearGalleryDuplicateAnalysisCache = (): void => {
  analyses.splice(0);
};
