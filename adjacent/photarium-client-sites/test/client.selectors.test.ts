import { describe, expect, it } from 'vitest';
import {
  getGalleryStructureSignature,
  getLightboxAssetContext,
  getSelectedAssets,
  getShortlistPreviewAssets,
  getVisibleAssets,
} from '../src/client/domain/selectors';
import type { AppState } from '../src/client/domain/types';

const createState = (): AppState => ({
  project: null,
  assets: [
    {
      id: 'asset-1',
      assetType: 'image',
      filename: 'asset-1.jpg',
      displayName: 'Asset One',
      description: '',
      visibleTags: ['alpha'],
      fileSizeBytes: null,
      aspectRatio: null,
      dimensions: null,
      isCanonical: true,
      hasEmbedding: true,
      clusterId: 'cluster-a',
      clusterLabel: 'Cluster A',
      previewVariant: 'public',
      videoPlaybackUrl: null,
      videoHlsUrl: null,
      videoThumbnailUrl: null,
      videoPreviewUrl: null,
      videoDownloadUrl: null,
      preferredVideoPlaybackUrl: null,
      preferredVideoPlaybackKind: null,
      hasDownloadableVideo: false,
      videoDurationSeconds: null,
      sortOrder: 2,
    },
    {
      id: 'asset-2',
      assetType: 'image',
      filename: 'asset-2.jpg',
      displayName: 'Asset Two',
      description: '',
      visibleTags: ['beta'],
      fileSizeBytes: null,
      aspectRatio: null,
      dimensions: null,
      isCanonical: true,
      hasEmbedding: true,
      clusterId: 'cluster-b',
      clusterLabel: 'Cluster B',
      previewVariant: 'public',
      videoPlaybackUrl: null,
      videoHlsUrl: null,
      videoThumbnailUrl: null,
      videoPreviewUrl: null,
      videoDownloadUrl: null,
      preferredVideoPlaybackUrl: null,
      preferredVideoPlaybackKind: null,
      hasDownloadableVideo: false,
      videoDurationSeconds: null,
      sortOrder: 3,
    },
    {
      id: 'asset-3',
      assetType: 'image',
      filename: 'asset-3.jpg',
      displayName: 'Asset Three',
      description: '',
      visibleTags: ['alpha'],
      fileSizeBytes: null,
      aspectRatio: null,
      dimensions: null,
      isCanonical: true,
      hasEmbedding: true,
      clusterId: 'cluster-a',
      clusterLabel: 'Cluster A',
      previewVariant: 'public',
      videoPlaybackUrl: null,
      videoHlsUrl: null,
      videoThumbnailUrl: null,
      videoPreviewUrl: null,
      videoDownloadUrl: null,
      preferredVideoPlaybackUrl: null,
      preferredVideoPlaybackKind: null,
      hasDownloadableVideo: false,
      videoDurationSeconds: null,
      sortOrder: 1,
    },
  ],
  activeTag: null,
  selectedAssetIds: new Set(['asset-1', 'asset-3']),
  lightboxAssetId: 'asset-1',
  inlinePlayingAssetId: null,
  shortlistTrayExpanded: false,
  shortlistSubmitExpanded: false,
  submissionState: 'idle',
});

describe('client selectors', () => {
  it('sorts visible assets by sort order and respects the active tag', () => {
    const state = createState();
    expect(getVisibleAssets(state).map((asset) => asset.id)).toEqual(['asset-3', 'asset-1', 'asset-2']);

    state.activeTag = 'alpha';
    expect(getVisibleAssets(state).map((asset) => asset.id)).toEqual(['asset-3', 'asset-1']);
  });

  it('derives lightbox navigation from the visible asset order', () => {
    const state = createState();
    const context = getLightboxAssetContext(state);
    expect(context).toMatchObject({
      asset: expect.objectContaining({ id: 'asset-1' }),
      assetIndex: 1,
      assetCount: 3,
      previousAssetId: 'asset-3',
      nextAssetId: 'asset-2',
    });
  });

  it('returns selected assets and shortlist previews in sort order', () => {
    const state = createState();
    expect(getSelectedAssets(state).map((asset) => asset.id)).toEqual(['asset-3', 'asset-1']);
    expect(getShortlistPreviewAssets(state, 1).map((asset) => asset.id)).toEqual(['asset-3']);
  });

  it('keeps the gallery structure signature stable across selection-only changes', () => {
    const state = createState();
    const initialSignature = getGalleryStructureSignature(state);

    state.selectedAssetIds = new Set(['asset-2']);
    expect(getGalleryStructureSignature(state)).toBe(initialSignature);

    state.inlinePlayingAssetId = 'asset-1';
    expect(getGalleryStructureSignature(state)).toBe(initialSignature);

    state.activeTag = 'alpha';
    expect(getGalleryStructureSignature(state)).not.toBe(initialSignature);
  });
});
