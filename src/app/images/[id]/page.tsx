"use client";

import React, { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { getMultipleImageUrls, getCloudflareImageUrl, getCloudflareDownloadUrl, IMAGE_VARIANTS } from '@/utils/imageUtils';
import {
  getAssetCopyUrl,
  getAssetPreviewUrl,
  isVideoAsset,
} from '@/utils/assetUrls';
import { useToast } from '@/components/Toast';
import { Sparkles, RotateCcw, RotateCw, ChevronUp, ChevronDown, GripVertical, ExternalLink, Cpu, ChevronLeft, ChevronRight } from 'lucide-react';
import FolderManagerButton from '@/components/FolderManagerButton';
import MonoSelect from '@/components/MonoSelect';
import EmbeddingStatusIcon from '@/components/EmbeddingStatusIcon';
import ConceptRadar from '@/components/ConceptRadar';
import SemanticNeighbors from '@/components/SemanticNeighbors';
import HaikuDisplay from '@/components/HaikuDisplay';
import AntipodeSearch from '@/components/AntipodeSearch';
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
import { downloadImageToFile, formatDownloadFileName } from '@/utils/downloadUtils';
import { useImageAspectRatio } from '@/hooks/useImageAspectRatio';
import { formatBytes } from '@/utils/formatBytes';
import { ColorSwatches } from '@/components/ColorSwatches';
import { normalizeColorSearchHex } from '@/components/gallery/colorSearch';

import { AltTextEditor } from '@/components/image-detail/AltTextEditor';
import { CloudflareMetadataHeader } from '@/components/image-detail/CloudflareMetadataHeader';
import { DescriptionEditor } from '@/components/image-detail/DescriptionEditor';
import { PromptThisEditor } from '@/components/image-detail/PromptThisEditor';
import { ComfyWorkflowPanel, type ComfyWorkflowRecord } from '@/components/image-detail/comfy';
import { ExifSection } from '@/components/image-detail/ExifSection';
import { OriginalUrlSection } from '@/components/image-detail/OriginalUrlSection';
import { ShareSection } from '@/components/image-detail/ShareSection';
import { SourceUrlSection } from '@/components/image-detail/SourceUrlSection';
import { VariantLinksSection } from '@/components/image-detail/VariantLinksSection';
import { VariationsSection } from '@/components/image-detail/VariationsSection';
import { AdoptVariationSection } from '@/components/image-detail/AdoptVariationSection';
import { UploadVariationSection } from '@/components/image-detail/UploadVariationSection';
import { VARIATION_UPLOAD_ACCEPT } from '@/components/image-detail/variationUploadConfig';
import { ParentInfoSection } from '@/components/image-detail/ParentInfoSection';
import {
  resolveInitialAltText,
  resolveInitialDescription,
} from '@/components/image-detail/metadataValueResolvers';

import { useParentReassignment } from '@/hooks/useParentReassignment';
import { useVariationUpload } from '@/hooks/useVariationUpload';
import { useParentAssignment } from '@/hooks/useParentAssignment';
import { useBulkVariationMetadata } from '@/hooks/useBulkVariationMetadata';
import { useAltDescriptionGeneration } from '@/hooks/useAltDescriptionGeneration';
import { useDeleteImageFamily } from '@/hooks/useDeleteImageFamily';
import { useShareLinks } from '@/hooks/useShareLinks';
import { patchParentAssignment as patchParentAssignmentService } from '@/services/parentAssignmentService';
import { usePersistentShareBaseUrl } from '@/hooks/usePersistentShareBaseUrl';
import { requestSemanticTags } from '@/services/imageAltDescriptionService';
import { patchImageMetadata } from '@/services/imageMetadataService';
import {
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

interface CloudflareImage {
  id: string;
  assetType?: 'image' | 'video';
  filename: string;
  displayName?: string;
  uploaded: string;
  size?: number;
  fileSizeBytes?: number | null;
  variants?: string[];
  folder?: string;
  tags?: string[];
  description?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  namespace?: string;
  contentHash?: string;
  altTag?: string;
  exif?: Record<string, string | number>;
  aspectRatio?: string;
  dimensions?: { width: number; height: number };
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
  parentId?: string;
  linkedAssetId?: string;
  variationSort?: number;
  videoStatus?: 'pending' | 'ready' | 'error';
  videoDurationSeconds?: number;
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
  // Embedding status fields
  hasClipEmbedding?: boolean;
  hasColorEmbedding?: boolean;
  dominantColors?: string[];
  averageColor?: string;
}

const DEFAULT_LIST_VARIANT = 'full';
const IMAGE_DETAIL_DRAFT_KEY_PREFIX = 'imageDetailDraftV1:';
const IMAGE_DETAIL_DRAFT_TTL_MS = 6 * 60 * 60 * 1000;
const VARIANT_DIMENSIONS = new Map(IMAGE_VARIANTS.map(variant => [variant.name, variant.width]));

type BulkUpdateFailure = {
  id: string;
  name: string;
  error?: string;
  reason?: 'metadata' | 'network' | 'unknown';
};

type ImageDetailDraft = {
  savedAt: number;
  folderSelect: string;
  tagsInput: string;
  altTextInput: string;
  descriptionInput: string;
  originalUrlInput: string;
  sourceUrlInput: string;
  displayNameInput: string;
  clearExif: boolean;
};

const ensureWebpFormat = (inputUrl: string) => {
  const parts = inputUrl.split('?');
  const base = parts[0];
  const params = new URLSearchParams(parts[1] || '');
  params.set('format', 'webp');
  return `${base}?${params.toString()}`;
};
const getVariantWidthLabel = (variant: string) => {
  const width = VARIANT_DIMENSIONS.get(variant);
  if (!width) {
    return null;
  }
  return `${width}px`;
};

const isMetadataLimitError = (message?: string) => {
  if (!message) return false;
  const lowered = message.toLowerCase();
  return (
    lowered.includes('metadata') &&
    (lowered.includes('too large') ||
      lowered.includes('size') ||
      lowered.includes('limit') ||
      lowered.includes('exceed') ||
      lowered.includes('maximum'))
  );
};

const formatFailureNames = (failures: BulkUpdateFailure[]) => {
  const names = failures.map((failure) => failure.name);
  const preview = names.slice(0, 3).join(', ');
  if (names.length <= 3) {
    return preview;
  }
  return `${preview} +${names.length - 3} more`;
};

const formatEntriesAsYaml = (entries: { url: string; altText: string }[]) => {
  const lines = ['imagesFromGridDirectory:'];
  entries.forEach((entry) => {
    lines.push(`  - url: ${entry.url}`);
    lines.push(`    altText: ${JSON.stringify(entry.altText ?? '')}`);
  });
  return lines.join('\n');
};

const MAX_CLOUDFLARE_TEXT_MIRROR_CHARS = 160;
const toCloudflareTextMirror = (value?: string) => {
  if (!value) return '';
  const compact = value.trim();
  if (!compact) return '';
  return compact.length <= MAX_CLOUDFLARE_TEXT_MIRROR_CHARS
    ? compact
    : `${compact.slice(0, MAX_CLOUDFLARE_TEXT_MIRROR_CHARS)}…`;
};

const mergeUniqueTags = (existingTags: string[], incomingTags: string[]) => {
  const merged = new Map<string, string>();
  existingTags.forEach((tag) => {
    const normalized = tag.trim().toLowerCase();
    if (normalized) {
      merged.set(normalized, tag.trim());
    }
  });
  incomingTags.forEach((tag) => {
    const trimmed = tag.trim();
    const normalized = trimmed.toLowerCase();
    if (normalized && !merged.has(normalized)) {
      merged.set(normalized, trimmed);
    }
  });
  return Array.from(merged.values());
};

const mergeUniqueImagesById = (base: CloudflareImage[], incoming: CloudflareImage[]) => {
  const merged = new Map<string, CloudflareImage>();
  base.forEach((entry) => merged.set(entry.id, entry));
  incoming.forEach((entry) => {
    const existing = merged.get(entry.id);
    merged.set(entry.id, existing ? { ...existing, ...entry } : entry);
  });
  return Array.from(merged.values());
};

const sortFamilyMembers = (items: CloudflareImage[]) => {
  const hasSort = items.some((item) => Number.isFinite(item.variationSort));
  if (!hasSort) {
    return [...items].sort((a, b) => {
      const aUploaded = Date.parse(a.uploaded);
      const bUploaded = Date.parse(b.uploaded);
      const aTime = Number.isFinite(aUploaded) ? aUploaded : 0;
      const bTime = Number.isFinite(bUploaded) ? bUploaded : 0;
      if (aTime !== bTime) {
        return aTime - bTime;
      }
      return a.id.localeCompare(b.id);
    });
  }

  const fallbackIndex = new Map(
    [...items]
      .sort((a, b) => {
        const aUploaded = Date.parse(a.uploaded);
        const bUploaded = Date.parse(b.uploaded);
        const aTime = Number.isFinite(aUploaded) ? aUploaded : 0;
        const bTime = Number.isFinite(bUploaded) ? bUploaded : 0;
        if (aTime !== bTime) {
          return aTime - bTime;
        }
        return a.id.localeCompare(b.id);
      })
      .map((item, index) => [item.id, index])
  );

  return [...items].sort((a, b) => {
    const aSort = Number.isFinite(a.variationSort) ? (a.variationSort as number) : null;
    const bSort = Number.isFinite(b.variationSort) ? (b.variationSort as number) : null;
    if (aSort === null && bSort === null) {
      return (fallbackIndex.get(a.id) ?? 0) - (fallbackIndex.get(b.id) ?? 0);
    }
    if (aSort === null) return 1;
    if (bSort === null) return -1;
    if (aSort !== bSort) return aSort - bSort;
    return (fallbackIndex.get(a.id) ?? 0) - (fallbackIndex.get(b.id) ?? 0);
  });
};

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

  const [image, setImage] = useState<CloudflareImage | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [adoptImageId, setAdoptImageId] = useState('');
  const [childDetachingId, setChildDetachingId] = useState<string | null>(null);
  const [swappingParentId, setSwappingParentId] = useState<string | null>(null);
  const [adoptLoading, setAdoptLoading] = useState(false);
  const [adoptSearch, setAdoptSearch] = useState('');
  const [adoptFolderFilter, setAdoptFolderFilter] = useState('');
  const [adoptAssetTypeFilter, setAdoptAssetTypeFilter] = useState<'' | 'image' | 'video'>('');
  const [variationPage, setVariationPage] = useState(1);
  const [variationLayout, setVariationLayout] = useState<'list' | 'grid'>('list');
  const [variationTrueAspect, setVariationTrueAspect] = useState(true);
  const [adoptPage, setAdoptPage] = useState(1);
  const [listVariant, setListVariant] = useState(DEFAULT_LIST_VARIANT);
  const LIST_VARIATION_PAGE_SIZE = 25;
  const GRID_VARIATION_PAGE_SIZE = 36;
  const ADOPT_PAGE_SIZE = 12;
  const [hoverPreview, setHoverPreview] = useState<{
    url: string;
    label: string;
    x: number;
    y: number;
  } | null>(null);

  const [folderSelect, setFolderSelect] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [altTextInput, setAltTextInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [promptThisInput, setPromptThisInput] = useState('');
  const [promptThisLoading, setPromptThisLoading] = useState(false);
  const [promptThisGenerating, setPromptThisGenerating] = useState(false);
  const [promptThisSaving, setPromptThisSaving] = useState(false);
  const [lastSavedPromptThis, setLastSavedPromptThis] = useState<string>('');
  const [promptThisMeta, setPromptThisMeta] = useState<{ saved?: boolean; updatedAt?: string; model?: string } | null>(null);
  const [originalUrlInput, setOriginalUrlInput] = useState('');
  const [sourceUrlInput, setSourceUrlInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [tagGenerationCount, setTagGenerationCount] = useState(6);
  const [tagGenerationLoading, setTagGenerationLoading] = useState(false);
  const [clearExif, setClearExif] = useState(false);
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
  const [extrasLoading, setExtrasLoading] = useState(false);
  const [shareVariant, setShareVariant] = useState('large');
  const [namespace, setNamespace] = useState('');
  const [saving, setSaving] = useState(false);
  const [embeddingPendingMap, setEmbeddingPendingMap] = useState<Record<string, EmbeddingPendingEntry>>({});
  const [uniqueFolders, setUniqueFolders] = useState<string[]>([]);
  const [newFolderInput, setNewFolderInput] = useState('');
  const [variantModalState, setVariantModalState] = useState<{ target: CloudflareImage } | null>(null);
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
      found && extrasRecord?.imageId === found.id ? extrasRecord : null;
    setImage(found);
    if (found) {
      setFolderSelect(found.folder || '');
      setTagsInput(Array.isArray(found.tags) ? found.tags.join(', ') : '');
      setDescriptionInput(resolveInitialDescription(extrasForCurrentImage, found));
      setAltTextInput(resolveInitialAltText(extrasForCurrentImage, found));
      setOriginalUrlInput(found.originalUrl || '');
      setSourceUrlInput(found.sourceUrl || '');
      setDisplayNameInput(found.displayName || found.filename || '');
      setReassignParentId(found.parentId || '');
      setClearExif(false);

      if (typeof window !== 'undefined') {
        const draftKey = `${IMAGE_DETAIL_DRAFT_KEY_PREFIX}${found.id}`;
        try {
          const raw = window.sessionStorage.getItem(draftKey);
          if (raw) {
            const parsed = JSON.parse(raw) as Partial<ImageDetailDraft>;
            const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
            const isFresh = savedAt > 0 && Date.now() - savedAt < IMAGE_DETAIL_DRAFT_TTL_MS;
            if (isFresh && draftAppliedRef.current !== found.id) {
              if (typeof parsed.folderSelect === 'string') setFolderSelect(parsed.folderSelect);
              if (typeof parsed.tagsInput === 'string') setTagsInput(parsed.tagsInput);
              if (typeof parsed.descriptionInput === 'string') setDescriptionInput(parsed.descriptionInput);
              if (typeof parsed.altTextInput === 'string') setAltTextInput(parsed.altTextInput);
              if (typeof parsed.originalUrlInput === 'string') setOriginalUrlInput(parsed.originalUrlInput);
              if (typeof parsed.sourceUrlInput === 'string') setSourceUrlInput(parsed.sourceUrlInput);
              if (typeof parsed.displayNameInput === 'string') setDisplayNameInput(parsed.displayNameInput);
              if (typeof parsed.clearExif === 'boolean') setClearExif(parsed.clearExif);
              draftAppliedRef.current = found.id;
            }
          }
        } catch {
          // Ignore malformed draft payloads.
        }
      }
    } else {
      setFolderSelect('');
      setTagsInput('');
      setDescriptionInput('');
      setAltTextInput('');
      setOriginalUrlInput('');
      setSourceUrlInput('');
      setDisplayNameInput('');
      setReassignParentId('');
    }
  }, [extrasRecord]);

  const mergeContextImages = useCallback((imagesData: CloudflareImage[]) => {
    setAllImages((prev) => {
      const nextImages = mergeUniqueImagesById(prev, imagesData);
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

  useEffect(() => {
    setVariationPage(1);
  }, [image?.id, image?.parentId]);

  useEffect(() => {
    setLoading(true);
    setFamilyLoaded(false);
    setImage(null);
    setAllImages([]);
    setUniqueFolders([]);
    setFallbackParentImage(null);
    candidatePoolLoadedRef.current = false;
  }, [id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('imageNamespace');
    const envDefault = process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
    if (stored === '__none__') {
      setNamespace('');
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

  // Clear stale pending embedding status if the image already has embeddings
  useEffect(() => {
    if (image?.id && (image.hasClipEmbedding || image.hasColorEmbedding)) {
      clearPendingIfHasEmbeddings(image.id, image.hasClipEmbedding, image.hasColorEmbedding);
    }
  }, [image?.id, image?.hasClipEmbedding, image?.hasColorEmbedding]);

  useEffect(() => {
    if (!id || typeof window === 'undefined') {
      return;
    }
    const draft: ImageDetailDraft = {
      savedAt: Date.now(),
      folderSelect,
      tagsInput,
      altTextInput,
      descriptionInput,
      originalUrlInput,
      sourceUrlInput,
      displayNameInput,
      clearExif,
    };
    const hasMeaningfulDraft =
      Boolean(
        folderSelect ||
          tagsInput ||
          altTextInput ||
          descriptionInput ||
          originalUrlInput ||
          sourceUrlInput ||
          displayNameInput
      ) ||
      clearExif;
    const draftKey = `${IMAGE_DETAIL_DRAFT_KEY_PREFIX}${id}`;
    try {
      if (!hasMeaningfulDraft) {
        window.sessionStorage.removeItem(draftKey);
        return;
      }
      window.sessionStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // Ignore storage quota/access failures.
    }
  }, [
    altTextInput,
    clearExif,
    descriptionInput,
    displayNameInput,
    folderSelect,
    id,
    originalUrlInput,
    sourceUrlInput,
    tagsInput
  ]);

  const refreshImageList = useCallback(async () => {
    if (!id) {
      return;
    }
    const startedAt = getNow();
    try {
      const [imageResponse, familyResponse] = await Promise.all([
        fetch(`/api/images/${encodeURIComponent(id)}`),
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
        ] as CloudflareImage[];
        mergeContextImages(incoming);
        if (Array.isArray(familyData?.candidateAssets)) {
          candidatePoolLoadedRef.current = true;
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
    imageTags: image?.tags,
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
        setLoading(true);
        if (!id) {
          return;
        }
        const res = await fetch(`/api/images/${encodeURIComponent(id)}`);
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

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    candidatePoolLoadedRef.current = false;
    const useIdleCallback = typeof window !== 'undefined' && 'requestIdleCallback' in window;
    const scheduler = useIdleCallback
      ? window.requestIdleCallback(async () => {
          try {
            const startedAt = getNow();
            const res = await fetch(buildFamilyContextUrl({ includeCandidates: true }));
            const data = await res.json();
            if (!mounted || !res.ok) return;
            const candidates = Array.isArray(data.candidateAssets) ? (data.candidateAssets as CloudflareImage[]) : [];
            mergeContextImages(candidates);
            candidatePoolLoadedRef.current = true;
            logDetailPerf('candidateFetch:total', startedAt, {
              serverTiming: res.headers.get('server-timing'),
              diagnostics: data?.diagnostics ?? null,
              candidateCount: candidates.length,
            });
          } catch (error) {
            console.error('Failed to fetch candidate assets', error);
          }
        })
      : window.setTimeout(async () => {
          try {
            const startedAt = getNow();
            const res = await fetch(buildFamilyContextUrl({ includeCandidates: true }));
            const data = await res.json();
            if (!mounted || !res.ok) return;
            const candidates = Array.isArray(data.candidateAssets) ? (data.candidateAssets as CloudflareImage[]) : [];
            mergeContextImages(candidates);
            candidatePoolLoadedRef.current = true;
            logDetailPerf('candidateFetch:total', startedAt, {
              serverTiming: res.headers.get('server-timing'),
              diagnostics: data?.diagnostics ?? null,
              candidateCount: candidates.length,
            });
          } catch (error) {
            console.error('Failed to fetch candidate assets', error);
          }
        }, 0);
    return () => {
      mounted = false;
      if (useIdleCallback && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(scheduler);
      } else {
        window.clearTimeout(scheduler as number);
      }
    };
  }, [buildFamilyContextUrl, id, mergeContextImages]);

  // Fetch Image Extras (description/altText) from Redis/file storage with Cloudflare fallback
  useEffect(() => {
    if (!id) {
      setExtrasRecord(null);
      return;
    }
    let mounted = true;
    setExtrasLoading(true);
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
        if (data.record && Object.prototype.hasOwnProperty.call(data.record, 'description')) {
          setDescriptionInput(data.record.description ?? '');
        }
        if (data.record && Object.prototype.hasOwnProperty.call(data.record, 'altText')) {
          setAltTextInput(data.record.altText ?? '');
        }
        logDetailPerf('extrasFetch:total', startedAt, {
          jsonParseMs: jsonElapsedMs,
          hasRecord: Boolean(data.record),
        });
      } catch (err) {
        console.error('Failed to fetch image extras', err);
        // On error, keep the current image metadata values already loaded from /api/images/[id].
        if (mounted) setExtrasRecord(null);
      } finally {
        if (mounted) setExtrasLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

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

  const { parentImage, adoptableImages, reassignParentOptions } = useParentReassignment({
    allImages,
    currentImage: image,
    excludeId: id
  });
  const resolvedParentImage = parentImage ?? fallbackParentImage;

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

  const filteredAdoptableImages = useMemo(() => {
    const base = adoptableImages.filter((img) => {
      if (!adoptFolderFilter) return true;
      return (img.folder || '').toLowerCase() === adoptFolderFilter.toLowerCase();
    });
    const typeFiltered = base.filter((img) => {
      if (!adoptAssetTypeFilter) return true;
      if (adoptAssetTypeFilter === 'video') return isVideoAsset(img);
      return !isVideoAsset(img);
    });

    if (!adoptSearch.trim()) {
      return typeFiltered;
    }

    const term = adoptSearch.toLowerCase();
    return typeFiltered.filter((img) => {
      if ((img.id || '').toLowerCase().includes(term)) {
        return true;
      }
      const haystack = [
        img.displayName,
        img.filename,
        img.folder,
        img.description,
        img.altTag,
        ...(img.tags || []),
      ]
        .filter(Boolean)
        .map(String)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [adoptAssetTypeFilter, adoptSearch, adoptableImages, adoptFolderFilter]);

  const adoptAssetTypeOptions = useMemo(
    () => [
      { value: '', label: 'All types' },
      { value: 'image', label: 'Images only' },
      { value: 'video', label: 'Videos only' },
    ],
    []
  );

  const totalAdoptPages = Math.max(1, Math.ceil(filteredAdoptableImages.length / ADOPT_PAGE_SIZE));
  const pagedAdoptableImages = useMemo(() => {
    const start = (adoptPage - 1) * ADOPT_PAGE_SIZE;
    return filteredAdoptableImages.slice(start, start + ADOPT_PAGE_SIZE);
  }, [filteredAdoptableImages, adoptPage]);

  useEffect(() => {
    setAdoptPage(1);
  }, [adoptAssetTypeFilter, adoptFolderFilter, adoptSearch, id]);

  useEffect(() => {
    setAdoptPage((prev) => Math.min(prev, totalAdoptPages));
  }, [totalAdoptPages]);

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

  const originalDeliveryUrl = useMemo(
    () => (id ? getCloudflareImageUrl(id, 'original') : ''),
    [id]
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
    const finalTags = tagsInput
      ? tagsInput
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
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
      exif: clearExif ? undefined : image?.exif,
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
    clearExif,
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
  const handleColorSearchNavigation = useCallback((hex: string) => {
    const normalized = normalizeColorSearchHex(hex);
    if (!normalized) return;
    const targetNamespace = image?.namespace ?? galleryNamespaceParam;
    const qs = new URLSearchParams();
    qs.set('gcolor', normalized);
    qs.set('gns', targetNamespace ?? '');
    router.push(`/?${qs.toString()}`, { scroll: false });
  }, [galleryNamespaceParam, image?.namespace, router]);

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
    return tagsInput
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
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
  const isMetadataDirty = useMemo(() => {
    if (!image) {
      return false;
    }
    const finalFolder = folderSelect === '__create__'
      ? cleanString(newFolderInput) ?? ''
      : cleanString(folderSelect) ?? '';
    const imageFolder = cleanString(image.folder) ?? '';
    if (finalFolder !== imageFolder) {
      return true;
    }
    const inputTags = tagsInput
      ? tagsInput.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];
    const imageTags = Array.isArray(image.tags) ? image.tags : [];
    const normalizeTags = (tags: string[]) => [...tags].map((tag) => tag.trim()).filter(Boolean).sort();
    const normalizedInputTags = normalizeTags(inputTags);
    const normalizedImageTags = normalizeTags(imageTags);
    if (normalizedInputTags.length !== normalizedImageTags.length) {
      return true;
    }
    for (let i = 0; i < normalizedInputTags.length; i += 1) {
      if (normalizedInputTags[i] !== normalizedImageTags[i]) {
        return true;
      }
    }
    const descriptionValue = descriptionInput ?? '';
    const imageDescription = extrasRecord?.imageId === image.id
      ? (extrasRecord.description ?? '')
      : (image.description ?? '');
    if (descriptionValue !== imageDescription) {
      return true;
    }
    const originalValue = cleanString(originalUrlInput) ?? '';
    const imageOriginal = cleanString(image.originalUrl) ?? '';
    if (originalValue !== imageOriginal) {
      return true;
    }
    const displayNameValue = cleanString(displayNameInput) ?? '';
    const imageDisplayName = cleanString(image.displayName || image.filename) ?? '';
    if (displayNameValue !== imageDisplayName) {
      return true;
    }
    const altValue = cleanString(altTextInput) ?? '';
    const imageAlt = cleanString(image.altTag) ?? '';
    if (altValue !== imageAlt) {
      return true;
    }
    // EXIF clearing is a dirty state
    if (clearExif) {
      return true;
    }
    return false;
  }, [
    altTextInput,
    clearExif,
    descriptionInput,
    displayNameInput,
    extrasRecord,
    folderSelect,
    image,
    newFolderInput,
    originalUrlInput,
    tagsInput
  ]);
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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const NAV_INTENT_WINDOW_MS = 3000;
    const markUserNavIntent = () => {
      lastUserNavIntentRef.current = Date.now();
    };

    const handleIntentKeyDown = (event: KeyboardEvent) => {
      if (!event.isTrusted) return;
      if (event.key === 'Enter' || event.key === ' ') {
        markUserNavIntent();
      }
    };
    const handleIntentPointerDown = (event: PointerEvent) => {
      if (!event.isTrusted) return;
      markUserNavIntent();
    };

    const isDetailPath = (pathname: string) => /^\/(images|videos)\//.test(pathname);
    const toPathname = (target: string | URL | null | undefined) => {
      if (!target) return '';
      try {
        return new URL(String(target), window.location.href).pathname;
      } catch {
        return '';
      }
    };
    const hasRecentIntent = () => Date.now() - lastUserNavIntentRef.current < NAV_INTENT_WINDOW_MS;

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);

    window.history.pushState = ((data: unknown, unused: string, url?: string | URL | null) => {
      const targetPath = toPathname(url);
      if (
        targetPath &&
        targetPath !== window.location.pathname &&
        isDetailPath(targetPath) &&
        !hasRecentIntent()
      ) {
        console.warn('[NavGuard] Blocked non-user pushState navigation', {
          from: window.location.pathname,
          to: targetPath,
        });
        return;
      }
      return originalPushState(data, unused, url);
    }) as History['pushState'];

    window.history.replaceState = ((data: unknown, unused: string, url?: string | URL | null) => {
      const targetPath = toPathname(url);
      if (
        targetPath &&
        targetPath !== window.location.pathname &&
        isDetailPath(targetPath) &&
        !hasRecentIntent()
      ) {
        console.warn('[NavGuard] Blocked non-user replaceState navigation', {
          from: window.location.pathname,
          to: targetPath,
        });
        return;
      }
      return originalReplaceState(data, unused, url);
    }) as History['replaceState'];

    const handlePopState = () => {
      if (hasRecentIntent()) {
        return;
      }
      const pinnedId = pinnedImageIdRef.current;
      if (!pinnedId) {
        return;
      }
      const targetPath = `/images/${pinnedId}`;
      if (window.location.pathname !== targetPath) {
        console.warn('[NavGuard] Reverting unexpected popstate navigation', {
          from: window.location.pathname,
          to: targetPath,
        });
        router.replace(buildAssetHref(pinnedId), { scroll: false });
      }
    };

    const handleBeforeUnloadGuard = (event: BeforeUnloadEvent) => {
      if (hasRecentIntent()) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
      console.warn('[NavGuard] Blocked non-user unload/navigation');
    };

    window.addEventListener('pointerdown', handleIntentPointerDown, true);
    window.addEventListener('keydown', handleIntentKeyDown, true);
    window.addEventListener('popstate', handlePopState, true);
    window.addEventListener('beforeunload', handleBeforeUnloadGuard, true);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('pointerdown', handleIntentPointerDown, true);
      window.removeEventListener('keydown', handleIntentKeyDown, true);
      window.removeEventListener('popstate', handlePopState, true);
      window.removeEventListener('beforeunload', handleBeforeUnloadGuard, true);
    };
  }, [buildAssetHref, router]);

  useEffect(() => {
    if (!id) {
      return;
    }
    const pinnedId = pinnedImageIdRef.current;
    const hasRecentIntent = Date.now() - lastUserNavIntentRef.current < 3000;

    if (!pinnedId) {
      pinnedImageIdRef.current = id;
      return;
    }

    if (id !== pinnedId && !hasRecentIntent) {
      console.warn('[NavGuard] Reverting unexpected route change', {
        fromPinnedId: pinnedId,
        unexpectedId: id,
      });
      router.replace(buildAssetHref(pinnedId), { scroll: false });
      return;
    }

    pinnedImageIdRef.current = id;
  }, [buildAssetHref, id, router]);

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

  const getOrientationIcon = (aspectRatioString: string) => {
    const parts = aspectRatioString.split(':');
    if (parts.length === 2) {
      const width = parseFloat(parts[0]);
      const height = parseFloat(parts[1]);
      const ratio = width / height;
      
      if (Math.abs(ratio - 1) < 0.1) {
        return (
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="inline-block">
            <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="0.8"/>
          </svg>
        );
      } else if (ratio > 1) {
        return (
          <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor" className="inline-block">
            <rect x="1" y="1" width="8" height="4" fill="none" stroke="currentColor" strokeWidth="0.8"/>
          </svg>
        );
      } else {
        return (
          <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor" className="inline-block">
            <rect x="1" y="1" width="4" height="8" fill="none" stroke="currentColor" strokeWidth="0.8"/>
          </svg>
        );
      }
    }
    
    return (
      <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="inline-block">
        <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="0.8"/>
      </svg>
    );
  };

  const AspectRatioDisplay: React.FC<{ imageId: string; className?: string }> = ({ imageId, className }) => {
    const { aspectRatio, loading, error } = useImageAspectRatio(imageId, Boolean(imageId));

    if (!imageId) {
      return null;
    }

    if (loading) {
      return (
        <p className={`text-[11px] font-mono text-gray-400 ${className ?? ''}`}>
          📐 <span className="inline-block w-8 h-2 bg-gray-200 rounded animate-pulse"></span>
        </p>
      );
    }

    if (error || !aspectRatio) {
      return <p className={`text-[11px] font-mono text-gray-400 ${className ?? ''}`}>📐 --</p>;
    }

    return (
      <p className={`text-[11px] font-mono text-gray-500 flex items-center gap-1 ${className ?? ''}`}>
        📐 {aspectRatio} {getOrientationIcon(aspectRatio)}
      </p>
    );
  };

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
    setFolderSelect(image.folder || '');
    setNewFolderInput('');
    setTagsInput(image.tags ? image.tags.join(', ') : '');
    setDescriptionInput(resolveInitialDescription(extrasRecord, image));
    setAltTextInput(resolveInitialAltText(extrasRecord, image));
    setOriginalUrlInput(image.originalUrl || '');
    setSourceUrlInput(image.sourceUrl || '');
    setDisplayNameInput(image.displayName || image.filename || '');
    setClearExif(false);
  }, [image, extrasRecord]);

  const handleSaveMetadata = useCallback(async () => {
    if (!image || !id) {
      return;
    }
    setSaving(true);
    try {
      const finalFolder = folderSelect === '__create__'
        ? (newFolderInput.trim() || undefined)
        : (folderSelect === '' ? undefined : folderSelect);
      const cleanedOriginalUrl = cleanString(originalUrlInput);
      const cleanedSourceUrl = cleanString(sourceUrlInput);
      const payload: Record<string, unknown> = {
        folder: finalFolder,
        tags: tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [],
        description: descriptionInput,
        originalUrl: cleanedOriginalUrl ?? '',
        sourceUrl: cleanedSourceUrl ?? '',
        displayName: cleanString(displayNameInput) ?? '',
        altTag: cleanString(altTextInput) ?? '',
      };
      // Include clearExif flag if user wants to remove EXIF
      if (clearExif) {
        payload.clearExif = true;
      }
      const res = await fetch(`/api/images/${id}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json() as CloudflareImage | { error: string };
      if (res.ok && !('error' in body)) {
        // Also save description/altText to Image Extras (primary storage)
        try {
          await fetch(`/api/images/${id}/extras`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              description: descriptionInput || null,
              altText: cleanString(altTextInput) || null,
            }),
          });
          // Update local extras record
          setExtrasRecord(prev => ({
            ...prev,
            imageId: id,
            description: descriptionInput || undefined,
            altText: cleanString(altTextInput) || undefined,
          }));
        } catch (extrasErr) {
          console.error('Failed to save to Image Extras', extrasErr);
          // Continue anyway - Cloudflare metadata was saved
        }
        toast.push('Metadata updated');
        if (typeof window !== 'undefined') {
          try {
            window.sessionStorage.removeItem(`${IMAGE_DETAIL_DRAFT_KEY_PREFIX}${id}`);
          } catch {
            // Ignore storage access failures.
          }
        }
        // Reset clearExif flag after successful save
        setClearExif(false);
        setImage(prev => prev ? ({
          ...prev,
          folder: body.folder,
          tags: body.tags,
          description: descriptionInput,
          originalUrl: body.originalUrl,
          sourceUrl: body.sourceUrl,
          displayName: body.displayName,
          altTag: cleanString(altTextInput) ?? '',
          exif: clearExif ? undefined : prev.exif  // Clear EXIF in local state if requested
        }) : prev);
        await refreshImageList();
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
    clearExif,
    descriptionInput,
    displayNameInput,
    folderSelect,
    id,
    image,
    newFolderInput,
    originalUrlInput,
    sourceUrlInput,
    refreshImageList,
    tagsInput,
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
      const existingTags = tagsInput
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      const mergedTags = mergeUniqueTags(existingTags, payload.tags);
      const appendedCount = Math.max(0, mergedTags.length - existingTags.length);
      if (appendedCount === 0) {
        toast.push('No new semantic tags to add');
        return;
      }
      const saveResult = await patchImageMetadata(id, { tags: mergedTags });
      if (!saveResult.ok) {
        toast.push(saveResult.payload?.error || 'Failed to save semantic tags');
        return;
      }
      const nextTagsInput = mergedTags.join(', ');
      setTagsInput(nextTagsInput);
      setImage((prev) => (prev && prev.id === id ? { ...prev, tags: mergedTags } : prev));
      setAllImages((prev) => prev.map((entry) => (entry.id === id ? { ...entry, tags: mergedTags } : entry)));
      toast.push(`Appended ${appendedCount} semantic tag${appendedCount === 1 ? '' : 's'} and saved`);
    } catch (error) {
      console.error('Failed to generate semantic tags:', error);
      toast.push('Failed to generate semantic tags');
    } finally {
      setTagGenerationLoading(false);
    }
  }, [id, tagGenerationCount, tagsInput, toast]);

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
      const response = await fetch(`/api/images/${childId}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'Failed to delete asset');
      }
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
          const response = await fetch(`/api/images/${idValue}`, { method: 'DELETE' });
          if (!response.ok) {
            failedIds.push(idValue);
            continue;
          }
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

  const handleAdoptImage = useCallback(async () => {
    if (!adoptImageId || !id) {
      return;
    }
    setAdoptLoading(true);
    try {
      await patchParentAssignment(adoptImageId, id);
      toast.push('Variation adopted');
      setAdoptImageId('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to adopt variation';
      toast.push(message);
    } finally {
      setAdoptLoading(false);
    }
  }, [adoptImageId, id, patchParentAssignment, toast]);

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

  const refreshPromptThis = useCallback(async () => {
    if (!image?.id) {
      return;
    }
    setPromptThisLoading(true);
    try {
      const response = await fetch(`/api/images/${image.id}/prompt`, { method: 'GET' });
      const data = await response.json();
      if (!response.ok) {
        return;
      }
      const record = data?.record;
      if (record?.prompt && typeof record.prompt === 'string') {
        setPromptThisInput(record.prompt);
        setPromptThisMeta({ saved: true, updatedAt: record.updatedAt, model: record.model });
        setLastSavedPromptThis(record.prompt);
      } else {
        setPromptThisInput('');
        setPromptThisMeta(null);
        setLastSavedPromptThis('');
      }
    } catch (error) {
      console.warn('Failed to refresh Prompt This:', error);
    } finally {
      setPromptThisLoading(false);
    }
  }, [image?.id]);

  const savePromptThisEdits = useCallback(async () => {
    if (!image?.id) return;

    const trimmed = (promptThisInput || '').trim();
    const lastSavedTrimmed = (lastSavedPromptThis || '').trim();

    if (!trimmed) {
      return;
    }

    if (trimmed === lastSavedTrimmed) {
      return;
    }

    setPromptThisSaving(true);
    try {
      const response = await fetch(`/api/images/${image.id}/prompt`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmed })
      });
      const data = await response.json();
      if (!response.ok || !data?.record?.prompt) {
        toast.push(data?.error || 'Failed to save prompt');
        return;
      }

      setPromptThisInput(data.record.prompt);
      setLastSavedPromptThis(data.record.prompt);
      setPromptThisMeta({
        saved: Boolean(data?.saved),
        updatedAt: data?.record?.updatedAt,
        model: data?.record?.model
      });
      toast.push('Prompt saved');
    } catch (error) {
      console.error('Failed to save prompt:', error);
      toast.push('Failed to save prompt');
    } finally {
      setPromptThisSaving(false);
    }
  }, [image?.id, lastSavedPromptThis, promptThisInput, toast]);

  const generatePromptThis = useCallback(async (force?: boolean) => {
    if (!image?.id) {
      return;
    }
    setPromptThisGenerating(true);
    try {
      const response = await fetch(`/api/images/${image.id}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          force: Boolean(force),
          existingPrompt: promptThisInput || ''
        })
      });
      const data = await response.json();
      if (!response.ok || !data?.record?.prompt) {
        toast.push(data?.error || 'Failed to generate prompt');
        return;
      }
      const promptText: string = data.record.prompt;
      setPromptThisInput(promptText);
      setPromptThisMeta({
        saved: Boolean(data?.saved),
        updatedAt: data?.record?.updatedAt,
        model: data?.record?.model
      });
      toast.push(data?.generated ? 'Prompt generated' : 'Prompt loaded');
    } catch (error) {
      console.error('Failed to generate prompt:', error);
      toast.push('Failed to generate prompt');
    } finally {
      setPromptThisGenerating(false);
    }
  }, [image?.id, promptThisInput, toast]);

  useEffect(() => {
    refreshPromptThis();
  }, [refreshPromptThis]);

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

  return (
    <div id="image-detail-page" className="p-6 relative">
      <div id="image-detail-container" className="max-w-5xl mx-auto bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-6">
          <div id="detail-navigation" className="flex items-center justify-between gap-3 mb-4">
            <button type="button" onClick={handleBackToGallery} className="text-xs text-blue-600 underline">
              ← Back to gallery
            </button>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {Boolean(image.parentId) && familyLoaded && familyVariantSequence.length > 0 && (
                <div className="flex items-center gap-2">
                  {familyVariantIndex >= 0 && (
                    <span className="text-[11px] font-mono text-gray-500">
                      Variant {familyVariantIndex + 1} / {familyVariantSequence.length}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => commitAssetNavigation(prevFamilyVariantId)}
                    disabled={!prevFamilyVariantId}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border rounded-md border-amber-200 text-amber-700 hover:border-amber-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Previous variant in this parent family"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Prev var
                  </button>
                  <button
                    type="button"
                    onClick={() => commitAssetNavigation(nextFamilyVariantId)}
                    disabled={!nextFamilyVariantId}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border rounded-md border-amber-200 text-amber-700 hover:border-amber-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Next variant in this parent family"
                  >
                    Next var
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {galleryResultIds.length > 0 && (
                <div className="flex items-center gap-2">
                  {galleryResultIndex >= 0 && (
                    <span className="text-[11px] font-mono text-gray-500">
                      {galleryResultIndex + 1} / {galleryResultIds.length}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => commitAssetNavigation(prevGalleryImageId)}
                    disabled={!prevGalleryImageId}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border rounded-md border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => commitAssetNavigation(nextGalleryImageId)}
                    disabled={!nextGalleryImageId}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border rounded-md border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
          <div id="image-hero-section" className="w-full mb-4">
            <div className="relative w-full aspect-[3/2] bg-gray-100 rounded overflow-hidden group">
              <Image
                draggable
                onDragStart={(e) => handleImageDragStart(e, image)}
                src={originalDeliveryUrl}
                alt={image.filename || 'image'}
                fill
                className="object-contain"
                unoptimized
                priority
                style={heroRotationStyle}
              />
              <button
                type="button"
                onClick={() => {
                  const width = Math.min(900, window.screen.width * 0.6);
                  const height = Math.min(700, window.screen.height * 0.6);
                  const left = (window.screen.width - width) / 2;
                  const top = (window.screen.height - height) / 2;
                  window.open(
                    originalDeliveryUrl,
                    `drag_${image.id}`,
                    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`
                  );
                }}
                title="Open image in a popup window for easy drag-and-drop to other apps"
                className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-black/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-gray-600">Rotation preview</span>
                <span className="text-gray-500">{normalizedRotation}°</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => adjustRotationPreview(-90)}
                  disabled={rotationLoading}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCcw className="h-4 w-4" />
                  Left
                </button>
                <button
                  type="button"
                  onClick={() => adjustRotationPreview(90)}
                  disabled={rotationLoading}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCw className="h-4 w-4" />
                  Right
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRotation}
                  disabled={rotationLoading || normalizedRotation === 0}
                  className="inline-flex items-center gap-1 px-4 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {rotationLoading ? 'Rotating…' : 'Confirm rotation'}
                </button>
              </div>
              {rotationError && (
                <p className="text-[11px] text-red-600">{rotationError}</p>
              )}
              {rotatedAsset && (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-[11px] text-blue-900 space-y-1">
                  <p className="font-semibold text-blue-800">Rotated asset created</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyText(rotatedAsset.url, 'Rotated URL copied')}
                      className="px-2 py-1 border border-blue-200 rounded text-[11px] text-blue-700 hover:border-blue-300"
                    >
                      Copy new CDN URL
                    </button>
                    <Link
                      href={`/images/${rotatedAsset.id}`}
                      className="text-[11px] text-blue-700 underline"
                      prefetch={false}
                    >
                      View rotated asset
                    </Link>
                  </div>
                  <p className="text-[10px] text-blue-700 leading-snug break-all">
                    {rotatedAsset.url}
                  </p>
                  <p className="text-[10px] text-blue-700">
                    Update any existing references—the Cloudflare delivery URL changed.
                  </p>
                  {rotatedAsset.info && (
                    <p className="text-[10px] text-blue-600 italic">{rotatedAsset.info}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div id="image-summary-section" className="mb-6">
            <div className="flex items-center gap-2">
              <p className="text-xs mono font-semibold text-gray-900">{image.displayName || image.filename || 'Image'}</p>
              {(image.generatedBy === 'comfyui' || image.comfyMetadataDetected === true) && (
                <span
                  id={`image-detail-comfy-indicator-${image.id}`}
                  className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] text-orange-700"
                  title="ComfyUI output detected"
                  aria-label="ComfyUI output detected"
                >
                  <Image
                    src="/icons/comfyui.svg"
                    alt="ComfyUI"
                    width={14}
                    height={14}
                    className="h-3.5 w-3.5"
                  />
                  ComfyUI
                </span>
              )}
              <EmbeddingStatusIcon
                hasClipEmbedding={image.hasClipEmbedding}
                hasColorEmbedding={image.hasColorEmbedding}
                dominantColors={image.dominantColors}
                averageColor={image.averageColor}
                pendingStatus={pendingEmbedding?.status}
                pendingLabel={pendingEmbedding?.error}
                size={18}
                showTooltip={true}
              />
              <button
                onClick={generateEmbeddings}
                disabled={embeddingGenerating}
                className="inline-flex items-center gap-1 px-2 py-1 text-[10px] border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                title="Generate CLIP and color embeddings for vector search"
              >
                <Cpu className="h-3 w-3" />
                {embeddingGenerating || pendingEmbedding?.status === 'embedding'
                  ? 'Generating...'
                  : (image.hasClipEmbedding && image.hasColorEmbedding ? 'Refresh' : 'Generate')}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
              <span className={`px-2 py-0.5 rounded-full border ${image.hasClipEmbedding ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                CLIP {image.hasClipEmbedding ? 'ready' : 'missing'}
              </span>
              <span className={`px-2 py-0.5 rounded-full border ${image.hasColorEmbedding ? 'border-purple-200 bg-purple-50 text-purple-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                Color {image.hasColorEmbedding ? 'ready' : 'missing'}
              </span>
              {/* Only show pending badge if image doesn't already have all embeddings */}
              {pendingEmbedding && !(image.hasClipEmbedding && image.hasColorEmbedding) && (
                <span className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500"></span>
                  </span>
                  {pendingEmbedding.status === 'queued' ? 'Embedding queued' : pendingEmbedding.status === 'embedding' ? 'Embedding running' : 'Embedding failed'}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>Uploaded {new Date(image.uploaded).toLocaleString()}</span>
              <span className="text-gray-300">•</span>
              <span>Namespace {image.namespace || '[none]'}</span>
            </div>
            <ColorSwatches
              dominantColors={image.dominantColors}
              averageColor={image.averageColor}
              showLabels={true}
              className="mt-2"
              onSelectColor={handleColorSearchNavigation}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
              <span className="text-gray-500">Image ID</span>
              <span className="font-mono text-gray-800">{image.id}</span>
              <button
                onClick={() => handleCopyText(image.id, 'Image ID copied')}
                className="px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-100 text-[10px]"
              >
                Copy
              </button>
            </div>
            <AspectRatioDisplay imageId={image.id} />

            {/* Semantic Analysis Section - only show if image has CLIP embedding */}
            {image.hasClipEmbedding && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <details className="group">
                  <summary className="cursor-pointer text-xs font-medium text-gray-700 hover:text-gray-900 flex items-center gap-2">
                    <ChevronDown className="h-3 w-3 group-open:rotate-180 transition-transform" />
                    Semantic Analysis
                    <span className="text-[10px] text-gray-500 font-normal">(CLIP embedding visualization)</span>
                  </summary>
                  <div className="mt-3 space-y-4">
                    <div className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-white/60 px-3 py-2">
                      <div className="text-[11px] text-gray-600">
                        Scope: {semanticSearchAllNamespaces ? 'All namespaces' : (namespace ? namespace : '[none]')}
                      </div>
                      <label className="flex items-center gap-2 text-[11px] text-gray-700 select-none">
                        <input
                          type="checkbox"
                          checked={semanticSearchAllNamespaces}
                          onChange={(e) => setSemanticSearchAllNamespaces(e.target.checked)}
                          className="h-3.5 w-3.5"
                        />
                        All namespaces
                      </label>
                    </div>
                    {/* Machine Haiku */}
                    <HaikuDisplay imageId={image.id} hasClipEmbedding={image.hasClipEmbedding} />
                    
                    {/* Concept Radar and Semantic Neighbors */}
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                      {deleteFamilyOpen && (
                        <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center px-4">
                          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full overflow-hidden">
                            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                              <div>
                                <h3 className="text-sm font-mono text-gray-900">Deleting image family…</h3>
                                <p className="text-[11px] text-gray-500">This can take a while for large families.</p>
                              </div>
                              <button
                                type="button"
                                onClick={closeDeleteFamilyModal}
                                className="text-xs px-2 py-1 border rounded text-gray-700 hover:bg-gray-50"
                              >
                                Hide
                              </button>
                            </div>
                            <div className="p-4 space-y-3">
                              {deleteFamilyStatus ? (
                                (() => {
                                  const total = Math.max(1, deleteFamilyStatus.total);
                                  const attempted = deleteFamilyStatus.attempted;
                                  const pct = Math.min(100, Math.round((attempted / total) * 100));
                                  return (
                                    <>
                                      <div className="flex items-center justify-between text-xs text-gray-700">
                                        <span className="font-mono">{attempted}/{total} attempted</span>
                                        <span className="font-mono">{pct}%</span>
                                      </div>
                                      <div className="h-2 w-full bg-gray-100 rounded">
                                        <div className="h-2 bg-red-500 rounded" style={{ width: `${pct}%` }} />
                                      </div>
                                      <div className="flex items-center justify-between text-[11px] text-gray-600">
                                        <span>Deleted: <span className="font-mono">{deleteFamilyStatus.deleted}</span></span>
                                        <span>Failed: <span className="font-mono">{deleteFamilyStatus.failed}</span></span>
                                        <span>Concurrency: <span className="font-mono">{deleteFamilyStatus.concurrency}</span></span>
                                      </div>
                                      {deleteFamilyStatus.lastError && (
                                        <div className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded p-2">
                                          {deleteFamilyStatus.lastError}
                                        </div>
                                      )}
                                    </>
                                  );
                                })()
                              ) : (
                                <div className="text-xs text-gray-600">
                                  Starting job…
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                          <ConceptRadar 
                          imageId={image.id} 
                          size={320}
                          onImageClick={(result) => {
                            if (!result?.imageId) return;
                            commitNavigation(
                              result.assetType === 'video'
                                ? `/videos/${result.imageId}`
                                : `/images/${result.imageId}`,
                              result.imageId
                            );
                          }}
                          copyVariant={listVariant}
                          onCopySuccess={(msg) => toast.push(msg)}
                          namespace={namespace}
                          searchAllNamespaces={semanticSearchAllNamespaces}
                        />
                      </div>
                      <div>
                        <SemanticNeighbors 
                          imageId={image.id} 
                          type="clip" 
                          limit={8}
                          showStrangers={true}
                          onImageClick={(clickedImageId) => {
                            if (!clickedImageId) return;
                            commitNavigation(`/images/${clickedImageId}`, clickedImageId);
                          }}
                          copyVariant={listVariant}
                          onCopySuccess={(msg) => toast.push(msg)}
                          namespace={namespace}
                          searchAllNamespaces={semanticSearchAllNamespaces}
                        />
                      </div>
                    </div>
                    
                    {/* Antipode Search */}
                    <AntipodeSearch 
                      imageId={image.id}
                      className="bg-gray-900/50 border border-amber-900/30 rounded-lg p-4"
                      onImageClick={(result) => {
                        if (!result?.imageId) return;
                        commitNavigation(
                          result.assetType === 'video'
                            ? `/videos/${result.imageId}`
                            : `/images/${result.imageId}`,
                          result.imageId
                        );
                      }}
                      copyVariant={listVariant}
                      onCopySuccess={(msg) => toast.push(msg)}
                      namespace={namespace}
                      searchAllNamespaces={semanticSearchAllNamespaces}
                    />
                  </div>
                </details>
              </div>
            )}
          </div>

          <div id="image-metadata-section" className="space-y-4">
            <CloudflareMetadataHeader
              metadataByteSize={metadataByteSize}
              metadataPrunedByteSize={metadataPrunedByteSize}
              metadataLargestFields={metadataLargestFields}
              metadataPrunedDroppedFields={metadataPrunedDroppedFields}
              extrasBackedFields={[...CLOUDFLARE_EXTRAS_ONLY_FIELDS, 'altText']}
              isMetadataDirty={isMetadataDirty}
              pendingAutoSave={pendingAutoSave}
              saving={saving}
              onDiscard={handleCancelMetadata}
              onSave={handleSaveMetadata}
            />
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-gray-500">
              <span className="text-gray-400">Dimensions</span>
              {detailAspectLoading && !detailDimensions ? (
                <span className="inline-block w-20 h-2 bg-gray-200 rounded animate-pulse" />
              ) : detailDimensions ? (
                <span className="text-gray-700">
                  {detailDimensions.width}×{detailDimensions.height}px
                </span>
              ) : (
                <span className="text-gray-400">--</span>
              )}
              <span className="text-gray-300">•</span>
              <span className="text-gray-400">Aspect</span>
              {detailAspectLoading && !detailAspectRatio ? (
                <span className="inline-block w-10 h-2 bg-gray-200 rounded animate-pulse" />
              ) : detailAspectRatio ? (
                <span className="text-gray-700">{detailAspectRatio}</span>
              ) : (
                <span className="text-gray-400">--</span>
              )}
              <span className="text-gray-300">•</span>
              <span className="text-gray-400">File size</span>
              <span className="text-gray-700">{detailFileSizeLabel}</span>
            </div>

            <DescriptionEditor
              descriptionInput={descriptionInput}
              setDescriptionInput={setDescriptionInput}
              descriptionGenerating={descriptionGenerating}
              onGenerateDescription={generateDescription}
              hasVariations={hasVariations}
              bulkDescriptionApplying={bulkDescriptionApplying}
              onApplyToVariations={applyDescriptionToVariations}
            />

            <AltTextEditor
              imageId={image.id}
              imageHasAlt={Boolean(image.altTag)}
              altTextInput={altTextInput}
              setAltTextInput={setAltTextInput}
              altLoading={Boolean(altLoadingMap[image.id])}
              onGenerateAlt={generateAltTag}
              hasVariations={hasVariations}
              bulkAltApplying={bulkAltApplying}
              onApplyToVariations={applyAltToVariations}
            />

            <PromptThisEditor
              promptThisInput={promptThisInput}
              setPromptThisInput={setPromptThisInput}
              promptThisLoading={promptThisLoading}
              promptThisGenerating={promptThisGenerating}
              promptThisSaving={promptThisSaving}
              promptThisMeta={promptThisMeta}
              onGenerate={generatePromptThis}
              onSave={savePromptThisEdits}
              onCopy={() => handleCopyText(promptThisInput || '', 'Prompt copied')}
            />

            <ComfyWorkflowPanel
              imageId={image.id}
              comfyWorkflow={extrasRecord?.comfyWorkflow ?? null}
              detection={{
                generatedBy: image.generatedBy,
                comfyMetadataDetected: image.comfyMetadataDetected,
                comfyMetadataSource: image.comfyMetadataSource,
              }}
              onCopyText={handleCopyText}
            />

            <div id="folder-section">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono font-medum text-gray-700">Folder</p>
                <FolderManagerButton
                  size="sm"
                  label="Edit Folders"
                  onFoldersChanged={handleFolderManagerChange}
                />
              </div>
              <div className="mt-2">
                <MonoSelect
                  value={folderSelect}
                  onChange={setFolderSelect}
                  options={detailFolderOptions}
                  className="w-full"
                  placeholder="[none]"
                  searchable
                  searchPlaceholder="Search folders…"
                />
                {folderSelect === '__create__' && (
                  <input
                    value={newFolderInput}
                    onChange={(e) => setNewFolderInput(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs mt-2"
                    placeholder="Type new folder name"
                  />
                )}
                {hasVariations && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    <button
                      onClick={applyFolderToVariations}
                      disabled={bulkFolderApplying || !effectiveParentFolder}
                      className="px-2 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {bulkFolderApplying ? 'Applying…' : 'Apply folder to variations'}
                    </button>
                    {!effectiveParentFolder && (
                      <span className="text-gray-500">Set a folder to enable.</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div id="tags-section">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-mono font-medum text-gray-700">Tags</p>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <label className="flex items-center gap-2 text-gray-600">
                    <span>AI count</span>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={tagGenerationCount}
                      onChange={(e) => setTagGenerationCount(Math.min(12, Math.max(1, Number.parseInt(e.target.value || '6', 10) || 6)))}
                      className="w-16 rounded border border-gray-300 px-2 py-1 text-[11px]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateSemanticTags}
                    disabled={tagGenerationLoading}
                    className="inline-flex items-center gap-2 rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-700 hover:border-gray-300 disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {tagGenerationLoading ? 'Generating tags…' : 'Generate semantic tags'}
                  </button>
                {hasVariations && (
                  <>
                    <button
                      onClick={() => applyTagsToVariations('append')}
                      disabled={bulkTagsAppending || parentTags.length === 0}
                      className="px-2 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {bulkTagsAppending ? 'Appending…' : 'Append to variations'}
                    </button>
                    <button
                      onClick={() => applyTagsToVariations('replace')}
                      disabled={bulkTagsReplacing}
                      className="px-2 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {bulkTagsReplacing ? 'Replacing…' : 'Replace on variations'}
                    </button>
                  </>
                )}
                </div>
              </div>
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs mt-2"
                placeholder="Comma-separated tags"
              />
              {/* Exclusion tag quick-add buttons */}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="text-[10px] text-gray-500">Exclude from:</span>
                {(['x-clip', 'x-color', 'x-search'] as const).map((tag) => {
                  const hasTag = tagsInput.split(',').map(t => t.trim()).includes(tag);
                  const toggleTag = () => {
                    const currentTags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
                    if (hasTag) {
                      setTagsInput(currentTags.filter(t => t !== tag).join(', '));
                    } else {
                      setTagsInput([...currentTags, tag].join(', '));
                    }
                  };
                  const label = tag === 'x-clip' ? 'Semantic' : tag === 'x-color' ? 'Color' : 'All Search';
                  return (
                    <button
                      key={tag}
                      onClick={toggleTag}
                      className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                        hasTag 
                          ? 'border-red-400 bg-red-50 text-red-700 hover:bg-red-100' 
                          : 'border-gray-300 text-gray-500 hover:bg-gray-50'
                      }`}
                      title={hasTag ? `Remove ${tag} tag` : `Add ${tag} tag to exclude from ${label.toLowerCase()} search`}
                    >
                      {hasTag ? '✓ ' : ''}{label}
                    </button>
                  );
                })}
              </div>
              {hasVariations && parentTags.length === 0 && (
                <p className="text-[10px] text-gray-500 mt-1">Add tags to enable appending.</p>
              )}
            </div>

            <div id="name-section">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-mono font-medum text-gray-700">Display name (editable)</p>
                <button
                  onClick={generateDisplayName}
                  disabled={displayNameGenerating}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {displayNameGenerating ? 'Generating…' : 'Generate short name'}
                </button>
              </div>
              <input
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs mt-2"
                placeholder="Display name (defaults to filename)"
              />
              <p className="text-[11px] text-gray-600 mt-1">
                Immutable filename: <span className="font-mono">{image?.filename || 'Unknown'}</span>
              </p>
            </div>

            <OriginalUrlSection
              originalUrlInput={originalUrlInput}
              setOriginalUrlInput={setOriginalUrlInput}
              originalUrlTooLong={originalUrlTooLong}
              originalUrlByteLength={originalUrlByteLength}
              originalDeliveryUrl={originalDeliveryUrl}
              originalUrlNormalized={image?.originalUrlNormalized}
              contentHash={image?.contentHash}
              onCopyToClipboard={handleCopyText}
            />

            <SourceUrlSection
              sourceUrlInput={sourceUrlInput}
              setSourceUrlInput={setSourceUrlInput}
              sourceUrlNormalized={image?.sourceUrlNormalized}
              onCopyToClipboard={handleCopyText}
            />

            <ShareSection
              shareBaseUrl={shareBaseUrl}
              setShareBaseUrl={setShareBaseUrl}
              shareVariant={shareVariant}
              setShareVariant={setShareVariant}
              shareVariantOptions={shareVariantOptions}
              shareUrl={shareUrl}
              shareQrDataUrl={shareQrDataUrl}
              onCopyToClipboard={handleCopyText}
            />

            <ExifSection exifEntries={exifEntries} clearExif={clearExif} setClearExif={setClearExif} />

            <VariantLinksSection
              variants={variants}
              getVariantWidthLabel={getVariantWidthLabel}
              onHandleCopyUrl={handleCopyUrl}
              imageAltTag={image.altTag}
              imageFilename={image.filename}
            />

            <div className="space-y-4">
              {resolvedParentImage && (
                <ParentInfoSection
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
              )}

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

            {!image.parentId && (
              <>
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
                  fallbackTags={image.tags || []}
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
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-4">
          <button
            onClick={handleCancelMetadata}
            className="px-4 py-2 text-xs text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDeleteCurrent}
            className="px-4 py-2 text-xs border border-red-300 text-red-700 rounded-md hover:bg-red-50"
            disabled={saving}
          >
            Delete image
          </button>
          {(variationCount > 0 || isChildImage) && (
            <button
              onClick={handleDeleteFamily}
              className="px-4 py-2 text-xs border border-red-500 text-red-800 rounded-md bg-red-50 hover:bg-red-100"
              disabled={saving}
              title="Delete this image and all variations in its family"
            >
              Delete family
            </button>
          )}
          <button
            onClick={handleSaveMetadata}
            className="px-4 py-2 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
        </div>
      </div>
      {variantModalState && (() => {
        const { target } = variantModalState;
        const blurOverlayStyle: CSSProperties = {
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)'
        };

        const variantEntries = Object.entries(
          getMultipleImageUrls(target.id, ['thumbnail','small','medium','large','xlarge','full'])
        ).map(([variantName, variantUrl]) => [variantName, ensureWebpFormat(variantUrl)] as [string, string]);

        const handleCopyVariantList = async (
          event: React.MouseEvent<HTMLButtonElement>,
          variant: string,
          url: string
        ) => {
          await handleCopyUrl(event, ensureWebpFormat(url), `${variant} variant`, target.altTag);
          setVariantModalState(null);
        };

        return (
          <>
            <div
              className="fixed inset-0 bg-black/30 backdrop-blur-md z-[100000]"
              style={blurOverlayStyle}
              onClick={() => setVariantModalState(null)}
            />
            <div className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 bg-white rounded-lg shadow-xl z-[100001] text-xs text-gray-800 border">
              <div className="flex items-center justify-between p-3 border-b">
                <div className="text-xs font-mono font-medum">
                  Copy Image URL
                </div>
                <button
                  onClick={() => setVariantModalState(null)}
                  className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs"
                >
                  ×
                </button>
              </div>
              <div id="variant-size-modal" className="p-3 max-h-80 overflow-auto">
                {variantEntries.map(([variant, url]) => {
                  const widthLabel = getVariantWidthLabel(variant);
                  return (
                    <div key={variant} className="flex items-center justify-between gap-2 py-2 border-b border-gray-100 last:border-b-0">
                      <div className="flex-1 min-w-0 mr-3">
                        <div className="text-xs font-mono font-semibold text-gray-900 capitalize flex items-center gap-2">
                          <span>{variant}</span>
                          {widthLabel && <span className="text-gray-400 normal-case">{widthLabel}</span>}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{String(url)}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={async (event) => {
                            await handleCopyVariantList(event, variant, String(url));
                          }}
                          className="px-3 py-1 bg-blue-100 hover:bg-blue-200 active:bg-blue-300 rounded text-xs font-medium flex-shrink-0 cursor-pointer transition transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
                        >
                          Copy
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const downloadName = formatDownloadFileName(target.filename || image.filename || 'image');
                              await downloadImageToFile(String(url), downloadName);
                              toast.push('Download started');
                            } catch (error) {
                              console.error('Failed to download variant', error);
                              toast.push('Failed to download image');
                            }
                          }}
                          className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs font-medium flex-shrink-0 cursor-pointer"
                        >
                          Download
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="px-3 pb-3 text-[10px] text-gray-500">Tip: Shift+Copy adds ALT text.</div>
            </div>
          </>
        );
      })()}
      {hoverPreview && (
        <div
          className="fixed z-50 pointer-events-none border border-black/10 shadow-lg rounded-lg overflow-hidden bg-white"
          style={{ top: hoverPreview.y, left: hoverPreview.x, width: 340, height: 280 }}
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
    </div>
  );
}
