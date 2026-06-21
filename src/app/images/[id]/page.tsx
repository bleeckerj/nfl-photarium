"use client";

import React, { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMultipleImageUrls, getCloudflareImageUrl, getCloudflareDownloadUrl, IMAGE_VARIANTS } from '@/utils/imageUtils';
import {
  getAssetCopyUrl,
  getAssetPreviewUrl,
  isVideoAsset,
} from '@/utils/assetUrls';
import { useToast } from '@/components/Toast';
import { subscribeEmbeddingPending, clearPendingIfHasEmbeddings, type EmbeddingPendingEntry } from '@/utils/embeddingPending';
import {
  cleanString,
  CLOUDFLARE_EXTRAS_ONLY_FIELDS,
  enforceCloudflareMetadataLimit,
  omitExtrasOnlyCloudflareMetadata,
  pickCloudflareMetadata,
} from '@/utils/cloudflareMetadata';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import { useDropzone } from 'react-dropzone';
import { formatBytes } from '@/utils/formatBytes';
import { normalizeColorSearchHex } from '@/components/gallery/colorSearch';
import { useImageAspectRatio } from '@/hooks/useImageAspectRatio';
import { buildCanonicalGalleryHref, GALLERY_NAMESPACE_STORAGE_KEY, resetGalleryPreferencesForFocus } from '@/components/gallery/focusNavigation';
import { ImageDetailMetadataPanel } from '@/components/image-detail/ImageDetailMetadataPanel';
import type { ComfyWorkflowRecord } from '@/components/image-detail/comfy';
import {
  IMAGE_DETAIL_DRAFT_KEY_PREFIX,
  LEGACY_IMAGE_DETAIL_DRAFT_KEY_PREFIX,
  shouldRestoreImageDetailDraft,
  type ImageDetailDraft,
} from '@/components/image-detail/detailDraft';
import { VariationsSection } from '@/components/image-detail/VariationsSection';
import { AdoptVariationSection } from '@/components/image-detail/AdoptVariationSection';
import { buildAdoptVariationCandidatePage, getDefaultAdoptVariationScope } from '@/components/image-detail/adoptVariationSearch';
import { UploadVariationSection } from '@/components/image-detail/UploadVariationSection';
import { ImageToolsPanel } from '@/components/image-detail/image-tools/ImageToolsPanel';
import { VARIATION_UPLOAD_ACCEPT } from '@/components/image-detail/variationUploadConfig';
import { VariantLockedState } from '@/components/image-detail/ParentInfoSection';
import { AnimationRepairSection } from '@/components/image-detail/AnimationRepairSection';
import { AspectRatioDisplay } from '@/components/image-detail/AspectRatioDisplay';
import { HoverPreviewOverlay, type HoverPreviewState } from '@/components/image-detail/HoverPreviewOverlay';
import { ImageDetailFooterActions } from '@/components/image-detail/ImageDetailFooterActions';
import { ImageDetailNavigation } from '@/components/image-detail/ImageDetailNavigation';
import { ImageHeroSection } from '@/components/image-detail/ImageHeroSection';
import { ImageSummarySection } from '@/components/image-detail/ImageSummarySection';
import { VariantSizeModal } from '@/components/image-detail/VariantSizeModal';
import { CropVariantModal } from '@/components/image-detail/CropVariantModal';
import type { CloudflareImage } from '@/components/image-detail/types';
import { useDetailNavigationGuard } from '@/components/image-detail/useDetailNavigationGuard';
import { usePromptThisEditor } from '@/components/image-detail/usePromptThisEditor';
import { parseUserTagsInput, type ImageMetadataSaveResponse } from '@/components/image-detail/imageMetadataDraft';
import {
  ensureWebpFormat,
  extractAssignmentCandidateAssets,
  formatEntriesAsYaml,
  formatFailureNames,
  getVariantWidthLabel,
  isAnimatedWebpAsset,
  isMetadataLimitError,
  mergeFamilyContextImages,
  mergeUniqueTags,
  sortFamilyMembers,
  toCloudflareTextMirror,
} from '@/components/image-detail/detailTransforms';

import { useParentReassignment } from '@/hooks/useParentReassignment';
import { useVariationUpload } from '@/hooks/useVariationUpload';
import { useParentAssignment } from '@/hooks/useParentAssignment';
import { useBulkVariationMetadata } from '@/hooks/useBulkVariationMetadata';
import { useAltDescriptionGeneration } from '@/hooks/useAltDescriptionGeneration';
import { useDeleteImageFamily } from '@/hooks/useDeleteImageFamily';
import { useShareLinks } from '@/hooks/useShareLinks';
import { useImageMetadataDraft } from '@/hooks/useImageMetadataDraft';
import { patchParentAssignment as patchParentAssignmentService } from '@/services/parentAssignmentService';
import { usePersistentShareBaseUrl } from '@/hooks/usePersistentShareBaseUrl';
import { requestSemanticTags } from '@/services/imageAltDescriptionService';
import { fetchDetailImageResponse } from '@/services/detailImageService';
import { deleteImage as requestDeleteImage } from '@/services/imageDeletionService';
import { patchImageFavorite, patchImageMetadata } from '@/services/imageMetadataService';
import {
  getUserVisibleTags,
  hasFavoriteTag,
  mergeUserTagsPreservingSystemTags,
} from '@/utils/systemTags';
import {
  clearGalleryReturnSnapshot,
  clearGalleryReturnState,
  getFreshDetailAssetSeed,
  getFreshGalleryReturnState,
  hasFreshGalleryReturnState,
} from '@/components/gallery/returnState';

import { useParams, useRouter, useSearchParams } from 'next/navigation';

const handleImageDragStart = (e: React.DragEvent, image: CloudflareImage) => {
  e.stopPropagation();
  const filename = (image.filename || `asset-${image.id}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const copyUrl = getAssetCopyUrl(image, { imageVariant: 'original' });
  const previewUrl = getAssetPreviewUrl(image, { imageVariant: 'public' });
  const cdnUrl = copyUrl || previewUrl;
  if (!cdnUrl) {
    return;
  }

  e.dataTransfer.clearData();
  if (!isVideoAsset(image)) {
    const { mime } = getCloudflareDownloadUrl(image.id, filename);
    e.dataTransfer.setData('DownloadURL', `${mime}:${filename}:${cdnUrl}`);
  }
  
  e.dataTransfer.setData('text/plain', cdnUrl);
  e.dataTransfer.setData('text/uri-list', cdnUrl);
  e.dataTransfer.effectAllowed = 'copy';
};

const DEFAULT_LIST_VARIANT = 'full';

const DETAIL_PERF_LOGGING_ENABLED = process.env.NODE_ENV !== 'production';

const getNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const logDetailPerf = (
  label: string,
  startedAt: number,
  extra?: Record<string, unknown>
) => {
  if (!DETAIL_PERF_LOGGING_ENABLED) return;
  const elapsedMs = Math.round(getNow() - startedAt);
  console.info(`[DetailPerf] ${label} ${elapsedMs}ms`, extra ?? {});
};

export default function ImageDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const detailNavigationStartedAtRef = useRef(getNow());
  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const galleryPageParam = searchParams.get('gpage');
  const galleryNamespaceParam = searchParams.get('gns') ?? '';
  const galleryColorParam = searchParams.get('gcolor');
  const hasGalleryNamespaceParam = searchParams.has('gns');
  const galleryNavSuffix = useMemo(() => {
    const qs = new URLSearchParams();
    if (galleryPageParam) {
      qs.set('gpage', galleryPageParam);
    }
    if (hasGalleryNamespaceParam) {
      qs.set('gns', galleryNamespaceParam);
    }
    if (galleryColorParam) {
      qs.set('gcolor', galleryColorParam);
    }
    const serialized = qs.toString();
    return serialized ? `?${serialized}` : '';
  }, [galleryColorParam, galleryNamespaceParam, galleryPageParam, hasGalleryNamespaceParam]);

  const initialDetailSeedRef = useRef<CloudflareImage | null>(null);
  const seededInputAppliedRef = useRef(false);
  const [image, setImage] = useState<CloudflareImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [animationRepairLoading, setAnimationRepairLoading] = useState<null | 'copy' | 'replace'>(null);
  const [animationRepairError, setAnimationRepairError] = useState<string | null>(null);
  const [familyLoaded, setFamilyLoaded] = useState(false);
  const toast = useToast();
  const [galleryResultIds, setGalleryResultIds] = useState<string[]>([]);
  const [galleryResultAssetTypes, setGalleryResultAssetTypes] = useState<Record<string, 'image' | 'video'>>({});
  const lastUserNavIntentRef = useRef(0);
  const pinnedImageIdRef = useRef<string | null>(id ?? null);

  const handleBackToGallery = useCallback(() => {
    if (hasFreshGalleryReturnState(galleryNamespaceParam)) {
      router.push('/', { scroll: false });
      return;
    }
    if (galleryPageParam) {
      const qs = new URLSearchParams();
      qs.set('gpage', galleryPageParam);
      qs.set('gns', galleryNamespaceParam);
      if (galleryColorParam) {
        qs.set('gcolor', galleryColorParam);
      }
      router.push(`/?${qs.toString()}`, { scroll: false });
      return;
    }
    router.push('/');
  }, [galleryColorParam, galleryNamespaceParam, galleryPageParam, router]);

  const [allImages, setAllImages] = useState<CloudflareImage[]>([]);
  const [fallbackParentImage, setFallbackParentImage] = useState<CloudflareImage | null>(null);
  const [reassignParentId, setReassignParentId] = useState('');
  const [childDetachingId, setChildDetachingId] = useState<string | null>(null);
  const [swappingParentId, setSwappingParentId] = useState<string | null>(null);
  const [candidatePoolLoading, setCandidatePoolLoading] = useState(false);
  const [candidatePoolLoaded, setCandidatePoolLoaded] = useState(false);
  const [candidatePoolFailed, setCandidatePoolFailed] = useState(false);
  const [adoptSearch, setAdoptSearch] = useState('');
  const [adoptFolderFilter, setAdoptFolderFilter] = useState('');
  const [adoptScope, setAdoptScope] = useState<'current' | 'all'>('current');
  const adoptScopeDefaultedForIdRef = useRef<string | null>(null);
  const [adoptAssetTypeFilter, setAdoptAssetTypeFilter] = useState<'' | 'image' | 'video'>('');
  const [variationPage, setVariationPage] = useState(1);
  const [variationLayout, setVariationLayout] = useState<'list' | 'grid'>('list');
  const [variationTrueAspect, setVariationTrueAspect] = useState(true);
  const [adoptPage, setAdoptPage] = useState(1);
  const [listVariant, setListVariant] = useState(DEFAULT_LIST_VARIANT);
  const LIST_VARIATION_PAGE_SIZE = 25;
  const GRID_VARIATION_PAGE_SIZE = 36;
  const ADOPT_PAGE_SIZE = 12;
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null);

  const {
    promptThisInput,
    setPromptThisInput,
    promptThisLoading,
    promptThisGenerating,
    promptThisSaving,
    promptThisMeta,
    generatePromptThis,
  } = usePromptThisEditor({ imageId: image?.id, toastPush: toast.push });
  const [tagGenerationCount, setTagGenerationCount] = useState(6);
  const [tagGenerationLoading, setTagGenerationLoading] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const { shareBaseUrl, setShareBaseUrl } = usePersistentShareBaseUrl();
  const [embeddingGenerating, setEmbeddingGenerating] = useState(false);
  // Image Extras state (description/altText stored in Redis/file fallback)
  const [extrasRecord, setExtrasRecord] = useState<{
    imageId?: string;
    description?: string;
    altText?: string;
    promptThis?: { text: string; provider: string; model?: string; updatedAt?: string };
    comfyWorkflow?: ComfyWorkflowRecord;
  } | null>(null);
  const [shareVariant, setShareVariant] = useState('large');
  const [namespace, setNamespace] = useState('');
  const [registryNamespaces, setRegistryNamespaces] = useState<string[]>([]);
  const [namespaceMoving, setNamespaceMoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [embeddingPendingMap, setEmbeddingPendingMap] = useState<Record<string, EmbeddingPendingEntry>>({});
  const [uniqueFolders, setUniqueFolders] = useState<string[]>([]);
  const metadataDraft = useImageMetadataDraft<CloudflareImage>({ image, extrasRecord });
  const {
    folderSelect,
    newFolderInput,
    tagsInput,
    descriptionInput,
    altTextInput,
    originalUrlInput,
    sourceUrlInput,
    displayNameInput,
    setFolderSelect,
    setNewFolderInput,
    setTagsInput,
    setDescriptionInput,
    setAltTextInput,
    setOriginalUrlInput,
    setSourceUrlInput,
    setDisplayNameInput,
    applyDraft: applyMetadataDraft,
    resetFromImage: resetMetadataDraftFromImage,
    buildSavePayload: buildMetadataSavePayload,
    applySavedResponse: applyMetadataSavedResponse,
    markSaved: markMetadataSaved,
  } = metadataDraft;
  const [variantModalState, setVariantModalState] = useState<{ target: CloudflareImage } | null>(null);
  const [cropVariantOpen, setCropVariantOpen] = useState(false);
  const [variationOrderOverride, setVariationOrderOverride] = useState<string[] | null>(null);
  const [variationOrderSaving, setVariationOrderSaving] = useState(false);
  const [draggingVariationId, setDraggingVariationId] = useState<string | null>(null);
  const [dragOverVariationId, setDragOverVariationId] = useState<string | null>(null);
  const [selectedVariationIds, setSelectedVariationIds] = useState<Set<string>>(() => new Set());
  const [previewRotation, setPreviewRotation] = useState(0);
  const [rotationLoading, setRotationLoading] = useState(false);
  const [rotationError, setRotationError] = useState<string | null>(null);
  const [rotatedAsset, setRotatedAsset] = useState<{ id: string; url: string; info?: string } | null>(null);
  const draftAppliedRef = useRef<string | null>(null);
  const candidatePoolLoadedRef = useRef(false);
  const candidatePoolRequestedRef = useRef(false);
  const metadataDraftDirtyRef = useRef(false);
  const currentImageIdRef = useRef<string | null>(null);
  const extrasRecordRef = useRef<typeof extrasRecord>(extrasRecord);

  useEffect(() => {
    currentImageIdRef.current = image?.id ?? null;
  }, [image?.id]);

  useEffect(() => {
    extrasRecordRef.current = extrasRecord;
  }, [extrasRecord]);

  const [semanticSearchAllNamespaces, setSemanticSearchAllNamespaces] = useState(false);

  const buildFamilyContextUrl = useCallback((options?: { includeCandidates?: boolean }) => {
    if (!id) return '';
    const params = new URLSearchParams();
    if (options?.includeCandidates) {
      params.set('includeCandidates', '1');
    }
    const serialized = params.toString();
    return serialized
      ? `/api/images/${encodeURIComponent(id)}/family?${serialized}`
      : `/api/images/${encodeURIComponent(id)}/family`;
  }, [id]);

  const syncImageState = useCallback((found: CloudflareImage | null) => {
    const extrasForCurrentImage =
      found && extrasRecordRef.current?.imageId === found.id ? extrasRecordRef.current : null;
    const preserveMetadataInputs =
      Boolean(found && currentImageIdRef.current === found.id && metadataDraftDirtyRef.current);
    setImage(found);
    if (found) {
      if (!preserveMetadataInputs) {
        resetMetadataDraftFromImage(found, extrasForCurrentImage);
      }
      setReassignParentId(found.parentId || '');

      if (!preserveMetadataInputs && typeof window !== 'undefined') {
        const draftKey = `${IMAGE_DETAIL_DRAFT_KEY_PREFIX}${found.id}`;
        const legacyDraftKey = `${LEGACY_IMAGE_DETAIL_DRAFT_KEY_PREFIX}${found.id}`;
        try {
          window.sessionStorage.removeItem(legacyDraftKey);
          const raw = window.sessionStorage.getItem(draftKey);
          if (raw) {
            const parsed = JSON.parse(raw) as Partial<ImageDetailDraft>;
            if (shouldRestoreImageDetailDraft(parsed) && draftAppliedRef.current !== found.id) {
              applyMetadataDraft({
                ...(typeof parsed.folderSelect === 'string' ? { folderSelect: parsed.folderSelect } : {}),
                ...(typeof parsed.tagsInput === 'string' ? { tagsInput: parseUserTagsInput(parsed.tagsInput).join(', ') } : {}),
                ...(typeof parsed.descriptionInput === 'string' ? { descriptionInput: parsed.descriptionInput } : {}),
                ...(typeof parsed.altTextInput === 'string' ? { altTextInput: parsed.altTextInput } : {}),
                ...(typeof parsed.originalUrlInput === 'string' ? { originalUrlInput: parsed.originalUrlInput } : {}),
                ...(typeof parsed.sourceUrlInput === 'string' ? { sourceUrlInput: parsed.sourceUrlInput } : {}),
                ...(typeof parsed.displayNameInput === 'string' ? { displayNameInput: parsed.displayNameInput } : {}),
              });
              draftAppliedRef.current = found.id;
            }
          }
        } catch {
          // Ignore malformed draft payloads.
        }
      }
    } else {
      resetMetadataDraftFromImage(null, null);
      setReassignParentId('');
    }
  }, [applyMetadataDraft, resetMetadataDraftFromImage]);

  const mergeContextImages = useCallback((imagesData: CloudflareImage[], familyRootId?: string) => {
    setAllImages((prev) => {
      const nextImages = mergeFamilyContextImages(prev, imagesData, familyRootId);
      const folders = Array.from(
        new Set(
          nextImages
            .filter((img) => img.folder && img.folder.trim())
            .map((img) => String(img.folder))
        )
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      setUniqueFolders(folders as string[]);
      return nextImages;
    });
  }, []);

  useEffect(() => {
    const seed = getFreshDetailAssetSeed<CloudflareImage>({
      id,
      assetType: 'image',
      namespace: galleryNamespaceParam,
    })?.asset ?? null;
    initialDetailSeedRef.current = seed;
    seededInputAppliedRef.current = false;
    detailNavigationStartedAtRef.current = getNow();
    setLoading(!seed);
    setFamilyLoaded(false);
    setImage(seed);
    setAllImages(seed ? [seed] : []);
    setUniqueFolders(seed?.folder ? [seed.folder] : []);
    setFallbackParentImage(null);
    candidatePoolLoadedRef.current = false;
    candidatePoolRequestedRef.current = false;
    setCandidatePoolLoaded(false);
    setCandidatePoolLoading(false);
    setCandidatePoolFailed(false);
    adoptScopeDefaultedForIdRef.current = null;
    if (seed) {
      logDetailPerf('seed:loaded', detailNavigationStartedAtRef.current, {
        imageId: seed.id,
        namespace: seed.namespace ?? null,
      });
    }
  }, [galleryNamespaceParam, id]);

  useEffect(() => {
    const seed = initialDetailSeedRef.current;
    if (!seed || seededInputAppliedRef.current) return;
    seededInputAppliedRef.current = true;
    syncImageState(seed);
    mergeContextImages([seed]);
    setLoading(false);
    logDetailPerf('seed:applied', detailNavigationStartedAtRef.current, {
      imageId: seed.id,
    });
  }, [mergeContextImages, syncImageState]);


  const generateEmbeddings = useCallback(async () => {
    if (!image || !id) {
      return;
    }
    setEmbeddingGenerating(true);
    try {
      const response = await fetch(`/api/images/${id}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip: true, color: true, force: false })
      });
      const data = await response.json();
      
      if (!response.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to generate embeddings';
        toast.push(message);
        return;
      }

      // Update local image state with embedding data
      const updatedImage = {
        ...image,
        hasClipEmbedding: data.hasClipEmbedding ?? image.hasClipEmbedding,
        hasColorEmbedding: data.hasColorEmbedding ?? image.hasColorEmbedding,
        dominantColors: data.dominantColors ?? image.dominantColors,
        averageColor: data.averageColor ?? image.averageColor,
      };

      setImage(updatedImage);
      setAllImages((prev) => prev.map((img) => (img.id === id ? updatedImage : img)));

      const types: string[] = [];
      if (data.generatedClip) types.push('CLIP');
      if (data.generatedColor) types.push('color');
      
      if (types.length > 0) {
        toast.push(`Generated ${types.join(' + ')} embeddings`);
      } else if (data.skippedClip || data.skippedColor) {
        toast.push('Embeddings already exist');
      } else {
        toast.push('Embeddings updated');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate embeddings';
      console.error('Failed to generate embeddings:', error);
      toast.push(message);
    } finally {
      setEmbeddingGenerating(false);
    }
  }, [id, image, toast]);

  const handleToggleFavorite = useCallback(async () => {
    if (!image || !id || image.assetType === 'video') {
      return;
    }
    const nextFavorite = !hasFavoriteTag(image.tags);
    setFavoriteLoading(true);
    try {
      const { ok, payload } = await patchImageFavorite(id, nextFavorite);
      if (!ok || !Array.isArray(payload.tags)) {
        toast.push(payload.error || 'Failed to update favorite');
        return;
      }
      setImage(prev => (prev && prev.id === id ? { ...prev, tags: payload.tags } : prev));
      setAllImages(prev => prev.map(entry => (entry.id === id ? { ...entry, tags: payload.tags } : entry)));
      toast.push(nextFavorite ? 'Added to favorites' : 'Removed from favorites');
    } catch (error) {
      console.error('Failed to update favorite:', error);
      toast.push('Failed to update favorite');
    } finally {
      setFavoriteLoading(false);
    }
  }, [id, image, toast]);

  useEffect(() => {
    setVariationPage(1);
  }, [image?.id, image?.parentId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('imageNamespace');
    const envDefault = process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || 'cf-default';
    if (stored === '__none__') {
      setNamespace(envDefault);
    } else if (stored === '__all__') {
      setNamespace('__all__');
    } else {
      setNamespace(stored || envDefault);
    }
  }, []);

  useEffect(() => {
    const parsed = getFreshGalleryReturnState(galleryNamespaceParam);
    if (!parsed) {
      setGalleryResultIds([]);
      setGalleryResultAssetTypes({});
      return;
    }

    setGalleryResultIds(parsed.resultIds);
    const nextAssetTypes: Record<string, 'image' | 'video'> = {};
    parsed.resultAssets.forEach((entry) => {
      nextAssetTypes[entry.id] = entry.assetType === 'video' ? 'video' : 'image';
    });
    setGalleryResultAssetTypes(nextAssetTypes);
  }, [galleryNamespaceParam, id]);

  useEffect(() => {
    return subscribeEmbeddingPending(setEmbeddingPendingMap);
  }, []);

  const loadRegistryNamespaces = useCallback(async () => {
    try {
      const response = await fetch('/api/namespaces', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as { namespaces?: unknown };
      if (!response.ok || !Array.isArray(payload.namespaces)) {
        return;
      }
      setRegistryNamespaces(
        payload.namespaces
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter((entry, index, values) =>
            Boolean(entry) &&
            entry !== '__all__' &&
            entry !== '__none__' &&
            values.indexOf(entry) === index
          )
      );
    } catch (error) {
      console.warn('Failed to load namespaces', error);
    }
  }, []);

  useEffect(() => {
    void loadRegistryNamespaces();
  }, [loadRegistryNamespaces]);

  // Clear stale pending embedding status if the image already has embeddings
  useEffect(() => {
    if (image?.id && (image.hasClipEmbedding || image.hasColorEmbedding)) {
      clearPendingIfHasEmbeddings(image.id, image.hasClipEmbedding, image.hasColorEmbedding);
    }
  }, [image?.id, image?.hasClipEmbedding, image?.hasColorEmbedding]);

  const refreshImageList = useCallback(async () => {
    if (!id) {
      return;
    }
    const startedAt = getNow();
    try {
      const [imageResponse, familyResponse] = await Promise.all([
        fetchDetailImageResponse(id),
        fetch(buildFamilyContextUrl({ includeCandidates: candidatePoolLoadedRef.current })),
      ]);
      const [imageData, familyData] = await Promise.all([
        imageResponse.json(),
        familyResponse.json(),
      ]);

      if (imageResponse.ok && imageData?.image) {
        syncImageState(imageData.image as CloudflareImage);
        mergeContextImages([imageData.image as CloudflareImage]);
      }
      if (familyResponse.ok) {
        const incoming = [
          ...(Array.isArray(familyData?.familyAssets) ? familyData.familyAssets : []),
          ...(Array.isArray(familyData?.candidateAssets) ? familyData.candidateAssets : []),
          ...extractAssignmentCandidateAssets(familyData),
        ] as CloudflareImage[];
        const familyRootId =
          typeof familyData?.familyRootId === 'string' ? familyData.familyRootId : undefined;
        mergeContextImages(incoming, familyRootId);
        if (familyData?.diagnostics?.include_candidates === true) {
          candidatePoolLoadedRef.current = true;
          setCandidatePoolLoaded(true);
        }
      }
      setFamilyLoaded(true);
      logDetailPerf('refreshImageList:fetch', startedAt, {
        imageServerTiming: imageResponse.headers.get('server-timing'),
        familyServerTiming: familyResponse.headers.get('server-timing'),
        familyDiagnostics: familyData?.diagnostics ?? null,
        candidatePoolLoaded: candidatePoolLoadedRef.current,
      });
    } catch (error) {
      console.error('Failed to refresh images', error);
    }
  }, [buildFamilyContextUrl, id, mergeContextImages, syncImageState]);

  const handleCropVariantCreated = useCallback(async () => {
    toast.push('Crop variant created');
    await refreshImageList();
  }, [refreshImageList, toast]);

  const registerDetailNamespace = useCallback(async (nextNamespace: string, description?: string) => {
    const cleanNamespace = nextNamespace.trim();
    if (!cleanNamespace || cleanNamespace === '__all__' || cleanNamespace === '__none__') {
      toast.push('Enter a non-empty namespace name');
      return false;
    }

    try {
      const response = await fetch('/api/namespaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: cleanNamespace,
          description: description?.trim() ?? '',
        }),
      });
      const payload = await response.json().catch(() => ({})) as { namespaces?: unknown; error?: string };
      if (!response.ok) {
        toast.push(payload.error || 'Failed to create namespace');
        return false;
      }
      if (Array.isArray(payload.namespaces)) {
        setRegistryNamespaces(
          payload.namespaces
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter((entry, index, values) =>
              Boolean(entry) &&
              entry !== '__all__' &&
              entry !== '__none__' &&
              values.indexOf(entry) === index
            )
        );
      } else {
        await loadRegistryNamespaces();
      }
      toast.push(`Created namespace ${cleanNamespace}`);
      return true;
    } catch (error) {
      console.error('Failed to create namespace', error);
      toast.push('Failed to create namespace');
      return false;
    }
  }, [loadRegistryNamespaces, toast]);

  const handleMoveFamilyNamespace = useCallback(async (nextNamespace: string) => {
    if (!image || !id) {
      return false;
    }
    const cleanNamespace = nextNamespace.trim();
    if (!cleanNamespace || cleanNamespace === '__all__' || cleanNamespace === '__none__') {
      toast.push('Choose a namespace to move this image family');
      return false;
    }
    if (cleanNamespace === (image.namespace ?? '').trim()) {
      toast.push('This image family is already in that namespace');
      return false;
    }

    setNamespaceMoving(true);
    try {
      const response = await fetch(`/api/images/${encodeURIComponent(id)}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: cleanNamespace,
          applyToFamily: true,
          applyToFamilyFields: ['namespace'],
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        updatedIds?: unknown;
        namespace?: unknown;
        error?: string;
      };
      if (!response.ok) {
        toast.push(payload.error || 'Failed to move namespace');
        return false;
      }

      const updatedIds = Array.isArray(payload.updatedIds)
        ? payload.updatedIds.filter((entry): entry is string => typeof entry === 'string')
        : [id];
      const updatedIdSet = new Set(updatedIds);
      setImage(prev => prev && updatedIdSet.has(prev.id) ? { ...prev, namespace: cleanNamespace } : prev);
      setAllImages(prev =>
        prev.map(entry => updatedIdSet.has(entry.id) ? { ...entry, namespace: cleanNamespace } : entry)
      );
      setRegistryNamespaces(prev => {
        const next = new Set(prev);
        next.add(cleanNamespace);
        return Array.from(next).sort((left, right) => left.localeCompare(right));
      });
      toast.push(`Moved ${updatedIds.length} image${updatedIds.length === 1 ? '' : 's'} to ${cleanNamespace}`);
      await refreshImageList();
      await loadRegistryNamespaces();
      return true;
    } catch (error) {
      console.error('Failed to move namespace', error);
      toast.push('Failed to move namespace');
      return false;
    } finally {
      setNamespaceMoving(false);
    }
  }, [id, image, loadRegistryNamespaces, refreshImageList, toast]);

  const fetchCandidatePool = useCallback(async () => {
    if (!id || candidatePoolLoadedRef.current || candidatePoolRequestedRef.current) {
      return;
    }

    candidatePoolRequestedRef.current = true;
    setCandidatePoolLoading(true);
    setCandidatePoolFailed(false);
    const startedAt = getNow();
    try {
      const response = await fetch(buildFamilyContextUrl({ includeCandidates: true }));
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to fetch candidate assets');
      }

      const incoming = [
        ...(Array.isArray(data?.familyAssets) ? data.familyAssets : []),
        ...(Array.isArray(data?.candidateAssets) ? data.candidateAssets : []),
        ...extractAssignmentCandidateAssets(data),
      ] as CloudflareImage[];
      const familyRootId = typeof data?.familyRootId === 'string' ? data.familyRootId : undefined;
      mergeContextImages(incoming, familyRootId);
      candidatePoolLoadedRef.current = true;
      setCandidatePoolLoaded(true);
      setFamilyLoaded(true);
      logDetailPerf('candidateFetch:total', startedAt, {
        serverTiming: response.headers.get('server-timing'),
        diagnostics: data?.diagnostics ?? null,
        candidateCount: Array.isArray(data?.candidateAssets) ? data.candidateAssets.length : 0,
      });
    } catch (error) {
      candidatePoolRequestedRef.current = false;
      setCandidatePoolFailed(true);
      console.warn('Failed to fetch adoptable candidates', error);
    } finally {
      setCandidatePoolLoading(false);
    }
  }, [buildFamilyContextUrl, id, mergeContextImages]);

  const {
    parentActionLoading,
    patchParentAssignment,
    handleDetachFromParent,
    handleReassignParent
  } = useParentAssignment({
    image,
    reassignParentId,
    refreshImageList,
    toast
  });

  const visibleImageTags = useMemo(() => getUserVisibleTags(image?.tags), [image?.tags]);

  const {
    childUploadItems,
    appendChildUploadFiles,
    clearChildUploadFiles,
    updateChildUploadFilename,
    childUploadTags,
    childUploadFolder,
    childUploadLoading,
    childUploadUrl,
    childUploadUrlFilename,
    childUploadUrlLoading,
    setChildUploadUrl,
    setChildUploadUrlFilename,
    childImportUrl,
    childImportLoading,
    childImportError,
    setChildImportUrl,
    handleImportFromUrl,
    handleChildUpload,
    handleChildUploadByUrl
  } = useVariationUpload({
    imageId: typeof id === 'string' ? id : undefined,
    imageFolder: image?.folder,
    imageTags: visibleImageTags,
    imageNamespace: image?.namespace,
    refreshImageList,
    toast
  });

  const onVariantDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    appendChildUploadFiles(acceptedFiles);
  }, [appendChildUploadFiles]);

  const {
    getRootProps: getVariantDropzoneProps,
    getInputProps: getVariantInputProps,
    isDragActive: isVariantDragActive
  } = useDropzone({
    onDrop: onVariantDrop,
    accept: VARIATION_UPLOAD_ACCEPT,
    multiple: true
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      const startedAt = getNow();
      try {
        if (!initialDetailSeedRef.current) {
          setLoading(true);
        }
        if (!id) {
          return;
        }
        const res = await fetchDetailImageResponse(id);
        const jsonStartedAt = getNow();
        const data = await res.json();
        const jsonElapsedMs = Math.round(getNow() - jsonStartedAt);
        if (!mounted) return;
        if (res.ok && data?.image) {
          const syncStartedAt = getNow();
          syncImageState(data.image as CloudflareImage);
          mergeContextImages([data.image as CloudflareImage]);
          logDetailPerf('primaryFetch:sync', syncStartedAt, {
            imageId: data.image.id,
          });
        }
        logDetailPerf('primaryFetch:total', startedAt, {
          jsonParseMs: jsonElapsedMs,
          serverTiming: res.headers.get('server-timing'),
          diagnostics: data?.diagnostics ?? null,
          imageId: data?.image?.id ?? null,
        });
      } catch (err) {
        console.error('Failed to fetch image from API', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id, mergeContextImages, syncImageState]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const startedAt = getNow();
      try {
        if (!id) return;
        const res = await fetch(buildFamilyContextUrl());
        const jsonStartedAt = getNow();
        const data = await res.json();
        const jsonElapsedMs = Math.round(getNow() - jsonStartedAt);
        if (!mounted || !res.ok) return;
        const familyAssets = Array.isArray(data.familyAssets) ? (data.familyAssets as CloudflareImage[]) : [];
        mergeContextImages(familyAssets);
        logDetailPerf('familyFetch:total', startedAt, {
          jsonParseMs: jsonElapsedMs,
          serverTiming: res.headers.get('server-timing'),
          diagnostics: data?.diagnostics ?? null,
          familyCount: familyAssets.length,
        });
      } catch (error) {
        console.error('Failed to fetch family context', error);
      } finally {
        if (mounted) {
          setFamilyLoaded(true);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [buildFamilyContextUrl, id, mergeContextImages]);

  // Fetch Image Extras (description/altText) from Redis/file storage with Cloudflare fallback
  useEffect(() => {
    if (!id) {
      setExtrasRecord(null);
      return;
    }
    let mounted = true;
    (async () => {
      const startedAt = getNow();
      try {
        const res = await fetch(`/api/images/${id}/extras`);
        const jsonStartedAt = getNow();
        if (!res.ok) {
          throw new Error('Failed to fetch extras');
        }
        const data = await res.json();
        const jsonElapsedMs = Math.round(getNow() - jsonStartedAt);
        if (!mounted) return;
        setExtrasRecord(data.record ? { ...data.record, imageId: id } : null);
        // Apply extras values, including intentional empty strings from legacy records.
        const nextDraft: Parameters<typeof applyMetadataDraft>[0] = {};
        if (data.record && Object.prototype.hasOwnProperty.call(data.record, 'description')) {
          nextDraft.descriptionInput = data.record.description ?? '';
        }
        if (data.record && Object.prototype.hasOwnProperty.call(data.record, 'altText')) {
          nextDraft.altTextInput = data.record.altText ?? '';
        }
        if (Object.keys(nextDraft).length > 0) {
          applyMetadataDraft(nextDraft);
        }
        logDetailPerf('extrasFetch:total', startedAt, {
          jsonParseMs: jsonElapsedMs,
          hasRecord: Boolean(data.record),
        });
      } catch (err) {
        console.error('Failed to fetch image extras', err);
        // On error, keep the current image metadata values already loaded from /api/images/[id].
        if (mounted) setExtrasRecord(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [applyMetadataDraft, id]);

  const variationChildren = useMemo(
    () => (id ? allImages.filter((img) => img.parentId === id) : []),
    [allImages, id]
  );

  const siblingVariations = useMemo(() => {
    if (!image?.parentId) return [];
    return allImages.filter(
      (img) => img.parentId === image.parentId && img.id !== image.id
    );
  }, [allImages, image?.parentId, image?.id]);

  const variationCandidates = useMemo(() => {
    return image?.parentId ? siblingVariations : variationChildren;
  }, [image?.parentId, siblingVariations, variationChildren]);

  const { parentImage, assignmentCandidates, reassignParentOptions } = useParentReassignment({
    allImages,
    currentImage: image,
    excludeId: id
  });
  const resolvedParentImage = parentImage ?? fallbackParentImage;
  const adoptCurrentNamespace = (resolvedParentImage?.namespace || image?.namespace || '').trim();

  useEffect(() => {
    if (!id || adoptScopeDefaultedForIdRef.current === id) return;
    if (!image) return;
    if (image.parentId && !resolvedParentImage) return;
    setAdoptScope(getDefaultAdoptVariationScope(adoptCurrentNamespace));
    adoptScopeDefaultedForIdRef.current = id;
  }, [adoptCurrentNamespace, id, image, resolvedParentImage]);

  useEffect(() => {
    if (!familyLoaded) return;
    if (!adoptSearch.trim() && !adoptFolderFilter && adoptScope === 'current' && !adoptAssetTypeFilter) return;
    void fetchCandidatePool();
  }, [adoptAssetTypeFilter, adoptFolderFilter, adoptScope, adoptSearch, familyLoaded, fetchCandidatePool]);

  useEffect(() => {
    if (!familyLoaded) return;
    if (candidatePoolLoadedRef.current || candidatePoolRequestedRef.current) return;

    const loadCandidates = () => {
      void fetchCandidatePool();
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(loadCandidates, { timeout: 1500 });
      return () => {
        if ('cancelIdleCallback' in window) {
          window.cancelIdleCallback(idleId);
        }
      };
    }

    const timeoutId = globalThis.setTimeout(loadCandidates, 750);
    return () => globalThis.clearTimeout(timeoutId);
  }, [familyLoaded, fetchCandidatePool, id]);

  useEffect(() => {
    const parentId = image?.parentId;
    if (!parentId) {
      setFallbackParentImage(null);
      return;
    }
    if (parentImage?.id === parentId) {
      setFallbackParentImage(null);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        const response = await fetch(`/api/images/${encodeURIComponent(parentId)}`);
        if (!response.ok) {
          throw new Error('Failed to fetch parent image');
        }
        const data = await response.json();
        if (!mounted) return;
        const fetchedParent = data?.image as CloudflareImage | undefined;
        if (fetchedParent?.id === parentId) {
          setFallbackParentImage(fetchedParent);
        } else {
          setFallbackParentImage(null);
        }
      } catch (error) {
        console.error('Failed to fetch fallback parent image', error);
        if (mounted) {
          setFallbackParentImage(null);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [image?.parentId, parentImage?.id]);

  const displayedVariations = useMemo(() => {
    if (!variationCandidates.length) {
      return [];
    }
    const baseOrdered = sortFamilyMembers(variationCandidates);

    if (!variationOrderOverride || variationOrderOverride.length === 0) {
      return baseOrdered;
    }

    const orderedMap = new Map(baseOrdered.map((item) => [item.id, item]));
    const ordered: CloudflareImage[] = [];
    variationOrderOverride.forEach((variationId) => {
      const candidate = orderedMap.get(variationId);
      if (candidate) {
        ordered.push(candidate);
        orderedMap.delete(variationId);
      }
    });
    baseOrdered.forEach((candidate) => {
      if (orderedMap.has(candidate.id)) {
        ordered.push(candidate);
      }
    });
    return ordered;
  }, [variationCandidates, variationOrderOverride]);

  const variationPageSize = variationLayout === 'grid'
    ? GRID_VARIATION_PAGE_SIZE
    : LIST_VARIATION_PAGE_SIZE;

  const pagedVariations = useMemo(() => {
    const start = (variationPage - 1) * variationPageSize;
    return displayedVariations.slice(start, start + variationPageSize);
  }, [displayedVariations, variationPage, variationPageSize]);

  const totalVariationPages = Math.max(
    1,
    Math.ceil(displayedVariations.length / variationPageSize)
  );

  const adoptAssetTypeOptions = useMemo(
    () => [
      { value: '', label: 'All types' },
      { value: 'image', label: 'Images only' },
      { value: 'video', label: 'Videos only' },
    ],
    []
  );
  const adoptScopeOptions = useMemo(
    () => [
      { value: 'current', label: `Current namespace: ${adoptCurrentNamespace || '[none]'}` },
      { value: 'all', label: 'All namespaces' },
    ],
    [adoptCurrentNamespace]
  );

  const adoptCandidatePage = useMemo(
    () =>
      buildAdoptVariationCandidatePage({
        candidates: assignmentCandidates,
        search: adoptSearch,
        folderFilter: adoptFolderFilter,
        assetTypeFilter: adoptAssetTypeFilter,
        scope: adoptScope,
        currentNamespace: adoptCurrentNamespace,
        page: adoptPage,
        pageSize: ADOPT_PAGE_SIZE,
      }),
    [adoptAssetTypeFilter, adoptCurrentNamespace, adoptFolderFilter, adoptPage, adoptScope, adoptSearch, assignmentCandidates]
  );
  const {
    filteredAssignmentCandidates,
    pagedAssignmentCandidates,
    page: clampedAdoptPage,
    totalPages: totalAdoptPages,
    pageStart: adoptPageStart,
    pageEnd: adoptPageEnd,
  } = adoptCandidatePage;

  useEffect(() => {
    setAdoptPage(1);
  }, [adoptAssetTypeFilter, adoptFolderFilter, adoptScope, adoptSearch, id]);

  useEffect(() => {
    setAdoptPage((prev) => Math.min(prev, totalAdoptPages));
  }, [totalAdoptPages]);

  useEffect(() => {
    if (adoptPage !== clampedAdoptPage) {
      setAdoptPage(clampedAdoptPage);
    }
  }, [adoptPage, clampedAdoptPage]);

  const variants = useMemo(
    () => (id ? getMultipleImageUrls(id, ['thumbnail','small','medium','large','xlarge','full']) : {}),
    [id]
  );

  const shareVariantOptions = useMemo(
    () =>
      IMAGE_VARIANTS.filter((variant) => variant.name !== 'original').map((variant) => ({
        value: variant.name,
        label: variant.width ? `${variant.name} (${variant.width}px)` : variant.name
      })),
    []
  );

  const listVariantOptions = useMemo(
    () =>
      IMAGE_VARIANTS.filter((variant) => variant.name !== 'original').map((variant) => ({
        value: variant.name,
        label: variant.width ? `${variant.name} (${variant.width}px)` : variant.name
      })),
    []
  );

  const detailNamespaceOptions = useMemo(() => {
    const values = new Set<string>();
    registryNamespaces.forEach((entry) => {
      const trimmed = entry.trim();
      if (trimmed && trimmed !== '__all__' && trimmed !== '__none__') {
        values.add(trimmed);
      }
    });
    allImages.forEach((entry) => {
      const trimmed = entry.namespace?.trim();
      if (trimmed && trimmed !== '__all__' && trimmed !== '__none__') {
        values.add(trimmed);
      }
    });
    const current = image?.namespace?.trim();
    if (current && current !== '__all__' && current !== '__none__') {
      values.add(current);
    }
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [allImages, image?.namespace, registryNamespaces]);

  // For SVGs this resolves to the rasterized WebP variant (safe, transformable);
  // for raster assets getAssetPreviewUrl returns the same original delivery URL
  // as before, so non-SVG behavior is unchanged.
  const originalDeliveryUrl = useMemo(
    () => (image ? getAssetPreviewUrl(image, { imageVariant: 'original' }) : (id ? getCloudflareImageUrl(id, 'original') : '')),
    [image, id]
  );
  const imageToolSourcePreviewUrl = useMemo(
    () => (image ? getAssetPreviewUrl(image, { imageVariant: 'public' }) : ''),
    [image]
  );

  const heroRotationStyle = useMemo<CSSProperties>(
    () => ({
      transform: `rotate(${previewRotation}deg)`,
      transition: 'transform 200ms ease',
      transformOrigin: 'center center'
    }),
    [previewRotation]
  );

  const normalizedRotation = useMemo(
    () => ((previewRotation % 360) + 360) % 360,
    [previewRotation]
  );

  const metadataDiagnostics = useMemo(() => {
    const finalFolder =
      folderSelect === '__create__'
        ? newFolderInput.trim() || undefined
        : folderSelect?.trim() || undefined;
    const finalTags = mergeUserTagsPreservingSystemTags(image?.tags, parseUserTagsInput(tagsInput));
    const baseMetadata: Record<string, unknown> = {
      folder: image?.folder,
      tags: image?.tags ?? [],
      description: image?.description ?? '',
      originalUrl: image?.originalUrl,
      originalUrlNormalized: image?.originalUrlNormalized,
      sourceUrl: image?.sourceUrl,
      sourceUrlNormalized: image?.sourceUrlNormalized,
      namespace: image?.namespace,
      contentHash: image?.contentHash,
      altTag: image?.altTag ?? '',
      displayName: image?.displayName ?? image?.filename,
      exif: image?.exif,
      variationParentId: image?.parentId,
      linkedAssetId: image?.linkedAssetId,
      updatedAt: new Date().toISOString()
    };
    const metadata: Record<string, unknown> = { ...baseMetadata };
    if (finalFolder !== undefined) {
      metadata.folder = cleanString(finalFolder);
    }
    metadata.tags = finalTags
      .map((tag) => cleanString(tag))
      .filter((tag): tag is string => Boolean(tag));
    const cleanedOriginalUrl = cleanString(originalUrlInput);
    metadata.originalUrl = cleanedOriginalUrl ?? '';
    metadata.originalUrlNormalized = normalizeOriginalUrl(cleanedOriginalUrl) ?? '';
    const cleanedSourceUrl = cleanString(sourceUrlInput);
    metadata.sourceUrl = cleanedSourceUrl ?? '';
    metadata.sourceUrlNormalized = normalizeOriginalUrl(cleanedSourceUrl) ?? '';
    const cleanedDisplayName = cleanString(displayNameInput);
    metadata.displayName = cleanedDisplayName ?? '';
    const cleanAltTag = cleanString(altTextInput) ?? '';
    metadata.altTag = toCloudflareTextMirror(cleanAltTag);
    const compact = pickCloudflareMetadata(
      omitExtrasOnlyCloudflareMetadata(metadata),
      { includeEmpty: true }
    );
    try {
      const encoder = new TextEncoder();
      const size = encoder.encode(JSON.stringify(compact)).length;
      const pruned = enforceCloudflareMetadataLimit(compact, 1024);
      const largestFields = Object.entries(compact)
        .map(([key, value]) => ({
          key,
          bytes: encoder.encode(JSON.stringify(value)).length
        }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 3);
      return { size, largestFields, prunedSize: pruned.size, prunedDropped: pruned.dropped };
    } catch {
      return { size: 0, largestFields: [], prunedSize: 0, prunedDropped: [] };
    }
  }, [
    altTextInput,
    displayNameInput,
    folderSelect,
    image,
    newFolderInput,
    originalUrlInput,
    sourceUrlInput,
    tagsInput
  ]);

  const metadataByteSize = metadataDiagnostics.size;
  const metadataLargestFields = metadataDiagnostics.largestFields;
  const metadataPrunedByteSize = metadataDiagnostics.prunedSize;
  const metadataPrunedDroppedFields = metadataDiagnostics.prunedDropped;

  const pendingEmbedding = id ? embeddingPendingMap[id as string] : undefined;
  const galleryResultIndex = useMemo(() => {
    if (!id) return -1;
    return galleryResultIds.indexOf(id);
  }, [galleryResultIds, id]);
  const prevGalleryImageId = galleryResultIndex > 0 ? galleryResultIds[galleryResultIndex - 1] : null;
  const nextGalleryImageId =
    galleryResultIndex >= 0 && galleryResultIndex < galleryResultIds.length - 1
      ? galleryResultIds[galleryResultIndex + 1]
      : null;
  const buildAssetHref = useCallback(
    (targetId: string) => {
      const target = allImages.find((entry) => entry.id === targetId);
      const assetType = target?.assetType ?? galleryResultAssetTypes[targetId];
      const basePath = assetType === 'video' ? `/videos/${targetId}` : `/images/${targetId}`;
      return `${basePath}${galleryNavSuffix}`;
    },
    [allImages, galleryNavSuffix, galleryResultAssetTypes]
  );
  const handleReverseAnimation = useCallback(async (replaceOriginal: boolean) => {
    if (!image) return;
    if (replaceOriginal) {
      const confirmed = window.confirm(
        'Replace this animated WebP with a reversed version? Cloudflare image IDs cannot be reused. A new image will be uploaded, this image will be deleted after upload succeeds, and any copied or embedded old URLs will stop working.'
      );
      if (!confirmed) return;
    }

    setAnimationRepairLoading(replaceOriginal ? 'replace' : 'copy');
    setAnimationRepairError(null);
    try {
      const response = await fetch(`/api/images/${encodeURIComponent(image.id)}/animation/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'reverse', replaceOriginal }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to reverse animation');
      }
      const nextId = typeof payload?.image?.id === 'string' ? payload.image.id : '';
      if (!nextId) {
        throw new Error('Reverse animation response did not include a new image ID');
      }
      toast.push(replaceOriginal ? 'Reversed replacement created' : 'Reversed copy created');
      if (replaceOriginal) {
        router.replace(buildAssetHref(nextId), { scroll: false });
      } else {
        await refreshImageList();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reverse animation';
      setAnimationRepairError(message);
      toast.push(message);
    } finally {
      setAnimationRepairLoading(null);
    }
  }, [buildAssetHref, image, refreshImageList, router, toast]);
  const handleColorSearchNavigation = useCallback((hex: string) => {
    const normalized = normalizeColorSearchHex(hex);
    if (!normalized) return;
    const targetNamespace = image?.namespace ?? galleryNamespaceParam;
    const qs = new URLSearchParams();
    qs.set('gcolor', normalized);
    qs.set('gns', targetNamespace ?? '');
    router.push(`/?${qs.toString()}`, { scroll: false });
  }, [galleryNamespaceParam, image?.namespace, router]);
  const handleShowInGalleryOrder = useCallback(() => {
    if (!id) return;
    clearGalleryReturnState();
    clearGalleryReturnSnapshot();
    resetGalleryPreferencesForFocus();
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(GALLERY_NAMESPACE_STORAGE_KEY, '__all__');
    }
    router.push(
      buildCanonicalGalleryHref({
        assetId: id,
        namespace: '__all__',
      }),
      { scroll: false }
    );
  }, [id, router]);
  const handleShowInNamespace = useCallback(() => {
    if (!id) return;
    const targetNamespace = image?.namespace?.trim();
    if (!targetNamespace) {
      toast.push('This image does not have a namespace to show.');
      return;
    }
    clearGalleryReturnState();
    clearGalleryReturnSnapshot();
    resetGalleryPreferencesForFocus();
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(GALLERY_NAMESPACE_STORAGE_KEY, targetNamespace);
    }
    router.push(
      buildCanonicalGalleryHref({
        assetId: id,
        namespace: targetNamespace,
      }),
      { scroll: false }
    );
  }, [id, image?.namespace, router, toast]);

  const commitNavigation = useCallback((href: string, targetId?: string | null) => {
    lastUserNavIntentRef.current = Date.now();
    if (targetId) {
      pinnedImageIdRef.current = targetId;
    }
    setLoading(true);
    router.push(href, { scroll: false });
  }, [router]);
  const commitAssetNavigation = useCallback((targetId: string | null) => {
    if (!targetId) return;
    commitNavigation(buildAssetHref(targetId), targetId);
  }, [buildAssetHref, commitNavigation]);
  useDetailNavigationGuard({
    id,
    buildAssetHref,
    router,
    lastUserNavIntentRef,
    pinnedImageIdRef,
  });
  const familyVariantSequence = useMemo(() => {
    if (!image?.parentId) return [];
    const familyVariants = allImages.filter((img) => img.parentId === image.parentId);
    if (!familyVariants.length) return [];
    return sortFamilyMembers(familyVariants);
  }, [allImages, image?.parentId]);
  const familyVariantIndex = useMemo(() => {
    if (!image?.id) return -1;
    return familyVariantSequence.findIndex((entry) => entry.id === image.id);
  }, [familyVariantSequence, image?.id]);
  const prevFamilyVariantId =
    familyVariantIndex > 0 ? familyVariantSequence[familyVariantIndex - 1]?.id ?? null : null;
  const nextFamilyVariantId =
    familyVariantIndex >= 0 && familyVariantIndex < familyVariantSequence.length - 1
      ? familyVariantSequence[familyVariantIndex + 1]?.id ?? null
      : null;

  const originalUrlByteLength = useMemo(() => {
    try {
      return new TextEncoder().encode(originalUrlInput || '').length;
    } catch {
      return 0;
    }
  }, [originalUrlInput]);
  const originalUrlTooLong = originalUrlByteLength > 64;

  const effectiveParentFolder = useMemo(() => {
    const selected =
      folderSelect === '__create__'
        ? newFolderInput.trim()
        : folderSelect?.trim();
    return cleanString(selected);
  }, [folderSelect, newFolderInput]);

  const parentTags = useMemo(() => {
    if (!tagsInput) {
      return [];
    }
    return parseUserTagsInput(tagsInput);
  }, [tagsInput]);

  const exifEntries = useMemo(() => {
    const exif = image?.exif;
    if (!exif || typeof exif !== 'object') {
      return [];
    }
    return Object.entries(exif)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, String(value)] as [string, string]);
  }, [image?.exif]);

  const isChildImage = Boolean(image?.parentId);
  const hasVariations = !isChildImage && variationChildren.length > 0;
  const variationCount = displayedVariations.length;
  const {
    bulkDescriptionApplying,
    bulkAltApplying,
    bulkFolderApplying,
    bulkTagsAppending,
    bulkTagsReplacing,
    applyDescriptionToVariations,
    applyAltToVariations,
    applyFolderToVariations,
    applyTagsToVariations
  } = useBulkVariationMetadata({
    imageId: typeof id === 'string' ? id : undefined,
    isChildImage,
    variationChildren,
    parentTags,
    effectiveParentFolder,
    descriptionInput,
    altTextInput,
    setAllImages,
    toast,
    isMetadataLimitError,
    formatFailureNames
  });
  const {
    altLoadingMap,
    variationAltBusy,
    descriptionGenerating,
    displayNameGenerating,
    generateAltTag,
    generateAltForSelectedVariations,
    generateDescription,
    generateDisplayName
  } = useAltDescriptionGeneration({
    imageId: typeof id === 'string' ? id : undefined,
    descriptionInput,
    selectedVariationIds,
    setDescriptionInput,
    setDisplayNameInput,
    setAltTextInput,
    setImage,
    setAllImages,
    setExtrasRecord: (updater) => setExtrasRecord((prev) => updater(prev)),
    toast
  });

  const {
    deleteFamilyOpen,
    deleteFamilyStatus,
    closeDeleteFamilyModal,
    handleDeleteParent,
    handleDeleteCurrent,
    handleDeleteFamily
  } = useDeleteImageFamily({
    image,
    isChildImage,
    toast
  });
  const hasMissingVariationSort = useMemo(() => {
    return variationCandidates.some((child) => !Number.isFinite(child.variationSort));
  }, [variationCandidates]);
  const variationOrderIndex = useMemo(() => {
    return new Map(displayedVariations.map((child, index) => [child.id, index]));
  }, [displayedVariations]);
  const selectedVariationCount = selectedVariationIds.size;
  const isMetadataDirty = metadataDraft.isDirty;
  const isMetadataSaveDisabled = !isMetadataDirty || saving;
  useEffect(() => {
    metadataDraftDirtyRef.current = isMetadataDirty;
  }, [isMetadataDirty]);
  const pendingAutoSave = useMemo(
    () =>
      saving ||
      variationOrderSaving ||
      childUploadLoading ||
      bulkAltApplying ||
      bulkDescriptionApplying ||
      descriptionGenerating ||
      displayNameGenerating ||
      Object.keys(altLoadingMap).length > 0 ||
      variationAltBusy,
    [
      altLoadingMap,
      bulkAltApplying,
      bulkDescriptionApplying,
      childUploadLoading,
      descriptionGenerating,
      displayNameGenerating,
      saving,
      variationAltBusy,
      variationOrderSaving
    ]
  );

  useEffect(() => {
    if (!id || typeof window === 'undefined') {
      return;
    }
    const draftKey = `${IMAGE_DETAIL_DRAFT_KEY_PREFIX}${id}`;
    const legacyDraftKey = `${LEGACY_IMAGE_DETAIL_DRAFT_KEY_PREFIX}${id}`;
    try {
      window.sessionStorage.removeItem(legacyDraftKey);
      if (!isMetadataDirty) {
        window.sessionStorage.removeItem(draftKey);
        return;
      }
      const draft: ImageDetailDraft = {
        savedAt: Date.now(),
        hasUnsavedChanges: true,
        folderSelect,
        tagsInput,
        altTextInput,
        descriptionInput,
        originalUrlInput,
        sourceUrlInput,
        displayNameInput,
      };
      window.sessionStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // Ignore storage quota/access failures.
    }
  }, [
    altTextInput,
    descriptionInput,
    displayNameInput,
    folderSelect,
    id,
    isMetadataDirty,
    originalUrlInput,
    sourceUrlInput,
    tagsInput
  ]);

  useEffect(() => {
    setVariationOrderOverride(null);
    setSelectedVariationIds(new Set());
  }, [image?.id]);

  useEffect(() => {
    setVariationPage(1);
  }, [variationLayout]);

  useEffect(() => {
    setVariationPage((prev) => Math.min(prev, totalVariationPages));
  }, [totalVariationPages]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!isMetadataDirty && !pendingAutoSave) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isMetadataDirty, pendingAutoSave]);

  const detailFolderOptions = useMemo(
    () => [
      { value: '', label: '[none]' },
      ...uniqueFolders.map((folder) => ({ value: folder, label: folder })),
      { value: '__create__', label: 'Create new folder…' }
    ],
    [uniqueFolders]
  );

  const adoptFolderOptions = useMemo(
    () => [
      { value: '', label: 'All folders' },
      ...uniqueFolders.map((folder) => ({ value: folder, label: folder }))
    ],
    [uniqueFolders]
  );

  const { shareUrl, shareQrDataUrl, handleCopyUrl, handleCopyText } = useShareLinks({
    imageId: typeof id === 'string' ? id : undefined,
    shareBaseUrl,
    shareVariant,
    toast
  });

  const adjustRotationPreview = useCallback((delta: number) => {
    setPreviewRotation((prev) => prev + delta);
    setRotationError(null);
    setRotatedAsset(null);
  }, []);

  const handleConfirmRotation = useCallback(async () => {
    if (!image) return;
    if (normalizedRotation === 0) {
      setRotationError('Rotate left or right before confirming');
      return;
    }
    setRotationLoading(true);
    setRotationError(null);
    try {
      const response = await fetch(`/api/images/${image.id}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ degrees: normalizedRotation })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to rotate image');
      }
      toast.push('Image rotated and re-uploaded');
      const newId = payload.id || image.id;
      const newUrl = payload.url || '';
      setRotatedAsset({ id: newId, url: newUrl, info: payload.message });
      setPreviewRotation(0);
      await refreshImageList();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Rotation failed';
      setRotationError(message);
    } finally {
      setRotationLoading(false);
    }
  }, [image, normalizedRotation, refreshImageList, toast]);

  const handleCopyList = useCallback(async () => {
    if (!image) {
      toast.push('Image data not ready');
      return;
    }
    const buildEntry = (img: CloudflareImage) => {
      const assetUrl = getAssetCopyUrl(img, { imageVariant: listVariant });
      if (!assetUrl) return null;
      return {
        url: isVideoAsset(img) ? assetUrl : ensureWebpFormat(assetUrl),
        altText: img.altTag || ''
      };
    };
    const entries = [buildEntry(image), ...displayedVariations.map(buildEntry)].filter(
      (entry): entry is { url: string; altText: string } => Boolean(entry)
    );
    if (entries.length === 0) {
      toast.push('No asset URLs available to copy');
      return;
    }
    const payload = formatEntriesAsYaml(entries);
    await handleCopyText(payload, 'Variant list copied');
  }, [displayedVariations, handleCopyText, image, listVariant, toast]);

  const persistVariationOrder = useCallback(
    async (nextOrder: string[], changedIds: string[]) => {
      if (!image) {
        return;
      }
      setVariationOrderOverride(nextOrder);
      setVariationOrderSaving(true);
      try {
        const variationById = new Map(displayedVariations.map((entry) => [entry.id, entry]));
        const indexById = new Map(nextOrder.map((idValue, index) => [idValue, index]));
        const idsToUpdate = hasMissingVariationSort ? nextOrder : changedIds;
        const uniqueIds = Array.from(new Set(idsToUpdate)).filter(
          (idValue) => variationById.get(idValue)?.assetType !== 'video'
        );
        if (uniqueIds.length === 0) {
          setVariationOrderOverride(null);
          return;
        }
        await Promise.all(
          uniqueIds.map((updateId) =>
            fetch(`/api/images/${updateId}/update`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ variationSort: indexById.get(updateId) ?? 0 })
            }).then(async (response) => {
              if (!response.ok) {
                const payload = await response.json();
                throw new Error(payload.error || 'Failed to update variation order');
              }
            })
          )
        );
        const updateMap = new Map(uniqueIds.map((entry) => [entry, indexById.get(entry)]));
        setAllImages((prev) =>
          prev.map((img) =>
            updateMap.has(img.id)
              ? { ...img, variationSort: updateMap.get(img.id) }
              : img
          )
        );
        setVariationOrderOverride(null);
        toast.push('Variation order updated');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update variation order';
        setVariationOrderOverride(null);
        toast.push(message);
      } finally {
        setVariationOrderSaving(false);
      }
    },
    [displayedVariations, hasMissingVariationSort, image, toast]
  );

  const handleMoveVariation = useCallback(
    async (childId: string, direction: -1 | 1) => {
      if (!image || image.parentId) {
        return;
      }
      const child = displayedVariations.find((entry) => entry.id === childId);
      if (!child || child.assetType === 'video') {
        return;
      }
      const currentOrder = displayedVariations.map((child) => child.id);
      const currentIndex = currentOrder.indexOf(childId);
      const targetIndex = currentIndex + direction;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= currentOrder.length) {
        return;
      }
      const nextOrder = [...currentOrder];
      [nextOrder[currentIndex], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[currentIndex]];
      const changedIds = [nextOrder[currentIndex], nextOrder[targetIndex]];
      await persistVariationOrder(nextOrder, changedIds);
    },
    [displayedVariations, image, persistVariationOrder]
  );

  const handleResetVariationOrder = useCallback(async () => {
    if (!image || image.parentId) {
      return;
    }
    const nextOrder = variationCandidates.map((child) => child.id);
    if (!nextOrder.length) {
      return;
    }
    await persistVariationOrder(nextOrder, nextOrder);
  }, [image, persistVariationOrder, variationCandidates]);

  const handleReverseVariationOrder = useCallback(async () => {
    if (!image || image.parentId) {
      return;
    }
    const nextOrder = displayedVariations.map((child) => child.id).reverse();
    if (!nextOrder.length) {
      return;
    }
    await persistVariationOrder(nextOrder, nextOrder);
  }, [displayedVariations, image, persistVariationOrder]);

  const handleSortVariationOrder = useCallback(async () => {
    if (!image || image.parentId) {
      return;
    }
    const nextOrder = [...variationCandidates]
      .sort((a, b) =>
        (a.filename || '').localeCompare(b.filename || '', undefined, {
          numeric: true,
          sensitivity: 'base'
        })
      )
      .map((child) => child.id);
    if (!nextOrder.length) {
      return;
    }
    await persistVariationOrder(nextOrder, nextOrder);
  }, [image, persistVariationOrder, variationCandidates]);

  const handleCancelMetadata = useCallback(() => {
    if (!image) {
      return;
    }
    resetMetadataDraftFromImage(image, extrasRecord);
  }, [extrasRecord, image, resetMetadataDraftFromImage]);

  const handleSaveMetadata = useCallback(async () => {
    if (!image || !id || !isMetadataDirty) {
      return;
    }
    setSaving(true);
    try {
      const payload = buildMetadataSavePayload();
      if (!payload) {
        return;
      }
      const res = await fetch(`/api/images/${id}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json() as ImageMetadataSaveResponse | { error: string };
      if (res.ok && !('error' in body)) {
        setExtrasRecord(prev => ({
          ...prev,
          imageId: id,
          folder: body.folder,
          description: descriptionInput || undefined,
          altText: cleanString(altTextInput) || undefined,
        }));
        toast.push('Metadata updated');
        if (typeof window !== 'undefined') {
          try {
            window.sessionStorage.removeItem(`${IMAGE_DETAIL_DRAFT_KEY_PREFIX}${id}`);
          } catch {
            // Ignore storage access failures.
          }
        }
        const savedImage = applyMetadataSavedResponse(image, body);
        setImage(prev => prev ? applyMetadataSavedResponse(prev, body) : prev);
        setAllImages(prev => prev.map(entry => entry.id === id ? applyMetadataSavedResponse(entry, body) : entry));
        markMetadataSaved(savedImage);
      } else {
        toast.push('error' in body ? body.error : 'Failed to update metadata');
      }
    } catch (err) {
      console.error('Update failed', err);
      toast.push('Failed to update metadata');
    } finally {
      setSaving(false);
    }
  }, [
    altTextInput,
    applyMetadataSavedResponse,
    buildMetadataSavePayload,
    descriptionInput,
    id,
    image,
    isMetadataDirty,
    markMetadataSaved,
    toast
  ]);

  const handleGenerateSemanticTags = useCallback(async () => {
    if (!id) {
      return;
    }
    setTagGenerationLoading(true);
    try {
      const { ok, payload } = await requestSemanticTags(id, tagGenerationCount);
      if (!ok || !payload?.tags?.length) {
        toast.push(payload?.error || 'Failed to generate semantic tags');
        return;
      }
      const existingTags = parseUserTagsInput(tagsInput);
      const mergedTags = mergeUniqueTags(existingTags, payload.tags);
      const finalTags = mergeUserTagsPreservingSystemTags(image?.tags, mergedTags);
      const appendedCount = Math.max(0, mergedTags.length - existingTags.length);
      if (appendedCount === 0) {
        toast.push('No new semantic tags to add');
        return;
      }
      const saveResult = await patchImageMetadata(id, { tags: finalTags });
      if (!saveResult.ok) {
        toast.push(saveResult.payload?.error || 'Failed to save semantic tags');
        return;
      }
      const nextTagsInput = mergedTags.join(', ');
      setTagsInput(nextTagsInput);
      setImage((prev) => (prev && prev.id === id ? { ...prev, tags: finalTags } : prev));
      setAllImages((prev) => prev.map((entry) => (entry.id === id ? { ...entry, tags: finalTags } : entry)));
      toast.push(`Appended ${appendedCount} semantic tag${appendedCount === 1 ? '' : 's'} and saved`);
    } catch (error) {
      console.error('Failed to generate semantic tags:', error);
      toast.push('Failed to generate semantic tags');
    } finally {
      setTagGenerationLoading(false);
    }
  }, [id, image?.tags, setTagsInput, tagGenerationCount, tagsInput, toast]);

  const toggleVariationSelection = useCallback((variationId: string) => {
    setSelectedVariationIds((prev) => {
      const next = new Set(prev);
      if (next.has(variationId)) {
        next.delete(variationId);
      } else {
        next.add(variationId);
      }
      return next;
    });
  }, []);

  const selectAllVariationsOnPage = useCallback(() => {
    setSelectedVariationIds((prev) => {
      const next = new Set(prev);
      pagedVariations.forEach((child) => next.add(child.id));
      return next;
    });
  }, [pagedVariations]);

  const clearVariationSelection = useCallback(() => {
    setSelectedVariationIds(new Set());
  }, []);

  const handleDropVariation = useCallback(
    async (targetId: string) => {
      if (!draggingVariationId || draggingVariationId === targetId) {
        return;
      }
      const draggingVariation = displayedVariations.find((entry) => entry.id === draggingVariationId);
      const targetVariation = displayedVariations.find((entry) => entry.id === targetId);
      if (!draggingVariation || !targetVariation) {
        return;
      }
      if (draggingVariation.assetType === 'video' || targetVariation.assetType === 'video') {
        return;
      }
      const currentOrder = displayedVariations.map((child) => child.id);
      const fromIndex = currentOrder.indexOf(draggingVariationId);
      const toIndex = currentOrder.indexOf(targetId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return;
      }
      const nextOrder = [...currentOrder];
      nextOrder.splice(fromIndex, 1);
      nextOrder.splice(toIndex, 0, draggingVariationId);
      const minIndex = Math.min(fromIndex, toIndex);
      const maxIndex = Math.max(fromIndex, toIndex);
      const changedIds = nextOrder.slice(minIndex, maxIndex + 1);
      await persistVariationOrder(nextOrder, changedIds);
    },
    [displayedVariations, draggingVariationId, persistVariationOrder]
  );

  const handleDetachChild = useCallback(
    async (childId: string) => {
      setChildDetachingId(childId);
      try {
        await patchParentAssignment(childId, '');
        setAllImages((prev) =>
          prev.map((entry) => (entry.id === childId ? { ...entry, parentId: undefined } : entry))
        );
        setSelectedVariationIds((prev) => {
          const next = new Set(prev);
          next.delete(childId);
          return next;
        });
        setVariationPage(1);
        toast.push('Variation detached');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to detach variation';
        toast.push(message);
      } finally {
        setChildDetachingId(null);
      }
    },
    [patchParentAssignment, toast]
  );

  const handleSwapParent = useCallback(
    async (childId: string) => {
      if (!image) return;
      if (image.parentId) {
        toast.push('Open the parent image to swap variants.');
        return;
      }
      if (childId === image.id) return;
      if (!confirm('Make this variation the parent? The current parent will become a variation.')) return;
      const swapAssetCount = variationChildren.length + 1;
      setSwappingParentId(childId);
      toast.push(`Swapping ${swapAssetCount} assets in this family...`);
      try {
        const response = await fetch(`/api/images/${image.id}/swap-parent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newParentId: childId })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to swap parent');
        }
        await refreshImageList();
        if (Array.isArray(payload?.failed) && payload.failed.length > 0) {
          toast.push('Parent swapped with some failures');
        } else {
          toast.push('Parent swapped');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to swap parent';
        toast.push(message);
      } finally {
        setSwappingParentId(null);
      }
    },
    [image, refreshImageList, toast, variationChildren.length]
  );

  const handleDeleteChild = useCallback(async (childId: string) => {
    if (!confirm('Delete this variation permanently?')) return;
    try {
      await requestDeleteImage(childId);
      toast.push('Variation deleted');
      setAllImages(prev => prev.filter(img => img.id !== childId));
      setVariationPage(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete asset';
      toast.push(message);
    }
  }, [toast]);

  const [deletingSelectedVariations, setDeletingSelectedVariations] = useState(false);
  const [detachingAllChildren, setDetachingAllChildren] = useState(false);

  const handleDeleteSelectedVariations = useCallback(async () => {
    const ids = Array.from(selectedVariationIds);
    if (ids.length === 0) {
      toast.push('Select at least one variation');
      return;
    }
    if (!confirm(`Delete ${ids.length} selected variation(s) permanently?`)) return;
    setDeletingSelectedVariations(true);
    let deletedCount = 0;
    const failedIds: string[] = [];
    try {
      for (const idValue of ids) {
        try {
          await requestDeleteImage(idValue);
          deletedCount += 1;
        } catch {
          failedIds.push(idValue);
        }
      }
      if (deletedCount > 0) {
        setAllImages(prev => prev.filter(img => !ids.includes(img.id) || failedIds.includes(img.id)));
        setSelectedVariationIds(prev => {
          const next = new Set(prev);
          ids.forEach(id => { if (!failedIds.includes(id)) next.delete(id); });
          return next;
        });
      }
      if (failedIds.length > 0) {
        toast.push(`Deleted ${deletedCount}, failed ${failedIds.length}`);
      } else {
        toast.push(`Deleted ${deletedCount} variation(s)`);
      }
      setVariationPage(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete variations';
      toast.push(message);
    } finally {
      setDeletingSelectedVariations(false);
    }
  }, [selectedVariationIds, toast]);

  const handleDetachAllChildren = useCallback(async () => {
    if (!image || image.parentId) {
      return;
    }

    const childIds = variationChildren.map((child) => child.id);
    if (childIds.length === 0) {
      toast.push('No variations to detach');
      return;
    }

    if (!confirm(`Detach ${childIds.length} variation(s)? They will become canonical images.`)) {
      return;
    }

    setDetachingAllChildren(true);

    try {
      const response = await fetch(`/api/images/${image.id}/detach-children`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concurrency: 4 })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to detach variations');
      }

      const detachedIds = Array.isArray(payload?.detachedIds)
        ? payload.detachedIds.filter((value: unknown): value is string => typeof value === 'string')
        : [];
      const failureCount = Array.isArray(payload?.failed) ? payload.failed.length : 0;
      const successCount = detachedIds.length;

      if (successCount > 0) {
        setSelectedVariationIds((prev) => {
          const next = new Set(prev);
          detachedIds.forEach((childId: string) => next.delete(childId));
          return next;
        });
      }

      await refreshImageList();
      setVariationPage(1);

      if (failureCount > 0) {
        toast.push(`Detached ${successCount}, failed ${failureCount}`);
      } else if (successCount === 0) {
        toast.push('No variations were detached');
      } else {
        toast.push(`Detached ${successCount} variation(s)`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to detach variations';
      toast.push(message);
    } finally {
      setDetachingAllChildren(false);
    }
  }, [image, refreshImageList, toast, variationChildren]);

  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assigningBulk, setAssigningBulk] = useState(false);

  const handleAssignExistingAsChild = useCallback(async (targetId: string) => {
    setAssigningId(targetId);
    try {
      await patchParentAssignment(targetId, id as string);
      toast.push('Variation assigned');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to assign variation';
      toast.push(message);
    } finally {
      setAssigningId(null);
    }
  }, [id, patchParentAssignment, toast]);

  const handleAssignExistingAsChildren = useCallback(async (targetIds: string[]) => {
    if (!id) return;
    const uniqueIds = Array.from(new Set(targetIds.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    setAssigningBulk(true);
    setAssigningId(null);

    let successCount = 0;
    const failures: Array<{ id: string; error: string }> = [];
    const concurrency = 3;
    let cursor = 0;

    const workers = Array.from({ length: Math.min(concurrency, uniqueIds.length) }).map(async () => {
      while (cursor < uniqueIds.length) {
        const current = uniqueIds[cursor];
        cursor += 1;
        try {
          await patchParentAssignmentService(current, id as string);
          successCount += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to assign variation';
          failures.push({ id: current, error: message });
        }
      }
    });

    try {
      await Promise.all(workers);
      await refreshImageList();

      if (failures.length > 0) {
        const first = failures[0];
        toast.push(`Assigned ${successCount}, failed ${failures.length} (first: ${first.id})`);
      } else {
        toast.push(`Assigned ${successCount} variation(s)`);
      }
    } finally {
      setAssigningBulk(false);
    }
  }, [id, refreshImageList, toast]);


  const handleFolderManagerChange = useCallback(async () => {
    await refreshImageList();
  }, [refreshImageList]);

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

  const shouldCalculateDetailAspect =
    Boolean(image?.id) && (!image?.dimensions || !image?.aspectRatio);
  const {
    aspectRatio: computedDetailAspect,
    dimensions: computedDetailDimensions,
    loading: detailAspectLoading,
  } = useImageAspectRatio(image?.id ?? '', shouldCalculateDetailAspect);
  const detailAspectRatio = image?.aspectRatio ?? computedDetailAspect;
  const detailDimensions = image?.dimensions ?? computedDetailDimensions;
  const detailFileSizeBytes = image?.size ?? image?.fileSizeBytes ?? null;
  const detailFileSizeLabel = formatBytes(detailFileSizeBytes);

  if (!id) {
    return (
      <div className="p-6">
        <p className="text-xs text-red-500">Image ID is missing.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  if (!image) {
    return (
      <div className="p-6">
        <p className="text-xl font-semibold">Image not found</p>
        <p className="text-xs text-gray-500">Could not fetch image metadata from server.</p>
      </div>
    );
  }

  const showAnimationRepair = isAnimatedWebpAsset(image);

  return (
    <div id="image-detail-page" className="p-6 relative">
      <div id="image-detail-container" className="max-w-5xl mx-auto bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-6">
          <ImageDetailNavigation
            image={image}
            familyLoaded={familyLoaded}
            familyVariantSequenceLength={familyVariantSequence.length}
            familyVariantIndex={familyVariantIndex}
            prevFamilyVariantId={prevFamilyVariantId}
            nextFamilyVariantId={nextFamilyVariantId}
            galleryResultIdsLength={galleryResultIds.length}
            galleryResultIndex={galleryResultIndex}
            prevGalleryImageId={prevGalleryImageId}
            nextGalleryImageId={nextGalleryImageId}
            onBackToGallery={handleBackToGallery}
            onShowInGalleryOrder={handleShowInGalleryOrder}
            onShowInNamespace={handleShowInNamespace}
            onNavigateAsset={commitAssetNavigation}
          />
          <ImageHeroSection
            image={image}
            originalDeliveryUrl={originalDeliveryUrl}
            heroRotationStyle={heroRotationStyle}
            normalizedRotation={normalizedRotation}
            rotationLoading={rotationLoading}
            rotationError={rotationError}
            rotatedAsset={rotatedAsset}
            onDragStart={handleImageDragStart}
            onAdjustRotation={adjustRotationPreview}
            onConfirmRotation={handleConfirmRotation}
            onCopyText={handleCopyText}
          />

          {showAnimationRepair && (
            <AnimationRepairSection
              image={image}
              loading={animationRepairLoading}
              error={animationRepairError}
              onReverse={(replaceOriginal) => void handleReverseAnimation(replaceOriginal)}
            />
          )}

          <ImageSummarySection
            image={image}
            pendingEmbedding={pendingEmbedding}
            embeddingGenerating={embeddingGenerating}
            namespace={namespace}
            semanticSearchAllNamespaces={semanticSearchAllNamespaces}
            deleteFamilyOpen={deleteFamilyOpen}
            deleteFamilyStatus={deleteFamilyStatus}
            listVariant={listVariant}
            onGenerateEmbeddings={generateEmbeddings}
            onSelectColor={handleColorSearchNavigation}
            onCopyText={handleCopyText}
            onSemanticScopeChange={setSemanticSearchAllNamespaces}
            onCloseDeleteFamilyModal={closeDeleteFamilyModal}
            onCommitNavigation={commitNavigation}
            onToast={toast.push}
          />

          <div id="image-metadata-section" className="space-y-4">
            <ImageDetailMetadataPanel
              image={image} favorite={hasFavoriteTag(image.tags)} favoriteLoading={favoriteLoading}
              metadataByteSize={metadataByteSize} metadataPrunedByteSize={metadataPrunedByteSize}
              metadataLargestFields={metadataLargestFields} metadataPrunedDroppedFields={metadataPrunedDroppedFields}
              extrasBackedFields={[...CLOUDFLARE_EXTRAS_ONLY_FIELDS, 'altText']}
              isMetadataDirty={isMetadataDirty} pendingAutoSave={pendingAutoSave} saving={saving}
              detailAspectLoading={detailAspectLoading} detailDimensions={detailDimensions}
              detailAspectRatio={detailAspectRatio} detailFileSizeLabel={detailFileSizeLabel}
              detailNamespaceOptions={detailNamespaceOptions} namespaceMoving={namespaceMoving}
              descriptionInput={descriptionInput} descriptionGenerating={descriptionGenerating}
              hasVariations={hasVariations} bulkDescriptionApplying={bulkDescriptionApplying}
              altTextInput={altTextInput} altLoading={Boolean(altLoadingMap[image.id])} bulkAltApplying={bulkAltApplying}
              promptThisInput={promptThisInput} promptThisLoading={promptThisLoading}
              promptThisGenerating={promptThisGenerating} promptThisSaving={promptThisSaving}
              promptThisMeta={promptThisMeta} comfyWorkflow={extrasRecord?.comfyWorkflow ?? null}
              folderEditorProps={{
                folderSelect, newFolderInput, detailFolderOptions, hasVariations, bulkFolderApplying,
                effectiveParentFolder, tagsInput, tagGenerationCount, tagGenerationLoading, parentTags,
                bulkTagsAppending, bulkTagsReplacing, displayNameInput, displayNameGenerating,
                immutableFilename: image?.filename || 'Unknown',
                onFolderSelectChange: setFolderSelect, onNewFolderInputChange: setNewFolderInput,
                onFoldersChanged: handleFolderManagerChange, onApplyFolderToVariations: applyFolderToVariations,
                onTagsInputChange: setTagsInput, onTagGenerationCountChange: setTagGenerationCount,
                onGenerateSemanticTags: handleGenerateSemanticTags, onApplyTagsToVariations: applyTagsToVariations,
                onDisplayNameInputChange: setDisplayNameInput, onGenerateDisplayName: generateDisplayName,
              }}
              originalUrlInput={originalUrlInput} originalUrlTooLong={originalUrlTooLong}
              originalUrlByteLength={originalUrlByteLength} originalDeliveryUrl={originalDeliveryUrl}
              sourceUrlInput={sourceUrlInput} shareBaseUrl={shareBaseUrl} shareVariant={shareVariant}
              shareVariantOptions={shareVariantOptions} shareUrl={shareUrl} shareQrDataUrl={shareQrDataUrl}
              exifEntries={exifEntries} variants={variants}
              imageDownloadName={displayNameInput.trim() || image.displayName || image.filename}
              onToggleFavorite={handleToggleFavorite} onDiscard={handleCancelMetadata} onSave={handleSaveMetadata}
              onCreateNamespace={registerDetailNamespace} onMoveNamespace={handleMoveFamilyNamespace}
              onDescriptionInputChange={setDescriptionInput} onGenerateDescription={generateDescription}
              onApplyDescriptionToVariations={applyDescriptionToVariations} onAltTextInputChange={setAltTextInput}
              onGenerateAlt={generateAltTag} onApplyAltToVariations={applyAltToVariations}
              onPromptThisInputChange={setPromptThisInput} onGeneratePromptThis={generatePromptThis}
              onCopyText={handleCopyText}
              onOriginalUrlInputChange={setOriginalUrlInput} onSourceUrlInputChange={setSourceUrlInput}
              onShareBaseUrlChange={setShareBaseUrl} onShareVariantChange={setShareVariant}
              getVariantWidthLabel={getVariantWidthLabel} onCopyVariantUrl={handleCopyUrl}
            />

            <div className="space-y-4">
              <VariationsSection
                isChildImage={isChildImage}
                variationCount={variationCount}
                variationLayout={variationLayout}
                setVariationLayout={setVariationLayout}
                variationTrueAspect={variationTrueAspect}
                setVariationTrueAspect={setVariationTrueAspect}
                listVariant={listVariant}
                setListVariant={setListVariant}
                listVariantOptions={listVariantOptions}
                onCopyList={handleCopyList}
                onCreateCropVariant={!isChildImage ? () => setCropVariantOpen(true) : undefined}
                variationCandidatesLength={variationCandidates.length}
                variationOrderSaving={variationOrderSaving}
                onResetVariationOrder={handleResetVariationOrder}
                onReverseVariationOrder={handleReverseVariationOrder}
                onSortVariationOrder={handleSortVariationOrder}
                onDeleteParent={handleDeleteParent}
                onDeleteFamily={handleDeleteFamily}
                selectedVariationCount={selectedVariationCount}
                onSelectAllOnPage={selectAllVariationsOnPage}
                onClearSelection={clearVariationSelection}
                onGenerateAltForSelected={generateAltForSelectedVariations}
                variationAltBusy={variationAltBusy}
                onDeleteSelectedVariations={handleDeleteSelectedVariations}
                deletingSelectedVariations={deletingSelectedVariations}
                pagedVariations={pagedVariations}
                displayedVariations={displayedVariations}
                variationOrderIndex={variationOrderIndex}
                selectedVariationIds={selectedVariationIds}
                toggleVariationSelection={toggleVariationSelection}
                dragOverVariationId={dragOverVariationId}
                setDraggingVariationId={setDraggingVariationId}
                setDragOverVariationId={setDragOverVariationId}
                onDropVariation={handleDropVariation}
                onMoveVariation={handleMoveVariation}
                onHandleThumbMouseMove={handleThumbMouseMove}
                onHandleThumbLeave={handleThumbLeave}
                onHandleImageDragStart={handleImageDragStart}
                onHandleCopyUrl={handleCopyUrl}
                onCopyVariationId={(variationId) => handleCopyText(variationId, 'Asset ID copied')}
                onOpenVariantSizes={(target) => setVariantModalState({ target })}
                childDetachingId={childDetachingId}
                detachingAllChildren={detachingAllChildren}
                onDetachChild={handleDetachChild}
                onDetachAllChildren={handleDetachAllChildren}
                onDeleteChild={handleDeleteChild}
                swappingParentId={swappingParentId}
                swapParentAssetCount={variationChildren.length + 1}
                onSwapParent={handleSwapParent}
                AspectRatioDisplay={AspectRatioDisplay}
                variationPage={variationPage}
                setVariationPage={setVariationPage}
                totalVariationPages={totalVariationPages}
                variationPageSize={variationPageSize}
              />

              {!image.parentId ? (
                <>
                  <AdoptVariationSection
                    adoptSearch={adoptSearch}
                    setAdoptSearch={setAdoptSearch}
                    adoptFolderFilter={adoptFolderFilter}
                    setAdoptFolderFilter={setAdoptFolderFilter}
                    adoptFolderOptions={adoptFolderOptions}
                    adoptScope={adoptScope}
                    setAdoptScope={setAdoptScope}
                    adoptScopeOptions={adoptScopeOptions}
                    adoptAssetTypeFilter={adoptAssetTypeFilter}
                    setAdoptAssetTypeFilter={setAdoptAssetTypeFilter}
                    adoptAssetTypeOptions={adoptAssetTypeOptions}
                    filteredAssignmentCandidates={filteredAssignmentCandidates}
                    pagedAssignmentCandidates={pagedAssignmentCandidates}
                    adoptPage={adoptPage}
                    setAdoptPage={setAdoptPage}
                    totalAdoptPages={totalAdoptPages}
                    adoptPageSize={ADOPT_PAGE_SIZE}
                    adoptPageStart={adoptPageStart}
                    adoptPageEnd={adoptPageEnd}
                    assignmentCandidatesLoading={candidatePoolLoading || (!candidatePoolLoaded && !candidatePoolFailed)}
                    onHandleThumbMouseMove={handleThumbMouseMove}
                    onHandleThumbLeave={handleThumbLeave}
                    onHandleImageDragStart={handleImageDragStart}
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
                    fallbackFolder={image.folder || ''}
                    fallbackTags={visibleImageTags}
                    childUploadItems={childUploadItems}
                    onUpdateSelectedFilename={updateChildUploadFilename}
                    onClearSelectedFiles={clearChildUploadFiles}
                    onUpload={handleChildUpload}
                    childUploadLoading={childUploadLoading}
                    childUploadUrl={childUploadUrl}
                    childUploadUrlFilename={childUploadUrlFilename}
                    onChildUploadUrlChange={setChildUploadUrl}
                    onChildUploadUrlFilenameChange={setChildUploadUrlFilename}
                    onUploadUrl={handleChildUploadByUrl}
                    childUploadUrlLoading={childUploadUrlLoading}
                    childImportUrl={childImportUrl}
                    childImportLoading={childImportLoading}
                    childImportError={childImportError}
                    onChildImportUrlChange={setChildImportUrl}
                    onImportFromUrl={handleImportFromUrl}
                  />
                </>
              ) : resolvedParentImage ? (
                <VariantLockedState
                  parentImage={resolvedParentImage}
                  parentActionLoading={parentActionLoading}
                  reassignParentId={reassignParentId}
                  setReassignParentId={setReassignParentId}
                  reassignParentOptions={reassignParentOptions}
                  currentParentId={image.parentId ?? ''}
                  onDetach={handleDetachFromParent}
                  onUpdateParent={handleReassignParent}
                  getCloudflareImageUrl={getCloudflareImageUrl}
                  onThumbMouseMove={handleThumbMouseMove}
                  onThumbMouseLeave={handleThumbLeave}
                />
              ) : null}

              <ImageToolsPanel
                imageId={image.id}
                sourcePreviewUrl={imageToolSourcePreviewUrl}
                sourceLabel={image.filename || image.id}
                onRunComplete={refreshImageList}
              />
          </div>
        </div>

        <ImageDetailFooterActions
          saving={saving} isMetadataSaveDisabled={isMetadataSaveDisabled}
          showDeleteFamily={variationCount > 0 || isChildImage}
          onCancel={handleCancelMetadata} onDeleteImage={handleDeleteCurrent}
          onDeleteFamily={handleDeleteFamily} onSave={handleSaveMetadata}
        />
        </div>
      </div>
      {variantModalState && (
        <VariantSizeModal
          target={variantModalState.target}
          fallbackImage={image}
          onClose={() => setVariantModalState(null)}
          onCopyUrl={handleCopyUrl}
          onToast={toast.push}
        />
      )}
      {cropVariantOpen && image && (
        <CropVariantModal
          image={image}
          previewUrl={imageToolSourcePreviewUrl}
          onClose={() => setCropVariantOpen(false)}
          onCreated={handleCropVariantCreated}
        />
      )}
      {hoverPreview && <HoverPreviewOverlay preview={hoverPreview} />}
    </div>
  );
}
