import { getCachedImages } from '@/server/cloudflareImageCache';
import { getImageExtrasRecords, listImageExtrasImageIds } from '@/server/imageExtras';
import { listVideoAssetRecordsWithSync } from '@/server/videoCatalogStorage';

export interface SearchRequest {
  type: 'text' | 'image' | 'color';
  query?: string;
  imageId?: string;
  limit?: number;
  namespace?: string | null;
  diagnostics?: {
    component?: string;
    trigger?: string;
  };
}

export type SearchAssetMeta = {
  id: string;
  assetType: 'image' | 'video';
  filename?: string;
  displayName?: string;
  folder?: string;
  namespace?: string;
  tags?: string[];
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  videoThumbnailUrl?: string;
  videoPlaybackUrl?: string;
};

export type SearchResultRow = {
  imageId?: string;
  id?: string;
  filename?: string;
  displayName?: string;
  score?: number;
  folder?: string;
  [key: string]: unknown;
};

export type SearchResultNormalized = SearchResultRow & {
  imageId: string;
  id: string;
  canonicalImageId: string;
  requestedImageId?: string;
};

export type SearchScopeAsset = SearchAssetMeta & {
  sourceUrl?: string;
  sourceUrlNormalized?: string;
};

const normalizeText = (value?: string | null) => String(value ?? '').toLowerCase();

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const SOURCE_QUERY_MIN_DIGITS = 10;

function isLikelySourceUrlQuery(query: string): boolean {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('discord.com/channels/')) return true;
  return /\d{10,}/.test(normalized);
}

function matchesSourceQuery(query: string, sourceUrl?: string, sourceUrlNormalized?: string): boolean {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return false;

  const haystacks = [sourceUrl, sourceUrlNormalized]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  if (haystacks.length === 0) return false;

  if (haystacks.some((value) => value.includes(normalizedQuery))) return true;

  const digitTokens = normalizedQuery.match(/\d+/g)?.filter((token) => token.length >= SOURCE_QUERY_MIN_DIGITS) ?? [];
  if (digitTokens.length === 0) return false;
  return haystacks.some((value) => digitTokens.every((token) => value.includes(token)));
}

const splitCamelCase = (value?: string) =>
  (value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

function lexicalNameScore(image: SearchAssetMeta, query: string): number {
  const tokens = tokenize(query);
  if (!tokens.length) return 0;

  const displayName = normalizeText(image.displayName);
  const displayNameSplit = normalizeText(splitCamelCase(image.displayName));
  const filename = normalizeText(image.filename);
  const tags = normalizeText((image.tags ?? []).join(' '));
  const sourceUrl = normalizeText(image.sourceUrl);
  const sourceUrlNormalized = normalizeText(image.sourceUrlNormalized);
  const sourceText = `${sourceUrl} ${sourceUrlNormalized}`.trim();
  const joinedQuery = tokens.join(' ');

  const tokenCoverage = (haystack: string) => {
    if (!haystack) return 0;
    let matched = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) matched += 1;
    }
    return matched / tokens.length;
  };

  const phraseBonus = (haystack: string) => {
    if (!haystack) return 0;
    return haystack.includes(joinedQuery) ? 0.2 : 0;
  };

  const displayScore = Math.max(tokenCoverage(displayName), tokenCoverage(displayNameSplit)) + phraseBonus(displayNameSplit);
  const tagScore = tokenCoverage(tags) + phraseBonus(tags);
  const fileScore = tokenCoverage(filename) + phraseBonus(filename);
  const sourceScore = tokenCoverage(sourceText) + phraseBonus(sourceText);

  return Math.min(1, displayScore * 0.5 + tagScore * 0.2 + fileScore * 0.1 + sourceScore * 0.2);
}

export function rerankSemanticTextResults(
  vectorResults: SearchResultNormalized[],
  allImages: SearchAssetMeta[],
  query: string,
  limit: number,
  namespace: string | null
): SearchResultNormalized[] {
  const scopedImages =
    namespace === null
      ? allImages
      : allImages.filter((img) => (namespace === '' ? !img.namespace : (img.namespace || '') === namespace));

  const byId = new Map(scopedImages.map((img) => [img.id, img]));
  const vectorRowById = new Map(vectorResults.map((row) => [row.imageId, row]));
  const vectorRankById = new Map<string, number>();
  vectorResults.forEach((row, index) => {
    vectorRankById.set(row.imageId, 1 - index / Math.max(1, vectorResults.length));
  });

  const lexical = new Map<string, number>();
  for (const image of scopedImages) {
    const score = lexicalNameScore(image, query);
    if (score > 0) lexical.set(image.id, score);
  }

  const candidateIds = new Set<string>([
    ...vectorRankById.keys(),
    ...Array.from(lexical.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(limit * 2, 60))
      .map(([id]) => id),
  ]);

  const combined = Array.from(candidateIds).map((id) => {
    const vRank = vectorRankById.get(id) ?? 0;
    const lScore = lexical.get(id) ?? 0;
    const combinedRelevance = vRank * 0.82 + lScore * 0.18;
    const base = vectorRowById.get(id);
    const image = byId.get(id);

    const row: SearchResultNormalized =
      base ??
      {
        imageId: id,
        id,
        canonicalImageId: id,
        filename: image?.filename,
        displayName: image?.displayName,
        folder: image?.folder,
      };

    row.score =
      typeof row.score === 'number' && Number.isFinite(row.score)
        ? row.score
        : Math.max(0, 1 - combinedRelevance);

    return { row, score: combinedRelevance, vRank, lScore };
  });

  combined.sort((a, b) => b.score - a.score || b.vRank - a.vRank || b.lScore - a.lScore);
  return combined.slice(0, limit).map((entry) => entry.row);
}

export async function findSourceUrlMatches(
  query: string,
  candidateImages: SearchScopeAsset[],
  limit: number
): Promise<SearchResultRow[]> {
  if (!isLikelySourceUrlQuery(query) || candidateImages.length === 0) return [];

  const candidateById = new Map(candidateImages.map((image) => [image.id, image]));
  const extrasIds = await listImageExtrasImageIds();
  const candidateIds = extrasIds.filter((id) => candidateById.has(id));
  const matches: SearchResultRow[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < candidateIds.length; i += 250) {
    const batchIds = candidateIds.slice(i, i + 250);
    const extrasById = await getImageExtrasRecords(batchIds);
    for (const imageId of batchIds) {
      const image = candidateById.get(imageId);
      const extras = extrasById[imageId];
      if (!image || !extras) continue;
      if (!matchesSourceQuery(query, extras.sourceUrl, extras.sourceUrlNormalized)) continue;
      if (seen.has(imageId)) continue;
      seen.add(imageId);
      matches.push({
        imageId,
        id: imageId,
        filename: image.filename,
        displayName: image.displayName,
        folder: image.folder,
        score: 1,
      });
      if (matches.length >= Math.max(limit * 2, 50)) {
        return matches;
      }
    }
  }

  return matches;
}

export function prependUniqueResults(
  preferred: SearchResultNormalized[],
  existing: SearchResultNormalized[]
): SearchResultNormalized[] {
  const seen = new Set<string>();
  const merged: SearchResultNormalized[] = [];

  for (const row of [...preferred, ...existing]) {
    const id = row.canonicalImageId || row.imageId || row.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
  }

  return merged;
}

export function normalizeNamespace(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === '__none__') return '';
  if (trimmed === '__all__') return null;
  return trimmed;
}

export function filterResultsByNamespace<T extends { imageId: string }>(
  results: T[],
  allImages: { id: string; namespace?: string }[],
  namespace: string | null
): T[] {
  if (namespace === null) return results;
  const idToNamespace = new Map(allImages.map((img) => [img.id, img.namespace || '']));
  return results.filter((r) => {
    const ns = idToNamespace.get(r.imageId);
    if (ns === undefined) return false;
    if (namespace === '') return !ns;
    return ns === namespace;
  });
}

function norm(value: string | undefined | null): string {
  return String(value ?? '').trim().toLowerCase();
}

function buildImageLookup(images: SearchAssetMeta[]) {
  const byId = new Map<string, SearchAssetMeta>();
  const byFilename = new Map<string, string[]>();
  const byDisplayName = new Map<string, string[]>();

  const pushIndex = (index: Map<string, string[]>, raw: string | undefined, id: string) => {
    const key = norm(raw);
    if (!key) return;
    const list = index.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    index.set(key, list);
  };

  for (const image of images) {
    byId.set(image.id, image);
    pushIndex(byFilename, image.filename, image.id);
    pushIndex(byDisplayName, image.displayName, image.id);
  }

  return { byId, byFilename, byDisplayName };
}

function resolveCanonicalImageId(
  rawId: string | undefined,
  filename: string | undefined,
  displayName: string | undefined,
  lookup: ReturnType<typeof buildImageLookup>
): string | undefined {
  const { byId, byFilename, byDisplayName } = lookup;
  const tryResolve = (candidate: string | undefined): string | undefined => {
    const direct = String(candidate ?? '').trim();
    if (!direct) return undefined;
    if (byId.has(direct)) return direct;

    const key = norm(candidate);
    if (!key) return undefined;

    const fromFilename = byFilename.get(key);
    if (fromFilename && fromFilename.length === 1) return fromFilename[0];

    const fromDisplayName = byDisplayName.get(key);
    if (fromDisplayName && fromDisplayName.length === 1) return fromDisplayName[0];

    return undefined;
  };

  return tryResolve(rawId) ?? tryResolve(filename) ?? tryResolve(displayName) ?? rawId;
}

export function normalizeSearchResults(
  results: SearchResultRow[],
  allImages: SearchAssetMeta[]
): SearchResultNormalized[] {
  const lookup = buildImageLookup(allImages);
  const normalized: SearchResultNormalized[] = [];

  for (const row of results) {
    const rawId = typeof row.imageId === 'string'
      ? row.imageId
      : typeof row.id === 'string'
        ? row.id
        : undefined;
    const filename = typeof row.filename === 'string' ? row.filename : undefined;
    const displayName = typeof row.displayName === 'string' ? row.displayName : undefined;
    const canonicalId = resolveCanonicalImageId(rawId, filename, displayName, lookup);
    if (!canonicalId) continue;

    const item: SearchResultNormalized = {
      ...row,
      imageId: canonicalId,
      id: canonicalId,
      canonicalImageId: canonicalId,
    };
    const meta = lookup.byId.get(canonicalId);
    if (meta) {
      item.assetType = meta.assetType;
      if (meta.videoThumbnailUrl) item.videoThumbnailUrl = meta.videoThumbnailUrl;
      if (meta.videoPlaybackUrl) item.videoPlaybackUrl = meta.videoPlaybackUrl;
    }
    if (rawId && rawId !== canonicalId) {
      item.requestedImageId = rawId;
    }
    normalized.push(item);
  }

  return normalized;
}

export async function loadSearchScopeAssets(): Promise<SearchScopeAsset[]> {
  const [cachedImages, videos] = await Promise.all([
    getCachedImages(),
    listVideoAssetRecordsWithSync(),
  ]);
  return [
    ...cachedImages.map((img) => ({ ...img, assetType: 'image' as const })),
    ...videos.map((video) => ({
      id: video.id,
      assetType: 'video' as const,
      generatedBy: typeof video.generatedBy === 'string' ? video.generatedBy : undefined,
      comfyMetadataDetected: Boolean(video.comfyMetadataDetected),
      comfyMetadataSource: typeof video.comfyMetadataSource === 'string' ? video.comfyMetadataSource : undefined,
      filename: video.filename,
      displayName: video.filename,
      folder: video.folder,
      namespace: video.namespace,
      tags: video.tags,
      videoThumbnailUrl: video.thumbnailUrl || video.previewUrl,
      videoPlaybackUrl: video.playbackUrl,
    })),
  ];
}
