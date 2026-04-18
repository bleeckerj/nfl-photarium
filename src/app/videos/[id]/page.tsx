'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Plus, RefreshCw, Trash2, WandSparkles } from 'lucide-react';
import { useDropzone } from 'react-dropzone';

import { useToast } from '@/components/Toast';
import MonoSelect from '@/components/MonoSelect';
import { AdoptVariationSection } from '@/components/image-detail/AdoptVariationSection';
import { UploadVariationSection } from '@/components/image-detail/UploadVariationSection';
import { VARIATION_UPLOAD_ACCEPT } from '@/components/image-detail/variationUploadConfig';
import { AssetFamilyList } from '@/components/asset-detail/AssetFamilyList';
import { AssetTypeBadge } from '@/components/asset-detail/AssetTypeBadge';

import { getCloudflareImageUrl } from '@/utils/imageUtils';
import { copyToClipboard } from '@/utils/clipboard';
import { getAssetCopyUrl } from '@/utils/assetUrls';
import { cleanString } from '@/utils/cloudflareMetadata';
import {
  buildVideoDownloadShareUrl,
  buildVideoDetailShareUrl,
  generateQrDataUrl,
} from '@/services/shareLinkService';
import { hasFreshGalleryReturnState } from '@/components/gallery/returnState';

import { useVariationUpload } from '@/hooks/useVariationUpload';
import { usePersistentShareBaseUrl } from '@/hooks/usePersistentShareBaseUrl';

import { patchParentAssignment as patchParentAssignmentService } from '@/services/parentAssignmentService';
import {
  deleteImage,
  fetchDeleteFamilyStatus,
  startDeleteFamilyJob,
  type DeleteFamilyJobStatus,
} from '@/services/imageDeletionService';

type VideoRecord = {
  id: string;
  assetType?: 'video';
  filename: string;
  displayName?: string;
  uploaded: string;
  parentId?: string;
  variationSort?: number;
  streamUid: string;
  playbackUrl?: string;
  hlsUrl?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  durationSeconds?: number;
  videoStatus: 'pending' | 'ready' | 'error';
  width?: number;
  height?: number;
  aspectRatio?: string;
  streamSyncedAt?: string;
  streamError?: string;
  hasClipEmbedding?: boolean;
  folder?: string;
  tags: string[];
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  namespace?: string;
  mux?: {
    assetId: string;
    status: 'queued' | 'ingesting' | 'ready' | 'error';
    ingestUrl?: string;
    playbackId?: string;
    playbackIds?: string[];
    playbackUrl?: string;
    exportedAt?: string;
    syncedAt?: string;
    error?: string;
  };
  animatedWebpImageId?: string;
  animatedWebpUrl?: string;
  animatedWebpStatus?: 'pending' | 'ready' | 'error';
  animatedWebpError?: string;
  animatedWebpUpdatedAt?: string;
  animatedWebpBytes?: number;
  animatedWebpWidth?: number;
  animatedWebpHeight?: number;
  animatedWebpVariants?: Array<{
    imageId: string;
    url?: string;
    filename: string;
    bytes: number;
    width?: number;
    height?: number;
    fps: number;
    loop: boolean;
    maxWidth: number;
    maxHeight: number;
    maxOutputBytes: number;
    timeoutMs: number;
    encoder?: string;
    createdAt: string;
  }>;
};

type AssetRecord = {
  id: string;
  assetType?: 'image' | 'video';
  filename: string;
  displayName?: string;
  uploaded: string;
  variants?: string[];
  size?: number;
  folder?: string;
  tags?: string[];
  description?: string;
  altTag?: string;
  parentId?: string;
  namespace?: string;
  variationSort?: number;
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
};

type VariationDraft = {
  id: string;
  filename: string;
  maxWidth: string;
  maxOutputMb: string;
  fps: string;
  loop: boolean;
};

type GenerationSummary = {
  createdCount: number;
  failedCount: number;
  partial: boolean;
  variations: Array<{
    imageId: string;
    url: string;
    filename: string;
    bytes: number;
    width?: number;
    height?: number;
    fps: number;
    loop: boolean;
    encoder?: string;
  }>;
  errors: Array<{ index: number; filename: string; error: string }>;
  hints: string[];
};

type FramePreviewEntry = {
  frameNumber: number;
  timeSeconds: number;
  previewUrl: string;
};

type FrameMeta = {
  durationSeconds: number;
  fps: number;
  frameCount: number;
  exactFrameCount: boolean;
  midpointFrame: number;
  defaultSelector: string;
  previews: FramePreviewEntry[];
  currentFrame?: FramePreviewEntry;
  limits?: {
    maxExtractFrameCount?: number;
  };
};

type ActiveFramePreview = {
  frameNumber: number;
  timeSeconds: number;
  objectUrl: string;
};

type DownloadProbeState = {
  status: 'idle' | 'checking' | 'ready' | 'preparing' | 'unavailable' | 'error';
  message?: string;
};

const MAX_OUTPUT_MB_DEFAULT = 10;
const DETAIL_VIDEO_LIST_LIMIT = 5000;
const PRESET_MAP = {
  preview: { maxWidth: '640', maxOutputMb: '2', fps: '8' },
  balanced: { maxWidth: '960', maxOutputMb: '6', fps: '12' },
  quality: { maxWidth: '1280', maxOutputMb: '10', fps: '15' },
} as const;

const createVariationDraft = (seed?: Partial<VariationDraft>): VariationDraft => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  filename: seed?.filename ?? '',
  maxWidth: seed?.maxWidth ?? '960',
  maxOutputMb: seed?.maxOutputMb ?? String(MAX_OUTPUT_MB_DEFAULT),
  fps: seed?.fps ?? '12',
  loop: seed?.loop ?? true,
});

const toOptionalPositiveInt = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed);
};

const toOptionalPositiveNumber = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};

const formatBytes = (bytes: number) => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const formatDuration = (seconds?: number) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '--';
  const rounded = Math.max(0, Math.round(seconds));
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatFrameTime = (seconds?: number) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 1) return `${seconds.toFixed(2)}s`;
  return `${formatDuration(seconds)}.${Math.floor((seconds % 1) * 100).toString().padStart(2, '0')}`;
};

const normalizeTags = (value: string) =>
  Array.from(new Set(value
    .split(',')
    .map((tag) => cleanString(tag))
    .filter((tag): tag is string => Boolean(tag))
  ));

const sortFamilyAssets = (items: AssetRecord[]) => {
  const hasSort = items.some((item) => Number.isFinite(item.variationSort));
  if (!hasSort) {
    return [...items].sort((a, b) => Date.parse(b.uploaded) - Date.parse(a.uploaded));
  }
  const baseIndex = new Map(items.map((item, index) => [item.id, index]));
  return [...items].sort((a, b) => {
    const aSort = Number.isFinite(a.variationSort) ? (a.variationSort as number) : null;
    const bSort = Number.isFinite(b.variationSort) ? (b.variationSort as number) : null;
    if (aSort === null && bSort === null) {
      return (baseIndex.get(a.id) ?? 0) - (baseIndex.get(b.id) ?? 0);
    }
    if (aSort === null) return 1;
    if (bSort === null) return -1;
    if (aSort !== bSort) return aSort - bSort;
    return (baseIndex.get(a.id) ?? 0) - (baseIndex.get(b.id) ?? 0);
  });
};

const buildAssetsListUrl = (namespace?: string, includeFamilyFor?: string) => {
  const base = (() => {
    if (namespace === '') return '/api/images?namespace=__none__';
    if (namespace) return `/api/images?namespace=${encodeURIComponent(namespace)}`;
    return '/api/images';
  })();

  const [path, query] = base.split('?');
  const params = new URLSearchParams(query || '');
  params.set('videoLimit', String(DETAIL_VIDEO_LIST_LIMIT));
  if (includeFamilyFor) {
    params.set('includeFamilyFor', includeFamilyFor);
  }
  return `${path}?${params.toString()}`;
};

export default function VideoDetailPage() {
  const params = useParams();
  const search = useSearchParams();
  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const toast = useToast();

  const galleryPageParam = search.get('gpage');
  const galleryNamespaceParam = search.get('gns') ?? '';
  const [preferSessionReturn, setPreferSessionReturn] = useState(false);

  useEffect(() => {
    setPreferSessionReturn(hasFreshGalleryReturnState(galleryNamespaceParam));
  }, [galleryNamespaceParam]);

  const backHref = useMemo(() => {
    if (preferSessionReturn) return '/';
    if (!galleryPageParam) return '/';
    return `/?gpage=${encodeURIComponent(galleryPageParam)}&gns=${encodeURIComponent(galleryNamespaceParam)}`;
  }, [galleryNamespaceParam, galleryPageParam, preferSessionReturn]);

  const [video, setVideo] = useState<VideoRecord | null>(null);
  const [allAssets, setAllAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefreshStream, setAutoRefreshStream] = useState(true);

  const [folderInput, setFolderInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [originalUrlInput, setOriginalUrlInput] = useState('');
  const [sourceUrlInput, setSourceUrlInput] = useState('');
  const [namespaceInput, setNamespaceInput] = useState('');
  const [namespaceOptions, setNamespaceOptions] = useState<Array<{ value: string; label: string }>>([
    { value: '', label: '[none]' },
  ]);
  const [metadataSaving, setMetadataSaving] = useState(false);

  const [shareQrDataUrl, setShareQrDataUrl] = useState('');
  const [hoverPreview, setHoverPreview] = useState<{
    url: string;
    label: string;
    x: number;
    y: number;
  } | null>(null);

  const [detachingSiblingId, setDetachingSiblingId] = useState<string | null>(null);
  const [deletingSiblingId, setDeletingSiblingId] = useState<string | null>(null);
  const [deletingCurrent, setDeletingCurrent] = useState(false);

  const [deleteFamilyJobId, setDeleteFamilyJobId] = useState<string | null>(null);
  const [deleteFamilyStatus, setDeleteFamilyStatus] = useState<DeleteFamilyJobStatus | null>(null);

  const [generatingAnimatedWebp, setGeneratingAnimatedWebp] = useState(false);
  const [variationDrafts, setVariationDrafts] = useState<VariationDraft[]>([createVariationDraft()]);
  const [generationSummary, setGenerationSummary] = useState<GenerationSummary | null>(null);

  const [adoptSearch, setAdoptSearch] = useState('');
  const [adoptFolderFilter, setAdoptFolderFilter] = useState('');
  const [adoptAssetTypeFilter, setAdoptAssetTypeFilter] = useState<'' | 'image' | 'video'>('');
  const [adoptPage, setAdoptPage] = useState(1);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assigningBulk, setAssigningBulk] = useState(false);
  const [siblingSearch, setSiblingSearch] = useState('');
  const [siblingPage, setSiblingPage] = useState(1);
  const SIBLING_PAGE_SIZE = 12;

  const [muxActionLoading, setMuxActionLoading] = useState(false);
  const [muxSyncing, setMuxSyncing] = useState(false);
  const [downloadProbe, setDownloadProbe] = useState<DownloadProbeState>({ status: 'idle' });
  const [frameMeta, setFrameMeta] = useState<FrameMeta | null>(null);
  const [frameMetaLoading, setFrameMetaLoading] = useState(false);
  const [frameMetaError, setFrameMetaError] = useState<string | null>(null);
  const [frameSelectorInput, setFrameSelectorInput] = useState('first,middle,last');
  const [frameJumpInput, setFrameJumpInput] = useState('1');
  const [activeFramePreview, setActiveFramePreview] = useState<ActiveFramePreview | null>(null);
  const [framePreviewLoading, setFramePreviewLoading] = useState(false);
  const [framePreviewError, setFramePreviewError] = useState<string | null>(null);
  const [extractingFrames, setExtractingFrames] = useState(false);

  const cloudflareAccountHash = process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH;
  const { shareBaseUrl, setShareBaseUrl } = usePersistentShareBaseUrl();

  const uniqueFolders = useMemo(
    () => Array.from(new Set(allAssets
      .map((asset) => asset.folder?.trim())
      .filter((value): value is string => Boolean(value))))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
    [allAssets]
  );

  const folderOptions = useMemo(
    () => [
      { value: '', label: '[none]' },
      ...uniqueFolders.map((folder) => ({ value: folder, label: folder })),
    ],
    [uniqueFolders]
  );

  const adoptFolderOptions = useMemo(
    () => [
      { value: '', label: 'All folders' },
      ...uniqueFolders.map((folder) => ({ value: folder, label: folder })),
    ],
    [uniqueFolders]
  );

  const adoptAssetTypeOptions = useMemo(
    () => [
      { value: '', label: 'All types' },
      { value: 'image', label: 'Images only' },
      { value: 'video', label: 'Videos only' },
    ],
    []
  );

  const namespaceSelectOptions = useMemo(() => {
    const current = cleanString(namespaceInput) || '';
    const seen = new Set(namespaceOptions.map((entry) => entry.value));
    if (!current || seen.has(current)) return namespaceOptions;
    return [...namespaceOptions, { value: current, label: current }]
      .sort((a, b) => {
        if (a.value === '') return -1;
        if (b.value === '') return 1;
        return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
      });
  }, [namespaceInput, namespaceOptions]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/namespaces', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
        const discovered = Array.isArray(payload?.namespaces)
          ? payload.namespaces.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          : [];
        const options = [
          { value: '', label: '[none]' },
          ...Array.from(new Set<string>(discovered))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
            .map((namespace) => ({ value: namespace, label: namespace })),
        ];
        if (!cancelled) setNamespaceOptions(options);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchAssets = useCallback(async (namespace?: string, includeFamilyFor?: string) => {
    const response = await fetch(buildAssetsListUrl(namespace, includeFamilyFor), { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to load assets');
    }
    const assets = Array.isArray(payload?.images)
      ? payload.images.filter((entry: unknown): entry is AssetRecord => Boolean(entry && typeof entry === 'object'))
      : [];
    setAllAssets(assets);
    return assets;
  }, []);

  const fetchVideo = useCallback(async (forceRefresh = false) => {
    if (!id) return;
    setError(null);
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch(
        `/api/videos/${id}${forceRefresh ? '?refresh=1' : ''}`,
        { cache: 'no-store' }
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to load video');
      }
      const record = payload.video as VideoRecord;
      setVideo(record);
      setFolderInput(record.folder || '');
      setTagsInput(Array.isArray(record.tags) ? record.tags.join(', ') : '');
      setDescriptionInput(record.description || '');
      setDisplayNameInput(record.displayName || record.filename || '');
      setOriginalUrlInput(record.originalUrl || '');
      setSourceUrlInput(record.sourceUrl || '');
      setNamespaceInput(record.namespace || '');

      await fetchAssets(record.namespace ?? galleryNamespaceParam, record.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load video');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAssets, galleryNamespaceParam, id]);

  const refreshAll = useCallback(async () => {
    await fetchVideo(true);
  }, [fetchVideo]);

  useEffect(() => {
    void fetchVideo(false);
  }, [fetchVideo]);

  useEffect(() => {
    if (!autoRefreshStream) return;
    if (!id) return;
    if (video?.videoStatus !== 'pending') return;

    let cancelled = false;
    const delayMs = 8000;

    (async () => {
      while (!cancelled) {
        await fetchVideo(true);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    })().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [autoRefreshStream, fetchVideo, id, video?.videoStatus]);

  const currentVideoAsset = useMemo(() => {
    if (!video) return null;
    return {
      id: video.id,
      assetType: 'video' as const,
      filename: video.filename,
      displayName: video.displayName || video.filename,
      uploaded: video.uploaded,
      parentId: video.parentId,
      folder: video.folder,
      description: video.description,
      tags: video.tags,
      videoPlaybackUrl: video.playbackUrl,
      videoHlsUrl: video.hlsUrl,
      videoThumbnailUrl: video.thumbnailUrl,
      videoPreviewUrl: video.previewUrl,
    };
  }, [video]);

  const parentImage = useMemo(() => {
    if (!video?.parentId) return null;
    return allAssets.find((asset) => asset.id === video.parentId) || null;
  }, [allAssets, video?.parentId]);
  const adoptableImages = useMemo(() => {
    return allAssets.filter((asset) => {
      if (asset.parentId) return false;
      if (asset.id === video?.id) return false;
      return true;
    });
  }, [allAssets, video?.id]);
  const familyRootId = video?.parentId || video?.id || '';
  const familyRootAsset = video?.parentId ? parentImage : currentVideoAsset;
  const isCanonicalVideo = Boolean(video?.id) && !video?.parentId;

  const parentFamilyAssets = useMemo(() => {
    if (!familyRootId) return [];
    const family = allAssets.filter((asset) => asset.parentId === familyRootId && asset.id !== video?.id);
    return sortFamilyAssets(family);
  }, [allAssets, familyRootId, video?.id]);

  const filteredParentFamilyAssets = useMemo(() => {
    if (!siblingSearch.trim()) return parentFamilyAssets;
    const term = siblingSearch.toLowerCase();
    return parentFamilyAssets.filter((asset) => {
      if ((asset.id || '').toLowerCase().includes(term)) return true;
      const haystack = [
        asset.displayName,
        asset.filename,
        asset.folder,
        asset.description,
        asset.altTag,
        ...(asset.tags || []),
      ]
        .filter(Boolean)
        .map(String)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [parentFamilyAssets, siblingSearch]);

  const totalSiblingPages = Math.max(1, Math.ceil(filteredParentFamilyAssets.length / SIBLING_PAGE_SIZE));
  const pagedParentFamilyAssets = useMemo(() => {
    const start = (siblingPage - 1) * SIBLING_PAGE_SIZE;
    return filteredParentFamilyAssets.slice(start, start + SIBLING_PAGE_SIZE);
  }, [filteredParentFamilyAssets, siblingPage, SIBLING_PAGE_SIZE]);

  useEffect(() => {
    setSiblingPage(1);
  }, [siblingSearch, familyRootId]);

  useEffect(() => {
    setSiblingPage((prev) => Math.min(prev, totalSiblingPages));
  }, [totalSiblingPages]);

  const filteredAdoptableImages = useMemo(() => {
    const candidates = adoptableImages.filter((asset) => asset.id !== familyRootId);
    const folderFiltered = candidates.filter((asset) => {
      if (!adoptFolderFilter) return true;
      return (asset.folder || '').toLowerCase() === adoptFolderFilter.toLowerCase();
    });
    const typeFiltered = folderFiltered.filter((asset) => {
      if (!adoptAssetTypeFilter) return true;
      if (adoptAssetTypeFilter === 'video') return (asset.assetType || 'image') === 'video';
      return (asset.assetType || 'image') !== 'video';
    });

    if (!adoptSearch.trim()) return typeFiltered;
    const term = adoptSearch.toLowerCase();
    return typeFiltered.filter((asset) => {
      if ((asset.id || '').toLowerCase().includes(term)) return true;
      const haystack = [
        asset.displayName,
        asset.filename,
        asset.folder,
        asset.description,
        asset.altTag,
        ...(asset.tags || []),
      ]
        .filter(Boolean)
        .map(String)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [adoptAssetTypeFilter, adoptFolderFilter, adoptSearch, adoptableImages, familyRootId]);

  const ADOPT_PAGE_SIZE = 12;
  const totalAdoptPages = Math.max(1, Math.ceil(filteredAdoptableImages.length / ADOPT_PAGE_SIZE));
  const pagedAdoptableImages = useMemo(() => {
    const start = (adoptPage - 1) * ADOPT_PAGE_SIZE;
    return filteredAdoptableImages.slice(start, start + ADOPT_PAGE_SIZE);
  }, [adoptPage, filteredAdoptableImages]);

  useEffect(() => {
    setAdoptPage(1);
  }, [adoptAssetTypeFilter, adoptFolderFilter, adoptSearch, familyRootId]);

  useEffect(() => {
    setAdoptPage((prev) => Math.min(prev, totalAdoptPages));
  }, [totalAdoptPages]);

  const {
    childUploadFiles,
    setChildUploadFiles,
    childUploadTags,
    childUploadFolder,
    childUploadLoading,
    childUploadUrl,
    childUploadUrlLoading,
    setChildUploadUrl,
    childImportUrl,
    childImportLoading,
    childImportError,
    setChildImportUrl,
    handleImportFromUrl,
    handleChildUpload,
    handleChildUploadByUrl,
  } = useVariationUpload({
    imageId: familyRootId || undefined,
    imageFolder: familyRootAsset?.folder,
    imageTags: familyRootAsset?.tags,
    imageNamespace: video?.namespace,
    refreshImageList: refreshAll,
    toast,
  });

  const onVariantDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    setChildUploadFiles((prev) => [...prev, ...acceptedFiles]);
  }, [setChildUploadFiles]);

  const {
    getRootProps: getVariantDropzoneProps,
    getInputProps: getVariantInputProps,
    isDragActive: isVariantDragActive,
  } = useDropzone({
    onDrop: onVariantDrop,
    accept: VARIATION_UPLOAD_ACCEPT,
    multiple: true,
  });

  const handleCopyText = useCallback(async (text: string, label?: string) => {
    if (!text) {
      toast.push('Nothing to copy');
      return;
    }
    await copyToClipboard(text, label, toast.push);
  }, [toast]);

  const handleAssetDragStart = useCallback((event: React.DragEvent, asset: AssetRecord) => {
    const url = getAssetCopyUrl(asset, { imageVariant: 'original' });
    if (!url) return;
    event.dataTransfer.clearData();
    event.dataTransfer.setData('text/plain', url);
    event.dataTransfer.setData('text/uri-list', url);
    event.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleThumbMouseMove = useCallback((url: string, label: string, evt: React.MouseEvent) => {
    setHoverPreview({
      url,
      label,
      x: evt.clientX + 16,
      y: evt.clientY + 16,
    });
  }, []);

  const handleThumbLeave = useCallback(() => {
    setHoverPreview(null);
  }, []);

  const handleAssignExistingAsChild = useCallback(async (targetId: string) => {
    if (!familyRootId) {
      toast.push('Family root is not available for this video.');
      return;
    }
    setAssigningId(targetId);
    try {
      await patchParentAssignmentService(targetId, familyRootId);
      toast.push('Variant assigned');
      await refreshAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to assign variant';
      toast.push(message);
    } finally {
      setAssigningId(null);
    }
  }, [familyRootId, refreshAll, toast]);

  const handleAssignExistingAsChildren = useCallback(async (targetIds: string[]) => {
    if (!familyRootId) {
      toast.push('Family root is not available for this video.');
      return;
    }

    const uniqueIds = Array.from(new Set(targetIds.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    setAssigningBulk(true);
    let successCount = 0;
    const failures: string[] = [];
    let cursor = 0;
    const concurrency = Math.min(3, uniqueIds.length);

    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < uniqueIds.length) {
        const current = uniqueIds[cursor];
        cursor += 1;
        try {
          await patchParentAssignmentService(current, familyRootId);
          successCount += 1;
        } catch {
          failures.push(current);
        }
      }
    });

    try {
      await Promise.all(workers);
      await refreshAll();
      if (failures.length > 0) {
        toast.push(`Assigned ${successCount}, failed ${failures.length}`);
      } else {
        toast.push(`Assigned ${successCount} variant(s)`);
      }
    } finally {
      setAssigningBulk(false);
    }
  }, [familyRootId, refreshAll, toast]);

  const handleDetachSibling = useCallback(async (targetId: string) => {
    setDetachingSiblingId(targetId);
    try {
      await patchParentAssignmentService(targetId, '');
      toast.push('Variant detached');
      await refreshAll();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Failed to detach variant');
    } finally {
      setDetachingSiblingId(null);
    }
  }, [refreshAll, toast]);

  const handleDeleteSibling = useCallback(async (targetId: string) => {
    if (!confirm('Delete this variant permanently?')) return;
    setDeletingSiblingId(targetId);
    try {
      await deleteImage(targetId);
      toast.push('Variant deleted');
      await refreshAll();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Failed to delete variant');
    } finally {
      setDeletingSiblingId(null);
    }
  }, [refreshAll, toast]);

  const metadataDirty = useMemo(() => {
    if (!video) return false;
    const normalize = (value?: string) => cleanString(value) || '';
    const currentTags = Array.isArray(video.tags) ? [...video.tags].map((tag) => tag.trim()).filter(Boolean).sort() : [];
    const formTags = normalizeTags(tagsInput).sort();
    if (currentTags.length !== formTags.length) return true;
    for (let i = 0; i < currentTags.length; i += 1) {
      if (currentTags[i] !== formTags[i]) return true;
    }
    return (
      normalize(video.folder) !== normalize(folderInput)
      || normalize(video.description) !== normalize(descriptionInput)
      || normalize(video.displayName || video.filename) !== normalize(displayNameInput)
      || normalize(video.originalUrl) !== normalize(originalUrlInput)
      || normalize(video.sourceUrl) !== normalize(sourceUrlInput)
      || normalize(video.namespace) !== normalize(namespaceInput)
    );
  }, [descriptionInput, displayNameInput, folderInput, namespaceInput, originalUrlInput, sourceUrlInput, tagsInput, video]);

  const handleDiscard = useCallback(() => {
    if (!video) return;
    setFolderInput(video.folder || '');
    setTagsInput(Array.isArray(video.tags) ? video.tags.join(', ') : '');
    setDescriptionInput(video.description || '');
    setDisplayNameInput(video.displayName || video.filename || '');
    setOriginalUrlInput(video.originalUrl || '');
    setSourceUrlInput(video.sourceUrl || '');
    setNamespaceInput(video.namespace || '');
  }, [video]);

  const handleSaveMetadata = useCallback(async () => {
    if (!video?.id) return;
    setMetadataSaving(true);
    try {
      const response = await fetch(`/api/videos/${video.id}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: cleanString(folderInput) || '',
          tags: normalizeTags(tagsInput),
          description: cleanString(descriptionInput) || '',
          displayName: cleanString(displayNameInput) || '',
          originalUrl: cleanString(originalUrlInput) || '',
          sourceUrl: cleanString(sourceUrlInput) || '',
          namespace: cleanString(namespaceInput) || '',
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to update video metadata');
      }
      toast.push('Metadata updated');
      await refreshAll();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : 'Failed to update video metadata');
    } finally {
      setMetadataSaving(false);
    }
  }, [descriptionInput, displayNameInput, folderInput, namespaceInput, originalUrlInput, refreshAll, sourceUrlInput, tagsInput, toast, video?.id]);

  const handleDeleteCurrent = useCallback(async () => {
    if (!video) return;
    if (!confirm('Delete this video permanently?')) return;
    setDeletingCurrent(true);
    try {
      await deleteImage(video.id);
      toast.push('Video deleted');
      window.location.href = backHref;
    } catch (err) {
      toast.push(err instanceof Error ? err.message : 'Failed to delete video');
    } finally {
      setDeletingCurrent(false);
    }
  }, [backHref, toast, video]);

  const handleDeleteFamily = useCallback(async () => {
    if (!familyRootId) return;
    const typed = window.prompt(
      'This will permanently delete this asset family and all variants in it.\n\nType DELETE FAMILY to confirm.'
    );
    if (typed !== 'DELETE FAMILY') return;

    try {
      setDeleteFamilyStatus(null);
      const jobId = await startDeleteFamilyJob(familyRootId);
      setDeleteFamilyJobId(jobId);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : 'Failed to start delete-family job');
    }
  }, [familyRootId, toast]);

  useEffect(() => {
    if (!deleteFamilyJobId) return;

    let cancelled = false;
    let interval: number | null = null;

    const poll = async () => {
      try {
        const status = await fetchDeleteFamilyStatus(deleteFamilyJobId);
        if (cancelled) return;
        setDeleteFamilyStatus(status);
        if (status.status !== 'running') {
          if (interval !== null) window.clearInterval(interval);
          interval = null;
          if (status.status === 'completed') {
            toast.push(`Deleted ${status.deleted} assets${status.failed ? `; ${status.failed} failed` : ''}`);
            window.location.href = '/';
          } else {
            toast.push(status.lastError || 'Delete family failed');
          }
        }
      } catch (err) {
        if (!cancelled) {
          toast.push(err instanceof Error ? err.message : 'Failed to fetch delete status');
        }
      }
    };

    void poll();
    interval = window.setInterval(poll, 500);

    return () => {
      cancelled = true;
      if (interval !== null) window.clearInterval(interval);
    };
  }, [deleteFamilyJobId, toast]);

  const generateAnimatedWebp = useCallback(async () => {
    if (!id) return;
    const hasInvalidRow = variationDrafts.some((draft) => {
      if (draft.maxWidth.trim() && toOptionalPositiveInt(draft.maxWidth) === undefined) return true;
      if (draft.maxOutputMb.trim() && toOptionalPositiveNumber(draft.maxOutputMb) === undefined) return true;
      if (draft.fps.trim() && toOptionalPositiveInt(draft.fps) === undefined) return true;
      return false;
    });
    if (hasInvalidRow) {
      setError('Animated WebP settings must be positive numbers for width, max size (MB), and FPS.');
      return;
    }

    const variations = variationDrafts.map((draft) => ({
      filename: draft.filename.trim() || undefined,
      maxWidth: toOptionalPositiveInt(draft.maxWidth),
      maxHeight: toOptionalPositiveInt(draft.maxWidth),
      maxOutputBytes: (() => {
        const mb = toOptionalPositiveNumber(draft.maxOutputMb);
        return typeof mb === 'number' ? Math.round(mb * 1024 * 1024) : undefined;
      })(),
      fps: toOptionalPositiveInt(draft.fps),
      loop: draft.loop,
    }));

    setGeneratingAnimatedWebp(true);
    setGenerationSummary(null);
    try {
      const response = await fetch(`/api/videos/${id}/animated-webp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variations }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to create animated WebP');
      }
      setGenerationSummary({
        createdCount: typeof payload?.createdCount === 'number' ? payload.createdCount : 0,
        failedCount: typeof payload?.failedCount === 'number' ? payload.failedCount : 0,
        partial: payload?.partial === true,
        variations: Array.isArray(payload?.variations) ? payload.variations : [],
        errors: Array.isArray(payload?.errors) ? payload.errors : [],
        hints: Array.isArray(payload?.hints) ? payload.hints.filter((hint: unknown) => typeof hint === 'string') : [],
      });
      await fetchVideo(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create animated WebP');
    } finally {
      setGeneratingAnimatedWebp(false);
    }
  }, [fetchVideo, id, variationDrafts]);

  const updateVariationDraft = useCallback((idToUpdate: string, patch: Partial<VariationDraft>) => {
    setVariationDrafts((prev) => prev.map((draft) => (draft.id === idToUpdate ? { ...draft, ...patch } : draft)));
  }, []);

  const addVariationDraft = useCallback(() => {
    setVariationDrafts((prev) => {
      const source = prev[prev.length - 1];
      return [...prev, createVariationDraft(source)];
    });
  }, []);

  const removeVariationDraft = useCallback((idToRemove: string) => {
    setVariationDrafts((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((draft) => draft.id !== idToRemove);
    });
  }, []);

  const applyPreset = useCallback((idToUpdate: string, preset: keyof typeof PRESET_MAP) => {
    const values = PRESET_MAP[preset];
    updateVariationDraft(idToUpdate, {
      maxWidth: values.maxWidth,
      maxOutputMb: values.maxOutputMb,
      fps: values.fps,
    });
  }, [updateVariationDraft]);

  const sortedAnimatedWebpVariants = useMemo(() => {
    const raw = video?.animatedWebpVariants;
    if (!Array.isArray(raw) || raw.length === 0) return [];
    return [...raw].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [video?.animatedWebpVariants]);

  const shareDetailUrl = buildVideoDetailShareUrl({
    videoId: video?.id,
    shareBaseUrl,
  });
  const shareDownloadUrl = buildVideoDownloadShareUrl({
    videoId: video?.id,
    shareBaseUrl,
  });

  const htmlEmbedSnippet = useMemo(() => {
    const sourceUrl = shareDownloadUrl || video?.hlsUrl || '';
    const posterUrl = video?.thumbnailUrl || video?.previewUrl || '';
    if (!sourceUrl) return '';
    const sourceType = sourceUrl.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4';
    const posterAttr = posterUrl ? ` poster=\"${posterUrl}\"` : '';
    return `<video controls preload=\"metadata\"${posterAttr}>\n  <source src=\"${sourceUrl}\" type=\"${sourceType}\">\n  Your browser does not support the video tag.\n</video>`;
  }, [shareDownloadUrl, video?.hlsUrl, video?.previewUrl, video?.thumbnailUrl]);

  const markdownEmbedSnippet = useMemo(() => {
    const posterUrl = video?.thumbnailUrl || video?.previewUrl || '';
    const targetUrl = shareDetailUrl || video?.playbackUrl || shareDownloadUrl || '';
    if (!targetUrl) return '';
    if (posterUrl) return `[![${video?.displayName || video?.filename || 'Video'}](${posterUrl})](${targetUrl})`;
    return `[${video?.displayName || video?.filename || 'Video'}](${targetUrl})`;
  }, [shareDetailUrl, shareDownloadUrl, video?.displayName, video?.filename, video?.playbackUrl, video?.previewUrl, video?.thumbnailUrl]);

  const iframeEmbedSnippet = useMemo(() => {
    if (!video?.playbackUrl) return '';
    return `<iframe src=\"${video.playbackUrl}\" allow=\"accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;\" allowfullscreen title=\"${video.displayName || video.filename}\"></iframe>`;
  }, [video?.displayName, video?.filename, video?.playbackUrl]);

  const downloadLinkReady = Boolean(shareDownloadUrl) && downloadProbe.status === 'ready';
  const downloadStatusLabel = (() => {
    if (downloadProbe.status === 'checking') return 'Checking download URL...';
    if (downloadProbe.status === 'preparing') return downloadProbe.message || 'Download is preparing in Cloudflare Stream.';
    if (downloadProbe.status === 'unavailable') return downloadProbe.message || 'Download URL unavailable.';
    if (downloadProbe.status === 'error') return downloadProbe.message || 'Download status check failed.';
    if (downloadProbe.status === 'ready') return 'Download URL is ready.';
    return '';
  })();

  const refreshMuxStatus = useCallback(async () => {
    if (!video?.id) return;
    setMuxSyncing(true);
    try {
      const response = await fetch(`/api/videos/${video.id}/mux`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to refresh Mux status');
      }
      setVideo((prev) => prev ? { ...prev, mux: payload?.mux || undefined } : prev);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Failed to refresh Mux status');
    } finally {
      setMuxSyncing(false);
    }
  }, [toast, video?.id]);

  const startMuxExport = useCallback(async (force = false) => {
    if (!video?.id) return;
    setMuxActionLoading(true);
    try {
      const response = await fetch(`/api/videos/${video.id}/mux`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to start Mux export');
      }
      setVideo((prev) => prev ? { ...prev, mux: payload?.mux || undefined } : prev);
      toast.push(force ? 'Mux export retried' : 'Mux export started');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Failed to start Mux export');
    } finally {
      setMuxActionLoading(false);
    }
  }, [toast, video?.id]);

  useEffect(() => {
    if (!video?.id) return;
    const status = video.mux?.status;
    if (status !== 'queued' && status !== 'ingesting') return;
    let cancelled = false;
    const interval = window.setInterval(() => {
      if (cancelled) return;
      void refreshMuxStatus();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refreshMuxStatus, video?.id, video?.mux?.status]);

  useEffect(() => {
    if (!video?.id) {
      setDownloadProbe({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setDownloadProbe({ status: 'checking' });

    fetch(`/api/videos/${video.id}/download?probe=1`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.ok) {
          setDownloadProbe({ status: 'ready' });
          return;
        }
        if (response.status === 409) {
          setDownloadProbe({
            status: 'preparing',
            message: typeof payload?.error === 'string' ? payload.error : 'Video download is still being prepared.',
          });
          return;
        }
        if (response.status === 404) {
          setDownloadProbe({
            status: 'unavailable',
            message: typeof payload?.error === 'string' ? payload.error : 'No downloadable video URL is currently available.',
          });
          return;
        }
        setDownloadProbe({
          status: 'error',
          message: typeof payload?.error === 'string' ? payload.error : 'Failed to check download availability.',
        });
      })
      .catch(() => {
        if (cancelled) return;
        setDownloadProbe({
          status: 'error',
          message: 'Failed to check download availability.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [refreshing, video?.id]);

  useEffect(() => {
    if (!shareDownloadUrl) {
      setShareQrDataUrl('');
      return;
    }
    let cancelled = false;
    generateQrDataUrl(shareDownloadUrl)
      .then((dataUrl) => {
        if (!cancelled) {
          setShareQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShareQrDataUrl('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shareDownloadUrl]);

  useEffect(() => {
    setFrameMeta(null);
    setFrameMetaError(null);
    setFrameSelectorInput('first,middle,last');
    setFrameJumpInput('1');
    setFramePreviewError(null);
    setActiveFramePreview(null);
  }, [video?.id]);

  useEffect(() => {
    const objectUrl = activeFramePreview?.objectUrl;
    return () => {
      if (objectUrl?.startsWith('blob:')) {
        window.URL.revokeObjectURL(objectUrl);
      }
    };
  }, [activeFramePreview?.objectUrl]);

  const loadExactFramePreview = useCallback(async (frameNumber: number) => {
    if (!video?.id) return;
    if (!Number.isInteger(frameNumber) || frameNumber < 1) {
      setFramePreviewError('Frame number must be a positive integer.');
      return;
    }
    if (frameMeta && frameNumber > frameMeta.frameCount) {
      setFramePreviewError(`Frame ${frameNumber} is out of range. Max frame is ${frameMeta.frameCount}.`);
      return;
    }

    setFramePreviewLoading(true);
    setFramePreviewError(null);
    try {
      const response = await fetch(`/api/videos/${video.id}/frames/preview?frame=${frameNumber}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to load frame preview');
      }
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const timeSeconds = frameMeta ? (frameNumber - 1) / frameMeta.fps : 0;
      setActiveFramePreview({ frameNumber, timeSeconds, objectUrl });
      setFrameJumpInput(String(frameNumber));
    } catch (err) {
      setFramePreviewError(err instanceof Error ? err.message : 'Failed to load frame preview');
    } finally {
      setFramePreviewLoading(false);
    }
  }, [frameMeta, video?.id]);

  useEffect(() => {
    if (!video?.id) return;
    if (video.videoStatus !== 'ready') {
      setFrameMeta(null);
      setFrameMetaError(null);
      return;
    }

    let cancelled = false;
    setFrameMetaLoading(true);
    setFrameMetaError(null);

    fetch(`/api/videos/${video.id}/frames/meta`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to load frame metadata');
        }
        const meta = payload as FrameMeta;
        setFrameMeta(meta);
        setFrameSelectorInput((prev) => prev.trim() || meta.defaultSelector || 'first,middle,last');
        const initialFrame = meta.currentFrame?.frameNumber || meta.previews[0]?.frameNumber || 1;
        setFrameJumpInput(String(initialFrame));
      })
      .catch((err) => {
        if (!cancelled) {
          setFrameMetaError(err instanceof Error ? err.message : 'Failed to load frame metadata');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFrameMetaLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [video?.id, video?.videoStatus]);

  useEffect(() => {
    if (!frameMeta || activeFramePreview || framePreviewLoading) return;
    const initialFrame = frameMeta.currentFrame?.frameNumber || frameMeta.previews[0]?.frameNumber || 1;
    void loadExactFramePreview(initialFrame);
  }, [activeFramePreview, frameMeta, framePreviewLoading, loadExactFramePreview]);

  const handleJumpToFrame = useCallback(async () => {
    const parsed = Number(frameJumpInput.trim());
    if (!Number.isInteger(parsed) || parsed < 1) {
      setFramePreviewError('Frame number must be a positive integer.');
      return;
    }
    await loadExactFramePreview(parsed);
  }, [frameJumpInput, loadExactFramePreview]);

  const handleExtractFrames = useCallback(async () => {
    if (!video?.id) return;
    const selector = frameSelectorInput.trim();
    if (!selector) {
      setFramePreviewError('Enter a frame selector before downloading.');
      return;
    }

    setExtractingFrames(true);
    setFramePreviewError(null);
    try {
      const response = await fetch(`/api/videos/${video.id}/frames/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selector }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to extract frames');
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const filenameMatch = disposition.match(/filename="([^"]+)"/i);
      const fallbackName = selector.includes(',')
        ? `${(video.filename || 'video').replace(/\.[^.]+$/, '') || 'video'}-frames.zip`
        : `${(video.filename || 'video').replace(/\.[^.]+$/, '') || 'video'}-frame.jpg`;
      const filename = filenameMatch?.[1] || fallbackName;
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
      toast.push(`Downloaded frame selection: ${selector}`);
    } catch (err) {
      setFramePreviewError(err instanceof Error ? err.message : 'Failed to extract frames');
    } finally {
      setExtractingFrames(false);
    }
  }, [frameSelectorInput, toast, video?.filename, video?.id]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-5xl text-sm font-mono text-gray-600">Loading video...</div>
      </main>
    );
  }

  if (!video || error) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-5xl space-y-4">
          <Link href={backHref} className="text-sm font-mono text-blue-700 underline">Back to gallery</Link>
          <p className="text-sm font-mono text-red-700">{error || 'Video not found'}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <Link href={backHref} className="text-sm font-mono text-blue-700 underline">Back to gallery</Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchVideo(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <label className="flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-mono text-gray-700">
              <input
                type="checkbox"
                checked={autoRefreshStream}
                onChange={(event) => setAutoRefreshStream(event.target.checked)}
              />
              Auto-refresh
            </label>
          </div>
        </div>

        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <AssetTypeBadge assetType="video" />
            <h1 className="text-lg font-semibold text-gray-900">{video.displayName || video.filename}</h1>
          </div>
          <p className="text-xs font-mono text-gray-600">
            status={video.videoStatus} • duration={formatDuration(video.durationSeconds)} • dims={video.width && video.height ? `${video.width}x${video.height}` : '--'}
          </p>
          {video.streamError && (
            <p className="text-xs font-mono text-amber-700">stream_error={video.streamError}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <button
              onClick={() => void handleCopyText(video.id, 'Video ID')}
              className="rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50"
            >
              Copy ID
            </button>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Metadata</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDiscard}
                disabled={!metadataDirty || metadataSaving}
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
              >
                Discard
              </button>
              <button
                onClick={() => void handleSaveMetadata()}
                disabled={!metadataDirty || metadataSaving}
                className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-50"
              >
                {metadataSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs text-gray-700">
              Display name
              <input
                value={displayNameInput}
                onChange={(event) => setDisplayNameInput(event.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-2 text-xs"
              />
            </label>
            <label className="space-y-1 text-xs text-gray-700">
              Namespace
              <MonoSelect
                value={namespaceInput}
                onChange={setNamespaceInput}
                options={namespaceSelectOptions}
                className="w-full"
                placeholder="[none]"
              />
            </label>
            <label className="space-y-1 text-xs text-gray-700">
              Folder
              <MonoSelect
                value={folderInput}
                onChange={setFolderInput}
                options={folderOptions}
                className="w-full"
                placeholder="[none]"
              />
            </label>
            <label className="space-y-1 text-xs text-gray-700">
              Tags (comma-separated)
              <input
                value={tagsInput}
                onChange={(event) => setTagsInput(event.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-2 text-xs"
              />
            </label>
          </div>

          <label className="space-y-1 text-xs text-gray-700 block">
            Description
            <textarea
              value={descriptionInput}
              onChange={(event) => setDescriptionInput(event.target.value)}
              rows={3}
              className="w-full rounded border border-gray-300 px-2 py-2 text-xs"
            />
          </label>

          <label className="space-y-1 text-xs text-gray-700 block">
            Original URL
            <input
              value={originalUrlInput}
              onChange={(event) => setOriginalUrlInput(event.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-2 text-xs"
            />
          </label>

          <label className="space-y-1 text-xs text-gray-700 block">
            Source URL
            <input
              value={sourceUrlInput}
              onChange={(event) => setSourceUrlInput(event.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-2 text-xs"
            />
          </label>
        </section>

        {familyRootId && (
          <div className="space-y-3">
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-medium text-gray-700">Family Variants</p>
                <input
                  type="text"
                  value={siblingSearch}
                  onChange={(event) => setSiblingSearch(event.target.value)}
                  placeholder="Search siblings by ID, name, folder, tags..."
                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs sm:w-80"
                />
              </div>
              {filteredParentFamilyAssets.length > SIBLING_PAGE_SIZE && (
                <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
                  <span>Page {siblingPage} of {totalSiblingPages}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSiblingPage((prev) => Math.max(1, prev - 1))}
                      disabled={siblingPage === 1}
                      className="rounded border border-gray-300 px-2 py-1 disabled:opacity-50"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setSiblingPage((prev) => Math.min(totalSiblingPages, prev + 1))}
                      disabled={siblingPage === totalSiblingPages}
                      className="rounded border border-gray-300 px-2 py-1 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
            <AssetFamilyList
              title="Sibling Variants"
              assets={pagedParentFamilyAssets}
              detachingId={detachingSiblingId}
              deletingId={deletingSiblingId}
              onDetach={handleDetachSibling}
              onDelete={handleDeleteSibling}
              onCopyId={(targetId) => handleCopyText(targetId, 'Asset ID')}
              onCopyUrl={(_, url) => handleCopyText(url, 'Asset')}
            />
          </div>
        )}

        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Add Variants</h2>
          <div className="space-y-4">
            <p className="text-xs text-gray-600">
              {isCanonicalVideo ? (
                <>Adding variants directly to this video <span className="font-mono">{video.id}</span></>
              ) : (
                <>Adding variants to parent family <span className="font-mono">{video.parentId}</span></>
              )}
            </p>

            <AdoptVariationSection
              adoptSearch={adoptSearch}
              setAdoptSearch={setAdoptSearch}
              adoptFolderFilter={adoptFolderFilter}
              setAdoptFolderFilter={setAdoptFolderFilter}
              adoptFolderOptions={adoptFolderOptions}
              adoptAssetTypeFilter={adoptAssetTypeFilter}
              setAdoptAssetTypeFilter={setAdoptAssetTypeFilter}
              adoptAssetTypeOptions={adoptAssetTypeOptions}
              filteredAdoptableImages={filteredAdoptableImages}
              pagedAdoptableImages={pagedAdoptableImages}
              adoptPage={adoptPage}
              setAdoptPage={setAdoptPage}
              totalAdoptPages={totalAdoptPages}
              adoptPageSize={ADOPT_PAGE_SIZE}
              onHandleThumbMouseMove={handleThumbMouseMove}
              onHandleThumbLeave={handleThumbLeave}
              onHandleImageDragStart={handleAssetDragStart}
              onAssignExistingAsChild={handleAssignExistingAsChild}
              onAssignExistingAsChildren={handleAssignExistingAsChildren}
              assigningId={assigningId}
              assigningBulk={assigningBulk}
            />

            <UploadVariationSection
              getVariantDropzoneProps={getVariantDropzoneProps}
              getVariantInputProps={getVariantInputProps}
              isVariantDragActive={isVariantDragActive}
              childUploadFolder={childUploadFolder}
              childUploadTags={childUploadTags}
              fallbackFolder={familyRootAsset?.folder || ''}
              fallbackTags={familyRootAsset?.tags || []}
              childUploadFiles={childUploadFiles}
              onClearSelectedFiles={() => setChildUploadFiles([])}
              onUpload={handleChildUpload}
              childUploadLoading={childUploadLoading}
              childUploadUrl={childUploadUrl}
              onChildUploadUrlChange={setChildUploadUrl}
              onUploadUrl={handleChildUploadByUrl}
              childUploadUrlLoading={childUploadUrlLoading}
              childImportUrl={childImportUrl}
              childImportLoading={childImportLoading}
              childImportError={childImportError}
              onChildImportUrlChange={setChildImportUrl}
              onImportFromUrl={handleImportFromUrl}
            />
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Share + Copy</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1 space-y-3">
              <label className="block space-y-1 text-xs text-gray-700">
                Share base URL
                <input
                  value={shareBaseUrl}
                  onChange={(event) => setShareBaseUrl(event.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-2 text-xs"
                  placeholder="http://192.168.x.x:3000"
                />
              </label>
              <p className="text-[10px] text-gray-500">QR points to a direct download endpoint for this video.</p>
              {downloadStatusLabel && (
                <p
                  className={`text-[11px] font-mono ${
                    downloadProbe.status === 'ready'
                      ? 'text-emerald-700'
                      : downloadProbe.status === 'checking'
                        ? 'text-gray-600'
                        : 'text-amber-700'
                  }`}
                >
                  {downloadStatusLabel}
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                <a
                  href={downloadLinkReady ? shareDownloadUrl : undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={`rounded border border-gray-300 px-2 py-1 text-left hover:bg-gray-50 ${!downloadLinkReady ? 'pointer-events-none opacity-40' : ''}`}
                >
                  Open download link
                </a>
                <a
                  href={shareDetailUrl || undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={`rounded border border-gray-300 px-2 py-1 text-left hover:bg-gray-50 ${!shareDetailUrl ? 'pointer-events-none opacity-40' : ''}`}
                >
                  Open detail link
                </a>
                <button onClick={() => void handleCopyText(downloadLinkReady ? shareDownloadUrl : '', 'Download')} className="rounded border border-gray-300 px-2 py-1 text-left hover:bg-gray-50">Copy download link</button>
                <button onClick={() => void handleCopyText(shareDetailUrl, 'Detail')} className="rounded border border-gray-300 px-2 py-1 text-left hover:bg-gray-50">Copy detail link</button>
                <button onClick={() => void handleCopyText(video.playbackUrl || '', 'Playback')} className="rounded border border-gray-300 px-2 py-1 text-left hover:bg-gray-50">Copy playback URL</button>
                <button onClick={() => void handleCopyText(video.hlsUrl || '', 'HLS')} className="rounded border border-gray-300 px-2 py-1 text-left hover:bg-gray-50">Copy HLS URL</button>
                <button onClick={() => void handleCopyText(video.thumbnailUrl || '', 'Thumbnail')} className="rounded border border-gray-300 px-2 py-1 text-left hover:bg-gray-50">Copy thumbnail URL</button>
                <button onClick={() => void handleCopyText(video.previewUrl || '', 'Preview')} className="rounded border border-gray-300 px-2 py-1 text-left hover:bg-gray-50">Copy preview URL</button>
                <button onClick={() => void handleCopyText(htmlEmbedSnippet, 'HTML Embed')} className="rounded border border-gray-300 px-2 py-1 text-left hover:bg-gray-50">Copy HTML embed</button>
                <button onClick={() => void handleCopyText(markdownEmbedSnippet, 'Markdown Embed')} className="rounded border border-gray-300 px-2 py-1 text-left hover:bg-gray-50">Copy Markdown embed</button>
                <button onClick={() => void handleCopyText(iframeEmbedSnippet, 'iFrame Embed')} className="rounded border border-gray-300 px-2 py-1 text-left hover:bg-gray-50">Copy iframe embed</button>
              </div>
              <div className="space-y-2">
                <label className="block space-y-1 text-[11px] text-gray-700">
                  HTML video embed
                  <textarea
                    value={htmlEmbedSnippet}
                    readOnly
                    rows={4}
                    className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-2 font-mono text-[11px]"
                  />
                </label>
                <label className="block space-y-1 text-[11px] text-gray-700">
                  Markdown embed helper
                  <textarea
                    value={markdownEmbedSnippet}
                    readOnly
                    rows={2}
                    className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-2 font-mono text-[11px]"
                  />
                </label>
                <label className="block space-y-1 text-[11px] text-gray-700">
                  iFrame embed
                  <textarea
                    value={iframeEmbedSnippet}
                    readOnly
                    rows={2}
                    className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-2 font-mono text-[11px]"
                  />
                </label>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-center">
              {shareQrDataUrl ? (
                <Image
                  src={shareQrDataUrl}
                  alt="Video share QR code"
                  width={140}
                  height={140}
                  unoptimized
                  className="rounded-md border border-gray-200 bg-white"
                />
              ) : (
                <div className="flex h-[140px] w-[140px] items-center justify-center rounded-md border border-dashed border-gray-200 text-[10px] text-gray-400">
                  QR unavailable
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Mux Export</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void refreshMuxStatus()}
                disabled={muxSyncing || muxActionLoading}
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {muxSyncing ? 'Refreshing…' : 'Refresh status'}
              </button>
              <button
                onClick={() => void startMuxExport(false)}
                disabled={muxActionLoading || muxSyncing}
                className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-800 hover:bg-blue-100 disabled:opacity-50"
              >
                {muxActionLoading
                  ? 'Starting…'
                  : video.mux?.assetId
                    ? (video.mux.status === 'error' ? 'Retry export' : 'Sync existing export')
                    : 'Start export'}
              </button>
              {video.mux?.assetId && (
                <button
                  onClick={() => void startMuxExport(true)}
                  disabled={muxActionLoading || muxSyncing}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Force re-export
                </button>
              )}
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-gray-50 p-2 text-xs font-mono text-gray-700">
            <p>status={video.mux?.status || 'not-exported'}</p>
            <p>asset_id={video.mux?.assetId || '--'}</p>
            <p>playback_id={video.mux?.playbackId || '--'}</p>
            <p>playback_url={video.mux?.playbackUrl || '--'}</p>
            <p>ingest_url={video.mux?.ingestUrl || '--'}</p>
            <p>exported_at={video.mux?.exportedAt || '--'}</p>
            <p>synced_at={video.mux?.syncedAt || '--'}</p>
            {video.mux?.error && <p className="text-red-700">error={video.mux.error}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void handleCopyText(video.mux?.playbackUrl || '', 'Mux playback URL')}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              Copy Mux playback URL
            </button>
            <button
              onClick={() => void handleCopyText(video.mux?.assetId || '', 'Mux asset ID')}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              Copy Mux asset ID
            </button>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Deletion</h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void handleDeleteCurrent()}
              disabled={deletingCurrent}
              className="rounded border border-red-300 px-3 py-1 text-xs text-red-700 disabled:opacity-50"
            >
              {deletingCurrent ? 'Deleting…' : 'Delete video'}
            </button>
            <button
              onClick={() => void handleDeleteFamily()}
              disabled={!video.parentId || Boolean(deleteFamilyJobId && !deleteFamilyStatus?.finishedAt)}
              className="rounded border border-red-500 bg-red-50 px-3 py-1 text-xs text-red-800 disabled:opacity-50"
            >
              Delete parent family
            </button>
          </div>
          {deleteFamilyStatus && (
            <div className="rounded border border-gray-200 bg-gray-50 p-2 text-xs font-mono text-gray-700">
              <p>status={deleteFamilyStatus.status} attempted={deleteFamilyStatus.attempted}/{deleteFamilyStatus.total}</p>
              <p>deleted={deleteFamilyStatus.deleted} failed={deleteFamilyStatus.failed}</p>
              {deleteFamilyStatus.lastError && <p className="text-red-700">error={deleteFamilyStatus.lastError}</p>}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Animated WebP Variations</h2>
            <button
              type="button"
              onClick={() => addVariationDraft()}
              className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-mono text-gray-700 hover:bg-gray-100"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Variation
            </button>
          </div>
          <p className="text-xs font-mono text-gray-600">
            Each row creates one animated WebP output from this video. Start with the balanced values, then lower width/FPS if size is too large.
          </p>
          {video.videoStatus !== 'ready' && (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs font-mono text-amber-800">
              Video must be ready before conversion. Click Refresh until status is ready.
            </p>
          )}

          <div className="space-y-2">
            {variationDrafts.map((draft, index) => (
              <div key={draft.id} className="space-y-2 rounded border border-gray-200 bg-gray-50 p-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-mono font-semibold text-gray-700">Variation {index + 1}</p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => applyPreset(draft.id, 'preview')}
                      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-mono text-gray-700 hover:bg-gray-100"
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset(draft.id, 'balanced')}
                      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-mono text-gray-700 hover:bg-gray-100"
                    >
                      Balanced
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset(draft.id, 'quality')}
                      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-mono text-gray-700 hover:bg-gray-100"
                    >
                      Quality
                    </button>
                    <button
                      type="button"
                      onClick={() => removeVariationDraft(draft.id)}
                      disabled={variationDrafts.length <= 1}
                      className="inline-flex items-center justify-center rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-12">
                  <label className="flex flex-col gap-1 text-[11px] font-mono text-gray-700 md:col-span-4">
                    Output Filename (optional)
                    <input
                      type="text"
                      value={draft.filename}
                      onChange={(event) => updateVariationDraft(draft.id, { filename: event.target.value })}
                      placeholder={`video-${index + 1}.webp`}
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-800"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] font-mono text-gray-700 md:col-span-2">
                    Max Width (px)
                    <input
                      type="text"
                      value={draft.maxWidth}
                      onChange={(event) => updateVariationDraft(draft.id, { maxWidth: event.target.value })}
                      placeholder="960"
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-800"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] font-mono text-gray-700 md:col-span-2">
                    Max Size (MB)
                    <input
                      type="text"
                      value={draft.maxOutputMb}
                      onChange={(event) => updateVariationDraft(draft.id, { maxOutputMb: event.target.value })}
                      placeholder="6"
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-800"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] font-mono text-gray-700 md:col-span-2">
                    FPS
                    <input
                      type="text"
                      value={draft.fps}
                      onChange={(event) => updateVariationDraft(draft.id, { fps: event.target.value })}
                      placeholder="12"
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-800"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs font-mono text-gray-700 md:col-span-2">
                    <input
                      type="checkbox"
                      checked={draft.loop}
                      onChange={(event) => updateVariationDraft(draft.id, { loop: event.target.checked })}
                    />
                    Loop
                  </label>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void generateAnimatedWebp()}
            disabled={generatingAnimatedWebp || video.videoStatus !== 'ready'}
            className="inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-60"
          >
            <WandSparkles className="h-3.5 w-3.5" />
            {generatingAnimatedWebp
              ? `Generating ${variationDrafts.length} Variation${variationDrafts.length === 1 ? '' : 's'}...`
              : `Generate ${variationDrafts.length} Variation${variationDrafts.length === 1 ? '' : 's'}`}
          </button>

          {generationSummary && (
            <div className="space-y-1 rounded border border-gray-200 bg-gray-50 p-2 text-xs font-mono text-gray-700">
              <p>
                generated={generationSummary.createdCount} failed={generationSummary.failedCount} partial={generationSummary.partial ? 'yes' : 'no'}
              </p>
              {generationSummary.variations.map((entry) => (
                <p key={entry.imageId}>
                  created={entry.filename} id={entry.imageId} size={formatBytes(entry.bytes)} fps={entry.fps} loop={entry.loop ? 'yes' : 'no'} encoder={entry.encoder || '--'}{' '}
                  <Link href={`/images/${entry.imageId}`} className="text-blue-700 underline">open</Link>
                </p>
              ))}
              {generationSummary.errors.map((entry) => (
                <p key={`${entry.index}-${entry.filename}`} className="text-red-700">
                  failed={entry.filename} reason={entry.error}
                </p>
              ))}
              {generationSummary.hints.map((hint) => (
                <p key={hint} className="text-amber-800">hint={hint}</p>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Frame Extraction</h2>
            {frameMeta && (
              <p className="text-xs font-mono text-gray-600">
                frames={frameMeta.frameCount} fps={frameMeta.fps.toFixed(2)} exact={frameMeta.exactFrameCount ? 'yes' : 'estimated'}
              </p>
            )}
          </div>

          {video.videoStatus !== 'ready' ? (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs font-mono text-amber-800">
              Video must be ready before frame extraction is available.
            </p>
          ) : frameMetaLoading ? (
            <p className="text-xs font-mono text-gray-600">Loading frame metadata...</p>
          ) : frameMetaError ? (
            <p className="rounded border border-red-200 bg-red-50 p-2 text-xs font-mono text-red-700">
              {frameMetaError}
            </p>
          ) : frameMeta ? (
            <>
              <p className="text-xs font-mono text-gray-600">
                Use symbolic selectors like <span className="font-semibold">first,middle,last</span> or exact frame numbers like <span className="font-semibold">1,100</span>.
                {typeof frameMeta.limits?.maxExtractFrameCount === 'number' && ` Max per request: ${frameMeta.limits.maxExtractFrameCount}.`}
              </p>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-3">
                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_120px_auto]">
                    <label className="flex flex-col gap-1 text-[11px] font-mono text-gray-700">
                      Selector
                      <input
                        type="text"
                        value={frameSelectorInput}
                        onChange={(event) => setFrameSelectorInput(event.target.value)}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-800"
                        placeholder={frameMeta.defaultSelector || 'first,middle,last'}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-mono text-gray-700">
                      Jump To Frame
                      <input
                        type="text"
                        value={frameJumpInput}
                        onChange={(event) => setFrameJumpInput(event.target.value)}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-800"
                        placeholder="1"
                      />
                    </label>
                    <div className="flex items-end gap-2">
                      <button
                        type="button"
                        onClick={() => void handleJumpToFrame()}
                        disabled={framePreviewLoading}
                        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                      >
                        {framePreviewLoading ? 'Loading...' : 'Load Frame'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleExtractFrames()}
                        disabled={extractingFrames}
                        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                      >
                        {extractingFrames ? 'Downloading...' : 'Download Frames'}
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {frameMeta.previews.map((preview) => (
                      <button
                        key={preview.frameNumber}
                        type="button"
                        onClick={() => void loadExactFramePreview(preview.frameNumber)}
                        className={`overflow-hidden rounded border text-left ${
                          activeFramePreview?.frameNumber === preview.frameNumber
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                        }`}
                      >
                        <Image
                          src={preview.previewUrl}
                          alt={`Frame ${preview.frameNumber}`}
                          width={640}
                          height={360}
                          className="aspect-video w-full bg-black object-cover"
                          unoptimized
                        />
                        <div className="space-y-0.5 px-2 py-1.5 text-[11px] font-mono text-gray-700">
                          <p>frame={preview.frameNumber}</p>
                          <p>time={formatFrameTime(preview.timeSeconds)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs font-semibold text-gray-900">Exact Frame Preview</p>
                  {activeFramePreview ? (
                    <>
                      <Image
                        src={activeFramePreview.objectUrl}
                        alt={`Selected frame ${activeFramePreview.frameNumber}`}
                        width={1280}
                        height={720}
                        className="aspect-video w-full rounded bg-black object-contain"
                        unoptimized
                      />
                      <div className="space-y-1 text-[11px] font-mono text-gray-700">
                        <p>frame={activeFramePreview.frameNumber}</p>
                        <p>time={formatFrameTime(activeFramePreview.timeSeconds)}</p>
                      </div>
                    </>
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded bg-white text-xs font-mono text-gray-500">
                      No frame selected
                    </div>
                  )}
                  {framePreviewError && (
                    <p className="rounded border border-red-200 bg-red-50 p-2 text-[11px] font-mono text-red-700">
                      {framePreviewError}
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs font-mono text-gray-600">Frame metadata unavailable.</p>
          )}
        </section>

        {sortedAnimatedWebpVariants.length > 0 && (
          <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Generated WebPs</h2>
              <p className="text-xs font-mono text-gray-600">count={sortedAnimatedWebpVariants.length}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {sortedAnimatedWebpVariants.map((variant) => (
                <Link
                  key={variant.imageId}
                  href={`/images/${variant.imageId}`}
                  className="group rounded border border-gray-200 bg-white p-2 hover:border-gray-300"
                  title="Open image detail"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded bg-gray-100">
                    <img
                      src={variant.url}
                      alt={variant.filename}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                    />
                  </div>
                  <div className="mt-2 space-y-1">
                    <p className="truncate text-xs font-mono text-gray-900" title={variant.filename}>
                      {variant.filename}
                    </p>
                    <p className="text-[11px] font-mono text-gray-600">
                      {formatBytes(variant.bytes)} • {variant.fps}fps • {variant.loop ? 'loop' : 'no-loop'}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-lg border border-gray-200 bg-black p-3">
          {video.videoStatus === 'ready' && video.playbackUrl ? (
            <iframe
              src={video.playbackUrl}
              className="h-[60vh] w-full rounded"
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
              allowFullScreen
              title={video.displayName || video.filename}
            />
          ) : (
            <div className="flex h-[40vh] flex-col items-center justify-center gap-2 rounded text-center font-mono text-gray-300">
              <p className="text-sm">
                {video.videoStatus === 'pending'
                  ? 'Video is still processing in Cloudflare Stream.'
                  : video.videoStatus === 'error'
                    ? 'Video processing failed.'
                    : 'Playback URL unavailable'}
              </p>
              <p className="text-xs text-gray-400">
                status={video.videoStatus}
                {video.streamError ? ` • ${video.streamError}` : ''}
              </p>
            </div>
          )}
        </section>
      </div>

      {hoverPreview && (
        <div
          className="fixed z-50 pointer-events-none border border-black/10 shadow-lg rounded-lg overflow-hidden bg-white"
          style={{ top: hoverPreview.y, left: hoverPreview.x, width: 340, height: 240 }}
        >
          <Image
            src={hoverPreview.url}
            alt={hoverPreview.label}
            fill
            className="object-contain"
            unoptimized
          />
        </div>
      )}
    </main>
  );
}
