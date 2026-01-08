"use client";

import React, { CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { getMultipleImageUrls, getCloudflareImageUrl, IMAGE_VARIANTS } from '@/utils/imageUtils';
import { useToast } from '@/components/Toast';
import { Sparkles, RotateCcw, RotateCw, ChevronUp, ChevronDown, GripVertical } from 'lucide-react';
import FolderManagerButton from '@/components/FolderManagerButton';
import MonoSelect from '@/components/MonoSelect';
import { cleanString, pickCloudflareMetadata } from '@/utils/cloudflareMetadata';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import { useDropzone } from 'react-dropzone';
import { downloadImageToFile, formatDownloadFileName } from '@/utils/downloadUtils';
import { useImageAspectRatio } from '@/hooks/useImageAspectRatio';
import QRCode from 'qrcode';

import { useParams } from 'next/navigation';

interface CloudflareImage {
  id: string;
  filename: string;
  uploaded: string;
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
  parentId?: string;
  linkedAssetId?: string;
  variationSort?: number;
}

const DEFAULT_LIST_VARIANT = 'original';
const VARIANT_DIMENSIONS = new Map(IMAGE_VARIANTS.map(variant => [variant.name, variant.width]));

type BulkUpdateFailure = {
  id: string;
  name: string;
  error?: string;
  reason?: 'metadata' | 'network' | 'unknown';
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

export default function ImageDetailPage() {
  const params = useParams();
  const id = params?.id;
  const [image, setImage] = useState<CloudflareImage | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const [allImages, setAllImages] = useState<CloudflareImage[]>([]);
  const [reassignParentId, setReassignParentId] = useState('');
  const [adoptImageId, setAdoptImageId] = useState('');
  const [parentActionLoading, setParentActionLoading] = useState(false);
  const [childDetachingId, setChildDetachingId] = useState<string | null>(null);
  const [adoptLoading, setAdoptLoading] = useState(false);
  const [adoptSearch, setAdoptSearch] = useState('');
  const [childUploadFiles, setChildUploadFiles] = useState<File[]>([]);
  const [childUploadTags, setChildUploadTags] = useState('');
  const [childUploadFolder, setChildUploadFolder] = useState('');
  const [childUploadLoading, setChildUploadLoading] = useState(false);
  const [adoptFolderFilter, setAdoptFolderFilter] = useState('');
  const [altLoadingMap, setAltLoadingMap] = useState<Record<string, boolean>>({});
  const [bulkDescriptionApplying, setBulkDescriptionApplying] = useState(false);
  const [bulkAltApplying, setBulkAltApplying] = useState(false);
  const [bulkFolderApplying, setBulkFolderApplying] = useState(false);
  const [bulkTagsAppending, setBulkTagsAppending] = useState(false);
  const [bulkTagsReplacing, setBulkTagsReplacing] = useState(false);
  const [variationPage, setVariationPage] = useState(1);
  const [adoptPage, setAdoptPage] = useState(1);
  const [listVariant, setListVariant] = useState(DEFAULT_LIST_VARIANT);
  const VARIATION_PAGE_SIZE = 12;
  const ADOPT_PAGE_SIZE = 12;
  const [hoverPreview, setHoverPreview] = useState<{
    url: string;
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const onVariantDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    setChildUploadFiles((prev) => [...prev, ...acceptedFiles]);
  }, []);

  const {
    getRootProps: getVariantDropzoneProps,
    getInputProps: getVariantInputProps,
    isDragActive: isVariantDragActive
  } = useDropzone({
    onDrop: onVariantDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.webp', '.svg'],
      'application/zip': ['.zip'],
      'application/x-zip-compressed': ['.zip']
    },
    multiple: true
  });

  const [folderSelect, setFolderSelect] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [altTextInput, setAltTextInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [descriptionGenerating, setDescriptionGenerating] = useState(false);
  const [originalUrlInput, setOriginalUrlInput] = useState('');
  const [sourceUrlInput, setSourceUrlInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [shareBaseUrl, setShareBaseUrl] = useState('');
  const [shareVariant, setShareVariant] = useState('large');
  const [shareQrDataUrl, setShareQrDataUrl] = useState('');
  const [namespace, setNamespace] = useState('');
  const [saving, setSaving] = useState(false);
  const [uniqueFolders, setUniqueFolders] = useState<string[]>([]);
  const [newFolderInput, setNewFolderInput] = useState('');
  const [variantModalState, setVariantModalState] = useState<{ target: CloudflareImage } | null>(null);
  const [variationOrderOverride, setVariationOrderOverride] = useState<string[] | null>(null);
  const [variationOrderSaving, setVariationOrderSaving] = useState(false);
  const [draggingVariationId, setDraggingVariationId] = useState<string | null>(null);
  const [dragOverVariationId, setDragOverVariationId] = useState<string | null>(null);
  const [selectedVariationIds, setSelectedVariationIds] = useState<Set<string>>(() => new Set());
  const [variationAltLoadingMap, setVariationAltLoadingMap] = useState<Record<string, boolean>>({});
  const [previewRotation, setPreviewRotation] = useState(0);
  const [rotationLoading, setRotationLoading] = useState(false);
  const [rotationError, setRotationError] = useState<string | null>(null);
  const [rotatedAsset, setRotatedAsset] = useState<{ id: string; url: string; info?: string } | null>(null);

  useEffect(() => {
    setVariationPage(1);
  }, [image?.id, image?.parentId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('shareBaseUrl');
    setShareBaseUrl(stored || window.location.origin);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('imageNamespace');
    const envDefault = process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
    if (stored === '__none__') {
      setNamespace('');
    } else {
      setNamespace(stored || envDefault);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!shareBaseUrl) return;
    window.localStorage.setItem('shareBaseUrl', shareBaseUrl);
  }, [shareBaseUrl]);

  const syncImages = useCallback(
    (imagesData: CloudflareImage[]) => {
      setAllImages(imagesData);
      const found = imagesData.find((img) => img.id === id) || null;
      setImage(found);
      if (found) {
        setFolderSelect(found.folder || '');
        setTagsInput(Array.isArray(found.tags) ? found.tags.join(', ') : '');
        setDescriptionInput(found.description || '');
        setAltTextInput(found.altTag || '');
        setOriginalUrlInput(found.originalUrl || '');
        setSourceUrlInput(found.sourceUrl || '');
        setDisplayNameInput(found.displayName || found.filename || '');
        setReassignParentId(found.parentId || '');
        setChildUploadFolder(found.folder || '');
        setChildUploadTags(Array.isArray(found.tags) ? found.tags.join(', ') : '');
      } else {
        setFolderSelect('');
        setTagsInput('');
        setDescriptionInput('');
        setAltTextInput('');
        setOriginalUrlInput('');
        setSourceUrlInput('');
        setDisplayNameInput('');
        setReassignParentId('');
        setChildUploadFolder('');
        setChildUploadTags('');
      }
      const folders = Array.from(
        new Set(
          imagesData
            .filter((img) => img.folder && img.folder.trim())
            .map((img) => String(img.folder))
        )
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      setUniqueFolders(folders as string[]);
    },
    [id]
  );

  const refreshImageList = useCallback(async () => {
    if (!id) {
      return;
    }
    try {
      const url = namespace === ''
        ? `/api/images?namespace=__none__`
        : namespace
          ? `/api/images?namespace=${encodeURIComponent(namespace)}`
          : '/api/images';
      const response = await fetch(url);
      const data = await response.json();
      if (Array.isArray(data.images)) {
        syncImages(data.images);
      }
    } catch (error) {
      console.error('Failed to refresh images', error);
    }
  }, [syncImages, id, namespace]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        if (!id) {
          return;
        }
        const url = namespace === ''
          ? `/api/images?namespace=__none__`
          : namespace
            ? `/api/images?namespace=${encodeURIComponent(namespace)}`
            : '/api/images';
        const res = await fetch(url);
        const data = await res.json();
        if (!mounted) return;
        if (Array.isArray(data.images)) {
          syncImages(data.images);
        }
      } catch (err) {
        console.error('Failed to fetch image from API', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id, namespace, syncImages]);

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

  const parentImage = useMemo(() => {
    if (!image?.parentId) return null;
    return allImages.find((img) => img.id === image.parentId) || null;
  }, [allImages, image?.parentId]);

  const displayedVariations = useMemo(() => {
    if (!variationCandidates.length) {
      return [];
    }
    const baseIndex = new Map(variationCandidates.map((child, index) => [child.id, index]));
    const hasSort = variationCandidates.some((child) => Number.isFinite(child.variationSort));
    const baseOrdered = hasSort
      ? [...variationCandidates].sort((a, b) => {
          const aSort = Number.isFinite(a.variationSort) ? (a.variationSort as number) : null;
          const bSort = Number.isFinite(b.variationSort) ? (b.variationSort as number) : null;
          if (aSort === null && bSort === null) {
            return (baseIndex.get(a.id) ?? 0) - (baseIndex.get(b.id) ?? 0);
          }
          if (aSort === null) return 1;
          if (bSort === null) return -1;
          if (aSort !== bSort) return aSort - bSort;
          return (baseIndex.get(a.id) ?? 0) - (baseIndex.get(b.id) ?? 0);
        })
      : variationCandidates;

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

  const pagedVariations = useMemo(() => {
    const start = (variationPage - 1) * VARIATION_PAGE_SIZE;
    return displayedVariations.slice(start, start + VARIATION_PAGE_SIZE);
  }, [displayedVariations, variationPage]);

  const totalVariationPages = Math.max(
    1,
    Math.ceil(displayedVariations.length / VARIATION_PAGE_SIZE)
  );

  const parentWithChildren = useMemo(() => {
    const set = new Set<string>();
    allImages.forEach((img) => {
      if (img.parentId) {
        set.add(img.parentId);
      }
    });
    return set;
  }, [allImages]);

  const adoptableImages = useMemo(
    () => allImages.filter((img) => !img.parentId && !parentWithChildren.has(img.id) && img.id !== id),
    [allImages, id, parentWithChildren]
  );

  const filteredAdoptableImages = useMemo(() => {
    const base = adoptableImages.filter((img) => {
      if (!adoptFolderFilter) return true;
      return (img.folder || '').toLowerCase() === adoptFolderFilter.toLowerCase();
    });

    if (!adoptSearch.trim()) {
      return base;
    }

    const term = adoptSearch.toLowerCase();
    return base.filter((img) => {
      const haystack = [
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
  }, [adoptSearch, adoptableImages, adoptFolderFilter]);

  const totalAdoptPages = Math.max(1, Math.ceil(filteredAdoptableImages.length / ADOPT_PAGE_SIZE));
  const pagedAdoptableImages = useMemo(() => {
    const start = (adoptPage - 1) * ADOPT_PAGE_SIZE;
    return filteredAdoptableImages.slice(start, start + ADOPT_PAGE_SIZE);
  }, [filteredAdoptableImages, adoptPage]);

  const variants = useMemo(
    () => (id ? getMultipleImageUrls(id, ['thumbnail','small','medium','large','xlarge','original']) : {}),
    [id]
  );

  const shareVariantOptions = useMemo(
    () =>
      IMAGE_VARIANTS.map((variant) => ({
        value: variant.name,
        label: variant.width ? `${variant.name} (${variant.width}px)` : variant.name
      })),
    []
  );

  const listVariantOptions = useMemo(
    () =>
      IMAGE_VARIANTS.map((variant) => ({
        value: variant.name,
        label: variant.width ? `${variant.name} (${variant.width}px)` : variant.name
      })),
    []
  );

  const originalDeliveryUrl = useMemo(
    () => (id ? getCloudflareImageUrl(id, 'original') : ''),
    [id]
  );

  const shareUrl = useMemo(() => {
    if (!id) return '';
    if (!shareBaseUrl.trim()) return '';
    try {
      const url = new URL(`/api/images/${id}/share`, shareBaseUrl.trim());
      if (shareVariant) {
        url.searchParams.set('variant', shareVariant);
      }
      return url.toString();
    } catch {
      return '';
    }
  }, [id, shareBaseUrl, shareVariant]);

  useEffect(() => {
    if (!shareUrl) {
      setShareQrDataUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(shareUrl, { margin: 1, width: 220 })
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
  }, [shareUrl]);

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

  const metadataByteSize = useMemo(() => {
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
    const cleanDescription =
      typeof descriptionInput === 'string' ? cleanString(descriptionInput) : undefined;
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
    metadata.description = cleanDescription ?? '';
    const cleanedOriginalUrl = cleanString(originalUrlInput);
    metadata.originalUrl = cleanedOriginalUrl ?? '';
    metadata.originalUrlNormalized = normalizeOriginalUrl(cleanedOriginalUrl) ?? '';
    const cleanedSourceUrl = cleanString(sourceUrlInput);
    metadata.sourceUrl = cleanedSourceUrl ?? '';
    metadata.sourceUrlNormalized = normalizeOriginalUrl(cleanedSourceUrl) ?? '';
    const cleanedDisplayName = cleanString(displayNameInput);
    metadata.displayName = cleanedDisplayName ?? '';
    const cleanAltTag = cleanString(altTextInput) ?? '';
    metadata.altTag = cleanAltTag;
    const compact = pickCloudflareMetadata(metadata);
    try {
      return new TextEncoder().encode(JSON.stringify(compact)).length;
    } catch {
      return 0;
    }
  }, [
    altTextInput,
    descriptionInput,
    displayNameInput,
    folderSelect,
    image,
    newFolderInput,
    originalUrlInput,
    sourceUrlInput,
    tagsInput
  ]);

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
  const hasMissingVariationSort = useMemo(() => {
    return variationCandidates.some((child) => !Number.isFinite(child.variationSort));
  }, [variationCandidates]);
  const variationOrderIndex = useMemo(() => {
    return new Map(displayedVariations.map((child, index) => [child.id, index]));
  }, [displayedVariations]);
  const selectedVariationCount = selectedVariationIds.size;
  const variationAltBusy = useMemo(
    () => Object.keys(variationAltLoadingMap).length > 0,
    [variationAltLoadingMap]
  );
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
    const imageDescription = image.description ?? '';
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
    return false;
  }, [
    altTextInput,
    descriptionInput,
    displayNameInput,
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
      Object.keys(altLoadingMap).length > 0 ||
      variationAltBusy,
    [
      altLoadingMap,
      bulkAltApplying,
      bulkDescriptionApplying,
      childUploadLoading,
      descriptionGenerating,
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

  const reassignParentOptions = useMemo(
    () => [
      { value: '', label: 'No parent (make canonical)' },
      ...adoptableImages.map((candidate) => ({
        value: candidate.id,
        label: candidate.filename || candidate.id
      }))
    ],
    [adoptableImages]
  );

  const adoptFolderOptions = useMemo(
    () => [
      { value: '', label: 'All folders' },
      ...uniqueFolders.map((folder) => ({ value: folder, label: folder }))
    ],
    [uniqueFolders]
  );

  const copyToClipboard = async (text: string, label?: string, successMessage?: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        toast.push(successMessage || (label ? `${label} URL copied` : 'Text copied to clipboard'));
        return;
      }

      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        toast.push(successMessage || (label ? `${label} URL copied` : 'Text copied to clipboard'));
      } catch (e) {
        console.error('Fallback copy failed', e);
        prompt('Copy this text manually:', text);
      }
      document.body.removeChild(textArea);
    } catch (err) {
      console.error('Failed to copy', err);
      prompt('Copy this text manually:', text);
    }
  };

  const formatCopyPayload = (url: string, altText?: string, includeAlt?: boolean) => {
    if (!includeAlt) {
      return url;
    }
    return `url: ${JSON.stringify(url)},\naltText: ${JSON.stringify(altText ?? '')}`;
  };

  const handleCopyUrl = async (
    event: React.MouseEvent<HTMLButtonElement>,
    url: string,
    label?: string,
    altText?: string,
    successMessage?: string
  ) => {
    const payload = formatCopyPayload(url, altText, event.shiftKey);
    await copyToClipboard(payload, label, successMessage);
  };

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
    const buildEntry = (img: CloudflareImage) => ({
      url: ensureWebpFormat(getCloudflareImageUrl(img.id, listVariant)),
      altText: img.altTag || ''
    });
    const entries = [buildEntry(image), ...displayedVariations.map(buildEntry)];
    const payload = formatEntriesAsYaml(entries);
    await copyToClipboard(payload, undefined, 'Variant list copied');
  }, [copyToClipboard, displayedVariations, image, listVariant]);

  const persistVariationOrder = useCallback(
    async (nextOrder: string[], changedIds: string[]) => {
      if (!image) {
        return;
      }
      setVariationOrderOverride(nextOrder);
      setVariationOrderSaving(true);
      try {
        const indexById = new Map(nextOrder.map((idValue, index) => [idValue, index]));
        const idsToUpdate = hasMissingVariationSort ? nextOrder : changedIds;
        const uniqueIds = Array.from(new Set(idsToUpdate));
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
    [hasMissingVariationSort, image, toast]
  );

  const handleMoveVariation = useCallback(
    async (childId: string, direction: -1 | 1) => {
      if (!image || image.parentId) {
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
    setDescriptionInput(image.description || '');
    setAltTextInput(image.altTag || '');
    setOriginalUrlInput(image.originalUrl || '');
    setSourceUrlInput(image.sourceUrl || '');
    setDisplayNameInput(image.displayName || image.filename || '');
  }, [image]);

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
      const payload = {
        folder: finalFolder,
        tags: tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [],
        description: descriptionInput,
        originalUrl: cleanedOriginalUrl ?? '',
        sourceUrl: cleanedSourceUrl ?? '',
        displayName: cleanString(displayNameInput) ?? '',
        altTag: cleanString(altTextInput) ?? '',
      };
      const res = await fetch(`/api/images/${id}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json() as CloudflareImage;
      if (res.ok) {
        toast.push('Metadata updated');
        setImage(prev => prev ? ({ ...prev, folder: body.folder, tags: body.tags, description: body.description, originalUrl: body.originalUrl, sourceUrl: body.sourceUrl, displayName: body.displayName, altTag: body.altTag }) : prev);
        await refreshImageList();
      } else {
        toast.push(body.error || 'Failed to update metadata');
      }
    } catch (err) {
      console.error('Update failed', err);
      toast.push('Failed to update metadata');
    } finally {
      setSaving(false);
    }
  }, [
    altTextInput,
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

  const generateAltForSelectedVariations = useCallback(async () => {
    const ids = Array.from(selectedVariationIds);
    if (ids.length === 0) {
      toast.push('Select at least one variation');
      return;
    }
    setVariationAltLoadingMap((prev) => {
      const next = { ...prev };
      ids.forEach((idValue) => {
        next[idValue] = true;
      });
      return next;
    });
    let updatedCount = 0;
    try {
      for (const idValue of ids) {
        const response = await fetch(`/api/images/${idValue}/alt`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok || !data?.altTag) {
          continue;
        }
        updatedCount += 1;
        setAllImages((prev) =>
          prev.map((img) => (img.id === idValue ? { ...img, altTag: data.altTag } : img))
        );
        setImage((prev) => (prev?.id === idValue ? { ...prev, altTag: data.altTag } : prev));
      }
      toast.push(updatedCount ? `ALT text generated for ${updatedCount} variation(s)` : 'No ALT text generated');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate ALT text';
      toast.push(message);
    } finally {
      setVariationAltLoadingMap((prev) => {
        const next = { ...prev };
        ids.forEach((idValue) => {
          delete next[idValue];
        });
        return next;
      });
    }
  }, [selectedVariationIds, toast]);

  const handleDropVariation = useCallback(
    async (targetId: string) => {
      if (!draggingVariationId || draggingVariationId === targetId) {
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

  const patchParentAssignment = useCallback(
    async (targetId: string, parentIdValue: string) => {
      const response = await fetch(`/api/images/${targetId}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: parentIdValue }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update parent relationship');
      }
      await refreshImageList();
      return payload;
    },
    [refreshImageList]
  );

  const handleDetachFromParent = useCallback(async () => {
    if (!image) return;
    setParentActionLoading(true);
    try {
      await patchParentAssignment(image.id, '');
      toast.push('Image detached from its parent');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to detach image';
      toast.push(message);
    } finally {
      setParentActionLoading(false);
    }
  }, [image, patchParentAssignment, toast]);

  const handleReassignParent = useCallback(async () => {
    if (!image) return;
    if (reassignParentId === (image.parentId ?? '')) {
      return;
    }
    setParentActionLoading(true);
    try {
      await patchParentAssignment(image.id, reassignParentId || '');
      toast.push('Parent updated');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update parent';
      toast.push(message);
    } finally {
      setParentActionLoading(false);
    }
  }, [image, patchParentAssignment, reassignParentId, toast]);

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

  const handleDeleteChild = useCallback(async (childId: string) => {
    if (!confirm('Delete this variation permanently?')) return;
    try {
      const response = await fetch(`/api/images/${childId}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'Failed to delete image');
      }
      toast.push('Image deleted');
      setAllImages(prev => prev.filter(img => img.id !== childId));
      setVariationPage(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete image';
      toast.push(message);
    }
  }, [toast]);

  const handleDeleteParent = useCallback(async () => {
    if (!image) return;
    if (!confirm('Delete this image permanently? All variations will be detached.')) return;
    try {
      const response = await fetch(`/api/images/${image.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'Failed to delete image');
      }
      toast.push('Image deleted');
      window.location.href = '/';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete image';
      toast.push(message);
    }
  }, [image, toast]);

  const handleDeleteCurrent = useCallback(async () => {
    if (!image) return;
    const prompt = isChildImage
      ? 'Delete this image variation permanently?'
      : 'Delete this image permanently? All variations will be detached.';
    if (!confirm(prompt)) return;
    try {
      const response = await fetch(`/api/images/${image.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'Failed to delete image');
      }
      toast.push('Image deleted');
      window.location.href = '/';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete image';
      toast.push(message);
    }
  }, [image, isChildImage, toast]);

  const handleAdoptImage = useCallback(async () => {
    if (!adoptImageId) {
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

  const handleChildUpload = useCallback(async () => {
    if (!id || childUploadFiles.length === 0) return;
    setChildUploadLoading(true);
    try {
      const defaultFolder = childUploadFolder.trim() || image?.folder || '';
      const defaultTags = childUploadTags.trim() || (image?.tags ? image.tags.join(', ') : '');
      let successCount = 0;
      const failures: { filename: string; error: string }[] = [];
      const skipped: { filename: string; reason: string }[] = [];
      for (const file of childUploadFiles) {
        const formData = new FormData();
        formData.append('file', file);
        if (defaultFolder) formData.append('folder', defaultFolder);
        if (defaultTags) formData.append('tags', defaultTags);
        formData.append('parentId', id);

        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
        const payload = await response.json();
        if (!response.ok) {
          failures.push({
            filename: file.name,
            error: payload.error || 'Upload failed'
          });
          continue;
        }
        if (payload && Array.isArray(payload.results)) {
          successCount += payload.results.length;
          if (Array.isArray(payload.failures)) {
            failures.push(...payload.failures);
          }
          if (Array.isArray(payload.skipped)) {
            skipped.push(...payload.skipped);
          }
        } else {
          successCount += 1;
        }
      }
      if (successCount > 0) {
        toast.push(`Uploaded ${successCount} variation(s)`);
        await refreshImageList();
      } else {
        toast.push('No variations uploaded');
      }
      if (failures.length) {
        const failureNames: BulkUpdateFailure[] = failures.map(item => ({ id: item.filename, name: item.filename }));
        toast.push(`Failed: ${formatFailureNames(failureNames)}`);
      }
      if (skipped.length) {
        const skippedNames: BulkUpdateFailure[] = skipped.map(item => ({ id: item.filename, name: item.filename }));
        toast.push(`Skipped: ${formatFailureNames(skippedNames)}`);
      }
      setChildUploadFiles([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload variation';
      toast.push(message);
    } finally {
      setChildUploadLoading(false);
    }
  }, [childUploadFiles, childUploadFolder, childUploadTags, id, refreshImageList, toast]);

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

  const generateAltTag = useCallback(async (targetId: string) => {
    setAltLoadingMap(prev => ({ ...prev, [targetId]: true }));
    try {
      const response = await fetch(`/api/images/${targetId}/alt`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data?.altTag) {
        toast.push(data?.error || 'Failed to generate description');
        return;
      }
      setImage(prev => prev && prev.id === targetId ? { ...prev, altTag: data.altTag } : prev);
      if (targetId === id) {
        setAltTextInput(data.altTag);
      }
      setAllImages(prev => prev.map(img => img.id === targetId ? { ...img, altTag: data.altTag } : img));
      toast.push('ALT text updated');
    } catch (error) {
      console.error('Failed to generate ALT text:', error);
      toast.push('Failed to generate ALT text');
    } finally {
      setAltLoadingMap(prev => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
    }
  }, [toast, id]);

  const generateDescription = useCallback(async () => {
    if (!image?.id) {
      return;
    }
    setDescriptionGenerating(true);
    try {
      const response = await fetch(`/api/images/${image.id}/description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          existingDescription: descriptionInput || ''
        })
      });
      const data = await response.json();
      if (!response.ok || !data?.description) {
        toast.push(data?.error || 'Failed to generate description');
        return;
      }
      const generatedText: string = data.description;
      const appendText = (current?: string | null) => {
        const base = typeof current === 'string' ? current : '';
        return base.trim() ? `${base}\n\n${generatedText}` : generatedText;
      };
      setDescriptionInput(prev => appendText(prev));
      setImage(prev => {
        if (!prev || prev.id !== image.id) {
          return prev;
        }
        return {
          ...prev,
          description: appendText(prev.description)
        };
      });
      setAllImages(prev =>
        prev.map(img =>
          img.id === image.id ? { ...img, description: appendText(img.description) } : img
        )
      );
      toast.push('Generated description appended (Save to persist)');
    } catch (error) {
      console.error('Failed to generate description:', error);
      toast.push('Failed to generate description');
    } finally {
      setDescriptionGenerating(false);
    }
  }, [image, descriptionInput, toast]);

  const applyDescriptionToVariations = useCallback(async () => {
    if (isChildImage) {
      return;
    }
    const trimmed = descriptionInput.trim();
    if (!trimmed) {
      toast.push('Add a description first');
      return;
    }
    if (!variationChildren.length) {
      toast.push('No variations to update');
      return;
    }
    setBulkDescriptionApplying(true);
    try {
      const results = await Promise.all(
        variationChildren.map(async (child) => {
          try {
            const res = await fetch(`/api/images/${child.id}/update`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ description: trimmed })
            });
            const payload = await res.json().catch(() => ({}));
            return { ok: res.ok, error: payload?.error, id: child.id };
          } catch (err) {
            console.error('Bulk description apply error', err);
            return { ok: false, error: 'Network error', id: child.id };
          }
        })
      );
      const failures = results.filter(result => !result.ok);
      const successCount = results.length - failures.length;
      if (successCount) {
        setAllImages(prev =>
          prev.map(img => (img.parentId === id ? { ...img, description: trimmed } : img))
        );
      }
      if (failures.length) {
        toast.push(`Updated ${successCount}/${variationChildren.length} variations (some failed)`);
      } else {
        toast.push(`Description applied to ${variationChildren.length} variations`);
      }
    } catch (err) {
      console.error('Failed to bulk apply description', err);
      toast.push('Failed to apply description to variations');
    } finally {
      setBulkDescriptionApplying(false);
    }
  }, [descriptionInput, variationChildren, isChildImage, toast, id]);

  const applyAltToVariations = useCallback(async () => {
    if (isChildImage) {
      return;
    }
    const trimmed = altTextInput.trim();
    if (!trimmed) {
      toast.push('Add ALT text first');
      return;
    }
    if (!variationChildren.length) {
      toast.push('No variations to update');
      return;
    }
    setBulkAltApplying(true);
    try {
      const results = await Promise.all(
        variationChildren.map(async (child) => {
          try {
            const res = await fetch(`/api/images/${child.id}/update`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ altTag: trimmed })
            });
            const payload = await res.json().catch(() => ({}));
            return { ok: res.ok, error: payload?.error, id: child.id };
          } catch (err) {
            console.error('Bulk ALT apply error', err);
            return { ok: false, error: 'Network error', id: child.id };
          }
        })
      );
      const failures = results.filter(result => !result.ok);
      const successCount = results.length - failures.length;
      if (successCount) {
        setAllImages(prev =>
          prev.map(img => (img.parentId === id ? { ...img, altTag: trimmed } : img))
        );
      }
      if (failures.length) {
        toast.push(`Updated ${successCount}/${variationChildren.length} variations (some failed)`);
      } else {
        toast.push(`ALT text applied to ${variationChildren.length} variations`);
      }
    } catch (err) {
      console.error('Failed to bulk apply ALT text', err);
      toast.push('Failed to apply ALT text to variations');
    } finally {
      setBulkAltApplying(false);
    }
  }, [altTextInput, variationChildren, isChildImage, toast, id]);

  const applyFolderToVariations = useCallback(async () => {
    if (isChildImage) {
      return;
    }
    if (!variationChildren.length) {
      toast.push('No variations to update');
      return;
    }
    if (!effectiveParentFolder) {
      toast.push('Parent has no folder set');
      return;
    }
    setBulkFolderApplying(true);
    try {
      type BulkUpdateResult =
        | { ok: true; id: string }
        | ({ ok: false } & BulkUpdateFailure);
      const results: BulkUpdateResult[] = await Promise.all(
        variationChildren.map(async (child) => {
          try {
            const res = await fetch(`/api/images/${child.id}/update`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ folder: effectiveParentFolder })
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
              const errorMessage = payload?.error || 'Failed to update folder';
              return {
                ok: false,
                id: child.id,
                name: child.filename || child.id,
                error: errorMessage,
                reason: isMetadataLimitError(errorMessage) ? 'metadata' : 'unknown'
              };
            }
            return { ok: true, id: child.id };
          } catch (err) {
            console.error('Bulk folder apply error', err);
            return {
              ok: false,
              id: child.id,
              name: child.filename || child.id,
              error: 'Network error',
              reason: 'network'
            };
          }
        })
      );

      const failures = results.filter((result): result is BulkUpdateFailure => !result.ok);
      const successIds = new Set(results.filter((result) => result.ok).map((result) => result.id));
      if (successIds.size) {
        setAllImages((prev) =>
          prev.map((img) => (successIds.has(img.id) ? { ...img, folder: effectiveParentFolder } : img))
        );
      }

      if (failures.length) {
        const metadataFailures = failures.filter((failure) => failure.reason === 'metadata');
        if (metadataFailures.length) {
          console.warn('Metadata too large for variations:', metadataFailures);
          toast.push(
            `Metadata too large for ${metadataFailures.length} variation(s): ${formatFailureNames(metadataFailures)}`
          );
        }
        const otherFailures = failures.filter((failure) => failure.reason !== 'metadata');
        if (otherFailures.length) {
          toast.push(`Failed to update ${otherFailures.length} variation(s)`);
        }
        const successCount = variationChildren.length - failures.length;
        if (successCount) {
          toast.push(`Updated ${successCount}/${variationChildren.length} variations`);
        }
      } else {
        toast.push(`Folder applied to ${variationChildren.length} variations`);
      }
    } catch (err) {
      console.error('Failed to bulk apply folder', err);
      toast.push('Failed to apply folder to variations');
    } finally {
      setBulkFolderApplying(false);
    }
  }, [effectiveParentFolder, isChildImage, toast, variationChildren]);

  const applyTagsToVariations = useCallback(
    async (mode: 'append' | 'replace') => {
      if (isChildImage) {
        return;
      }
      if (!variationChildren.length) {
        toast.push('No variations to update');
        return;
      }
      if (mode === 'append' && parentTags.length === 0) {
        toast.push('No parent tags to append');
        return;
      }

      if (mode === 'append') {
        setBulkTagsAppending(true);
      } else {
        setBulkTagsReplacing(true);
      }

      try {
        type BulkUpdateResult =
          | { ok: true; id: string; tags: string[] }
          | ({ ok: false } & BulkUpdateFailure);
        const results: BulkUpdateResult[] = await Promise.all(
          variationChildren.map(async (child) => {
            const existingTags = Array.isArray(child.tags) ? child.tags : [];
            const nextTags =
              mode === 'append'
                ? Array.from(new Set([...existingTags, ...parentTags].map((tag) => tag.trim()).filter(Boolean)))
                : [...parentTags];
            try {
              const res = await fetch(`/api/images/${child.id}/update`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: nextTags })
              });
              const payload = await res.json().catch(() => ({}));
              if (!res.ok) {
                const errorMessage = payload?.error || 'Failed to update tags';
                return {
                  ok: false,
                  id: child.id,
                  name: child.filename || child.id,
                  error: errorMessage,
                  reason: isMetadataLimitError(errorMessage) ? 'metadata' : 'unknown'
                };
              }
              return { ok: true, id: child.id, tags: nextTags };
            } catch (err) {
              console.error('Bulk tags apply error', err);
              return {
                ok: false,
                id: child.id,
                name: child.filename || child.id,
                error: 'Network error',
                reason: 'network'
              };
            }
          })
        );

        const failures = results.filter((result): result is BulkUpdateFailure => !result.ok);
        const tagsById = new Map(
          results.filter((result): result is { ok: true; id: string; tags: string[] } => result.ok).map((result) => [
            result.id,
            result.tags
          ])
        );

        if (tagsById.size) {
          setAllImages((prev) =>
            prev.map((img) => {
              const nextTags = tagsById.get(img.id);
              if (!nextTags) return img;
              return { ...img, tags: nextTags };
            })
          );
        }

        if (failures.length) {
          const metadataFailures = failures.filter((failure) => failure.reason === 'metadata');
          if (metadataFailures.length) {
            console.warn('Metadata too large for variations:', metadataFailures);
            toast.push(
              `Metadata too large for ${metadataFailures.length} variation(s): ${formatFailureNames(metadataFailures)}`
            );
          }
          const otherFailures = failures.filter((failure) => failure.reason !== 'metadata');
          if (otherFailures.length) {
            toast.push(`Failed to update ${otherFailures.length} variation(s)`);
          }
          const successCount = variationChildren.length - failures.length;
          if (successCount) {
            toast.push(`Updated ${successCount}/${variationChildren.length} variations`);
          }
        } else {
          toast.push(
            mode === 'append'
              ? `Tags appended to ${variationChildren.length} variations`
              : `Tags replaced on ${variationChildren.length} variations`
          );
        }
      } catch (err) {
        console.error('Failed to bulk apply tags', err);
        toast.push('Failed to apply tags to variations');
      } finally {
        if (mode === 'append') {
          setBulkTagsAppending(false);
        } else {
          setBulkTagsReplacing(false);
        }
      }
    },
    [isChildImage, parentTags, toast, variationChildren]
  );

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
      <div id="image-detail-container" className="max-w-4xl mx-auto bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-6">
          <div id="detail-navigation" className="flex items-center justify-between mb-4">
            <Link href="/" className="text-xs text-blue-600 underline">
              ← Back to gallery
            </Link>
          </div>
          <div id="image-hero-section" className="w-full mb-4">
            <div className="relative w-full aspect-[3/2] bg-gray-100 rounded overflow-hidden">
              <Image
                src={originalDeliveryUrl}
                alt={image.filename || 'image'}
                fill
                className="object-contain"
                unoptimized
                priority
                style={heroRotationStyle}
              />
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
                      onClick={() => copyToClipboard(rotatedAsset.url, 'Rotated image', 'Rotated URL copied')}
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
            <p className="text-xs mono font-semibold text-gray-900">{image.filename || 'Image'}</p>
            <p className="text-xs text-gray-500 mt-1">
              Uploaded {new Date(image.uploaded).toLocaleString()}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
              <span className="text-gray-500">Image ID</span>
              <span className="font-mono text-gray-800">{image.id}</span>
              <button
                onClick={async () => { await copyToClipboard(image.id, 'Image ID', 'Image ID copied'); }}
                className="px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-100 text-[10px]"
              >
                Copy
              </button>
            </div>
            <AspectRatioDisplay imageId={image.id} />
          </div>

          <div id="image-metadata-section" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-mono text-gray-700 bg-gray-100 border border-gray-200 rounded-full px-3 py-1">
                Metadata: {metadataByteSize} bytes
              </span>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className={`px-2 py-1 rounded-full border ${isMetadataDirty ? 'border-amber-300 bg-amber-50 text-amber-800' : pendingAutoSave ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                  {isMetadataDirty ? 'Unsaved changes' : pendingAutoSave ? 'Saving…' : 'All changes saved'}
                </span>
                <button
                  onClick={handleCancelMetadata}
                  disabled={!isMetadataDirty || saving}
                  className="px-2 py-1 text-[11px] border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  onClick={handleSaveMetadata}
                  disabled={!isMetadataDirty || saving}
                  className="px-2 py-1 text-[11px] border border-gray-300 rounded-md text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
            <div id="description-section">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-mono font-medum text-gray-700">Description</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={generateDescription}
                    disabled={descriptionGenerating}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    {descriptionGenerating ? 'Generating…' : 'Generate description'}
                  </button>
                  {hasVariations && (
                    <button
                      onClick={applyDescriptionToVariations}
                      disabled={bulkDescriptionApplying || !descriptionInput.trim()}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
                    >
                      {bulkDescriptionApplying ? 'Applying…' : 'Apply to variations'}
                    </button>
                  )}
                </div>
              </div>
              <textarea
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
                className="w-full font-mono text-xs border border-gray-300 rounded-md px-3 py-2 mt-2"
                rows={3}
                placeholder="Add a short description"
              />
            </div>

            <div id="alt-text-section">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-mono font-medum text-gray-700">Alt text</p>
                  <p className="text-[10px] text-gray-500">Used by screen readers and assistive tech.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => generateAltTag(image.id)}
                    disabled={Boolean(altLoadingMap[image.id])}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    {altLoadingMap[image.id] ? 'Generating…' : image.altTag ? 'Refresh ALT text' : 'Generate ALT text'}
                  </button>
                  {hasVariations && (
                    <button
                      onClick={applyAltToVariations}
                      disabled={bulkAltApplying || !altTextInput.trim()}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
                    >
                      {bulkAltApplying ? 'Applying…' : 'Apply to variations'}
                    </button>
                  )}
                </div>
              </div>
              <textarea
                value={altTextInput}
                onChange={(e) => setAltTextInput(e.target.value)}
                placeholder="No ALT text yet"
                className="w-full font-mono text-xs border border-gray-300 rounded-md px-3 py-2 mt-2 bg-white text-gray-800 min-h-[80px]"
              />
            </div>

            <div id="folder-section">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono font-medum text-gray-700">Folder</p>
                <FolderManagerButton
                  size="sm"
                  label="Manage"
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
                {hasVariations && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
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
                  </div>
                )}
              </div>
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs mt-2"
                placeholder="Comma-separated tags"
              />
              {hasVariations && parentTags.length === 0 && (
                <p className="text-[10px] text-gray-500 mt-1">Add tags to enable appending.</p>
              )}
            </div>

            <div id="name-section">
              <p className="text-xs font-mono font-medum text-gray-700">Display name (editable)</p>
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

            <div id="original-url-section">
              <p className="text-xs font-mono font-medum text-gray-700">Original URL</p>
              <div className="flex items-center gap-3 mt-2">
                <input
                  value={originalUrlInput}
                  onChange={(e) => setOriginalUrlInput(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-xs"
                  placeholder="Original source URL"
                />
                <button
                  onClick={async () => { await copyToClipboard(originalUrlInput || originalDeliveryUrl, 'Original'); }}
                  className="px-3 py-1 bg-blue-600 text-white rounded text-xs cursor-pointer transition transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
                >
                  Copy
                </button>
              </div>
              <div className="mt-3 space-y-1 text-[11px] font-mono text-gray-600">
                <div className="flex items-center gap-2">
                  <span className="text-gray-700">Normalized:</span>
                  <span className="truncate" title={image?.originalUrlNormalized || '—'}>
                    {image?.originalUrlNormalized || '—'}
                  </span>
                  {image?.originalUrlNormalized && (
                    <button
                      onClick={async () => { await copyToClipboard(image.originalUrlNormalized as string, 'Normalized URL'); }}
                      className="px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-100 text-[10px]"
                    >
                      Copy
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-700">Hash:</span>
                  <span className="truncate" title={image?.contentHash || '—'}>
                    {image?.contentHash || '—'}
                  </span>
                  {image?.contentHash && (
                    <button
                      onClick={async () => { await copyToClipboard(image.contentHash as string, 'Content hash'); }}
                      className="px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-100 text-[10px]"
                    >
                      Copy
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div id="source-url-section">
              <p className="text-xs font-mono font-medum text-gray-700">Source URL</p>
              <div className="flex items-center gap-3 mt-2">
                <input
                  value={sourceUrlInput}
                  onChange={(e) => setSourceUrlInput(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-xs"
                  placeholder="Page or site URL"
                />
                <button
                  onClick={async () => { await copyToClipboard(sourceUrlInput || '', 'Source'); }}
                  className="px-3 py-1 bg-blue-600 text-white rounded text-xs cursor-pointer transition transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
                  disabled={!sourceUrlInput}
                >
                  Copy
                </button>
              </div>
              <div className="mt-3 space-y-1 text-[11px] font-mono text-gray-600">
                <div className="flex items-center gap-2">
                  <span className="text-gray-700">Normalized:</span>
                  <span className="truncate" title={image?.sourceUrlNormalized || '—'}>
                    {image?.sourceUrlNormalized || '—'}
                  </span>
                  {image?.sourceUrlNormalized && (
                    <button
                      onClick={async () => { await copyToClipboard(image.sourceUrlNormalized as string, 'Normalized URL'); }}
                      className="px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-100 text-[10px]"
                    >
                      Copy
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div id="share-section" className="space-y-3">
              <p className="text-xs font-mono font-medum text-gray-700">Share (QR)</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex-1 space-y-2">
                  <label className="block text-[11px] text-gray-600">
                    Share base URL
                    <input
                      value={shareBaseUrl}
                      onChange={(e) => setShareBaseUrl(e.target.value)}
                      className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                      placeholder="http://192.168.x.x:3000"
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-gray-600">Share size</label>
                    <MonoSelect
                      id="share-variant"
                      value={shareVariant}
                      onChange={setShareVariant}
                      options={shareVariantOptions}
                      className="w-40 text-[11px]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={shareUrl}
                      readOnly
                      className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-xs bg-gray-50 text-gray-600"
                      placeholder="Share URL"
                    />
                    <button
                      onClick={async () => { if (shareUrl) await copyToClipboard(shareUrl, 'Share'); }}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-xs cursor-pointer transition transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
                      disabled={!shareUrl}
                    >
                      Copy
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500">
                    Use your network URL (from `next dev`) so your phone can reach it.
                  </p>
                </div>
                <div className="flex items-center justify-center w-full sm:w-auto">
                  {shareQrDataUrl ? (
                    <img
                      src={shareQrDataUrl}
                      alt="Share QR code"
                      className="w-[140px] h-[140px] border border-gray-200 rounded-md bg-white"
                    />
                  ) : (
                    <div className="w-[140px] h-[140px] border border-dashed border-gray-200 rounded-md flex items-center justify-center text-[10px] text-gray-400">
                      QR unavailable
                    </div>
                  )}
                </div>
              </div>
            </div>

            {exifEntries.length > 0 && (
              <div id="exif-section">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-mono font-medum text-gray-700">EXIF</p>
                  <p className="text-[10px] text-gray-500">{exifEntries.length} fields</p>
                </div>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {exifEntries.map(([key, value]) => (
                    <div key={key} className="flex items-start justify-between gap-3 border rounded px-2 py-1 text-[11px]">
                      <span className="text-gray-600 font-mono">{key}</span>
                      <span className="text-gray-900 font-mono break-all text-right">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div id="variant-links-section">
              <p className="text-xs font-mono font-medum text-gray-700">Available variants</p>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.entries(variants).map(([variant, url]) => {
                  const widthLabel = getVariantWidthLabel(String(variant));
                  return (
                    <div key={variant} className="flex flex-col gap-2 p-2 border rounded sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-mono font-semibold text-gray-900 capitalize flex items-center gap-2">
                          <span>{variant}</span>
                          {widthLabel && <span className="text-gray-400 normal-case">{widthLabel}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-600">Open</a>
                        <button
                          onClick={async (event) => { await handleCopyUrl(event, url, String(variant), image.altTag); }}
                          className="px-2 py-1 bg-blue-100 hover:bg-blue-200 active:bg-blue-300 rounded text-xs font-medium cursor-pointer transition transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-500 mt-2">Tip: Shift+Copy adds ALT text.</p>
            </div>

            <div className="space-y-4">
              {parentImage && (
                <div id="parent-info-section" className="border border-yellow-200 bg-yellow-50 rounded-lg p-4 space-y-3">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex-1">
                      {/* <p className="text-xs font-semibold text-yellow-800">
                        Member of {parentImage.filename || 'parent image'}
                      </p> */}
                      <p className="text-xs text-yellow-700">This image is stored as a variation.</p>
                    </div>
                    <Link
                      href={`/images/${parentImage.id}`}
                      className="flex items-center gap-3 text-left group"
                      onMouseMove={(e) =>
                        handleThumbMouseMove(
                          getCloudflareImageUrl(parentImage.id, 'w=800'),
                          parentImage.filename || 'Parent image',
                          e
                        )
                      }
                      onMouseLeave={handleThumbLeave}
                      prefetch={false}
                    >
                      <div className="relative w-40 h-28 sm:w-48 sm:h-32 rounded-xl overflow-hidden border-2 border-yellow-300 bg-white shadow-sm">
                        <Image
                          src={getCloudflareImageUrl(parentImage.id, 'w=600')}
                          alt={parentImage.filename || 'Parent image'}
                          fill
                          className="object-cover transition-transform duration-200 group-hover:scale-105"
                          sizes="192px"
                          unoptimized
                        />
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-yellow-700">Parent image</p>
                        <p className="text-xs font-semibold text-blue-700 underline decoration-dotted group-hover:text-blue-800">
                          View parent details →
                        </p>
                        <p className="text-xs text-gray-600 truncate max-w-[12rem]">
                          {parentImage.filename || parentImage.id}
                        </p>
                      </div>
                    </Link>
                    <button
                      onClick={handleDetachFromParent}
                      disabled={parentActionLoading}
                      className="px-3 py-1 text-xs border border-yellow-500 text-yellow-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {parentActionLoading ? 'Detaching…' : 'Detach'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="reassign-parent" className="text-xs font-medium text-gray-700">
                      Parent
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <MonoSelect
                        id="reassign-parent"
                        value={reassignParentId}
                        onChange={setReassignParentId}
                        options={reassignParentOptions}
                        className="flex-1"
                        placeholder="Select parent"
                      />
                      <button
                        onClick={handleReassignParent}
                        disabled={
                          parentActionLoading ||
                          reassignParentId === (image.parentId ?? '')
                        }
                        className="px-3 py-2 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {parentActionLoading ? 'Updating…' : 'Update parent'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div id="variations-section" className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-mono font-medum text-gray-700">
                      {isChildImage ? 'Other variations from this parent' : 'Variations'}
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-gray-500">
                        {variationCount}{' '}
                        {isChildImage ? 'other variation' : 'variation'}
                        {variationCount !== 1 ? 's' : ''}
                      </p>
                      {!isChildImage && (
                        <>
                        <div className="flex items-center gap-2">
                          <label htmlFor="copy-list-variant" className="text-[11px] text-gray-500">
                            List size
                          </label>
                          <MonoSelect
                            id="copy-list-variant"
                            value={listVariant}
                            onChange={setListVariant}
                            options={listVariantOptions}
                            className="w-32 text-[11px]"
                          />
                        </div>
                        <button
                          onClick={handleCopyList}
                          className="px-2 py-1 text-[11px] border border-gray-300 rounded-md text-blue-600 hover:bg-blue-50"
                        >
                          Copy list
                        </button>
                        <button
                          onClick={handleResetVariationOrder}
                          disabled={variationOrderSaving || !variationCandidates.length}
                          className="px-2 py-1 text-[11px] border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Reset order
                        </button>
                        <button
                          onClick={handleReverseVariationOrder}
                          disabled={variationOrderSaving || !variationCandidates.length}
                          className="px-2 py-1 text-[11px] border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Reverse order
                        </button>
                        <button
                          onClick={handleSortVariationOrder}
                          disabled={variationOrderSaving || !variationCandidates.length}
                          className="px-2 py-1 text-[11px] border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Sort A→Z
                        </button>
                        <button
                          onClick={handleDeleteParent}
                          className="px-2 py-1 text-[11px] border border-red-300 rounded-md text-red-600 hover:bg-red-50"
                        >
                          Delete image
                        </button>
                        </>
                      )}
                    </div>
                  </div>

                {variationCount === 0 ? (
                  <p className="text-xs text-gray-500">
                    {isChildImage
                      ? 'No other variations exist for this parent yet.'
                      : 'No variations have been added yet.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                      <span>{selectedVariationCount} selected</span>
                      <button
                        onClick={selectAllVariationsOnPage}
                        className="px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
                      >
                        Select page
                      </button>
                      <button
                        onClick={clearVariationSelection}
                        className="px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
                      >
                        Clear
                      </button>
                      <button
                        onClick={generateAltForSelectedVariations}
                        disabled={variationAltBusy || selectedVariationCount === 0}
                        className="px-2 py-1 border border-gray-300 rounded text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {variationAltBusy ? 'Generating ALT…' : 'Generate ALT'}
                      </button>
                    </div>
                    {pagedVariations.map((child) => (
                      <div
                        key={child.id}
                        className={`flex items-center gap-4 border border-gray-200 rounded-lg p-3 relative ${dragOverVariationId === child.id ? 'bg-blue-50 border-blue-200' : ''}`}
                        onMouseLeave={handleThumbLeave}
                        draggable={!isChildImage}
                        onDragStart={(event) => {
                          if (isChildImage) return;
                          setDraggingVariationId(child.id);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', child.id);
                        }}
                        onDragEnd={() => {
                          setDraggingVariationId(null);
                          setDragOverVariationId(null);
                        }}
                        onDragOver={(event) => {
                          if (isChildImage) return;
                          event.preventDefault();
                          setDragOverVariationId(child.id);
                        }}
                        onDrop={async (event) => {
                          if (isChildImage) return;
                          event.preventDefault();
                          await handleDropVariation(child.id);
                          setDraggingVariationId(null);
                          setDragOverVariationId(null);
                        }}
                      >
                        {(() => {
                          if (isChildImage) {
                            return null;
                          }
                          const orderIndex = variationOrderIndex.get(child.id) ?? -1;
                          const canMoveUp = orderIndex > 0;
                          const canMoveDown = orderIndex >= 0 && orderIndex < displayedVariations.length - 1;
                          return (
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => handleMoveVariation(child.id, -1)}
                                disabled={variationOrderSaving || !canMoveUp}
                                className="p-1 border rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                                title="Move up"
                                aria-label="Move variation up"
                              >
                                <ChevronUp className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => handleMoveVariation(child.id, 1)}
                                disabled={variationOrderSaving || !canMoveDown}
                                className="p-1 border rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                                title="Move down"
                                aria-label="Move variation down"
                              >
                                <ChevronDown className="h-3 w-3" />
                              </button>
                              <div className="mt-1 flex items-center justify-center text-gray-400">
                                <GripVertical className="h-3 w-3" />
                              </div>
                            </div>
                          );
                        })()}
                        <label className="flex items-center gap-2 text-xs text-gray-500">
                          <input
                            type="checkbox"
                            checked={selectedVariationIds.has(child.id)}
                            onChange={() => toggleVariationSelection(child.id)}
                            className="h-3 w-3 text-blue-600 border-gray-300 rounded"
                          />
                          select
                        </label>
                        <Link
                          href={`/images/${child.id}`}
                          className="w-32 h-24 relative rounded overflow-hidden bg-gray-100 block"
                          onMouseMove={(e) => handleThumbMouseMove(getCloudflareImageUrl(child.id, 'w=600'), child.filename || 'Variation', e)}
                        >
                          <Image
                            src={getCloudflareImageUrl(child.id, 'w=300')}
                            alt={child.filename || 'Variation'}
                            fill
                            className="object-cover"
                            sizes="64px"
                            unoptimized
                          />
                        </Link>
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-xs font-mono font-medum text-gray-900 truncate">{child.filename}</p>
                          <p className="text-xs text-gray-500">
                            Uploaded {new Date(child.uploaded).toLocaleDateString()}
                          </p>
                          <AspectRatioDisplay imageId={child.id} />
                          <div className="text-[11px] text-gray-500 break-words">
                            ALT: {child.altTag || '—'}
                          </div>
                          <button
                            onClick={() => setVariantModalState({ target: child })}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 underline"
                          >
                            View sizes
                          </button>
                        </div>
                        <div className="flex flex-col gap-2 items-end">
                          <button
                            onClick={async (event) => await handleCopyUrl(event, getCloudflareImageUrl(child.id, 'original'), 'Variation', child.altTag)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            Copy URL
                          </button>
                          {!isChildImage && (
                            <button
                              onClick={() => handleDetachChild(child.id)}
                              disabled={childDetachingId === child.id}
                              className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {childDetachingId === child.id ? 'Detaching…' : 'Detach'}
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteChild(child.id)}
                            className="px-3 py-1 text-[11px] border border-red-300 text-red-600 rounded-md hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {variationCount > VARIATION_PAGE_SIZE && (
                  <div className="flex items-center justify-between text-xs text-gray-600 pt-1">
                    <div>
                      Page {variationPage} of {totalVariationPages}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setVariationPage((p) => Math.max(1, p - 1))}
                        disabled={variationPage === 1}
                        className="px-2 py-1 border rounded disabled:opacity-50"
                      >
                        Prev
                      </button>
                      <button
                        onClick={() => setVariationPage((p) => Math.min(totalVariationPages, p + 1))}
                        disabled={variationPage === totalVariationPages}
                        className="px-2 py-1 border rounded disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>

            {!image.parentId && (
              <>
                <div id="adopt-variation-section" className="space-y-3 border border-dashed rounded-lg p-3 bg-gray-50">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <label htmlFor="adopt-search" className="text-xs font-medium text-gray-700">
                      Adopt existing image as a variation
                    </label>
                    <input
                      id="adopt-search"
                      type="text"
                      value={adoptSearch}
                      onChange={(e) => setAdoptSearch(e.target.value)}
                      placeholder="Search by name, folder, or tag"
                      className="w-full sm:w-64 border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <label htmlFor="adopt-folder" className="text-xs font-medium text-gray-700">Filter by folder</label>
                    <MonoSelect
                      id="adopt-folder"
                      value={adoptFolderFilter}
                      onChange={setAdoptFolderFilter}
                      options={adoptFolderOptions}
                      className="w-full sm:w-48"
                      placeholder="All folders"
                    />
                  </div>
                  {filteredAdoptableImages.length === 0 ? (
                    <p className="text-xs text-gray-500">No canonical images found. Upload a base image first.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {pagedAdoptableImages.map((candidate) => (
                        <div
                          key={candidate.id}
                          className="flex items-center gap-3 p-2 border rounded-md bg-white"
                          onMouseLeave={handleThumbLeave}
                        >
                          <Link
                            href={`/images/${candidate.id}`}
                            className="w-14 h-14 relative rounded overflow-hidden bg-gray-100 block"
                            onMouseMove={(e) => handleThumbMouseMove(getCloudflareImageUrl(candidate.id, 'w=600'), candidate.filename || 'Image', e)}
                          >
                            <Image
                              src={getCloudflareImageUrl(candidate.id, 'w=300')}
                              alt={candidate.filename || 'Image'}
                              fill
                              className="object-cover"
                              unoptimized
                            />
                          </Link>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono font-medum text-gray-900 truncate">{candidate.filename}</p>
                            <p className="text-xs text-gray-500 truncate">{candidate.folder || '[no folder]'}</p>
                          </div>
                <button
                  onClick={() => handleAssignExistingAsChild(candidate.id)}
                  disabled={assigningId === candidate.id}
                  className="px-3 py-1 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {assigningId === candidate.id ? 'Assigning…' : 'Assign'}
                </button>
              </div>
            ))}
          </div>
        )}
                  {filteredAdoptableImages.length > ADOPT_PAGE_SIZE && (
                    <div className="flex items-center justify-between text-xs text-gray-600 pt-1">
                      <div>
                        Page {adoptPage} of {totalAdoptPages}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setAdoptPage((p) => Math.max(1, p - 1))}
                          disabled={adoptPage === 1}
                          className="px-2 py-1 border rounded disabled:opacity-50"
                        >
                          Prev
                        </button>
                        <button
                          onClick={() => setAdoptPage((p) => Math.min(totalAdoptPages, p + 1))}
                          disabled={adoptPage === totalAdoptPages}
                          className="px-2 py-1 border rounded disabled:opacity-50"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div id="upload-variation-section" className="space-y-3 border border-dashed rounded-lg p-3 bg-blue-50">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-mono font-medum text-gray-800">Upload a new variation</h3>
                      <p className="text-xs text-gray-600">Files automatically inherit this image's folder and tags.</p>
                      <p className="text-[11px] text-gray-500">.zip uploads are supported.</p>
                    </div>
                  </div>
                  <div
                    {...getVariantDropzoneProps()}
                    className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${isVariantDragActive ? 'border-blue-500 bg-blue-100' : 'border-gray-300 bg-white hover:border-gray-400'}`}
                  >
                    <input {...getVariantInputProps()} />
                    <p className="text-xs font-mono text-gray-900 mb-1">Drag & drop images or a .zip here</p>
                    <p className="text-[11px] text-gray-500">or click to browse files (.zip supported)</p>
                  </div>
                  <div className="text-[11px] text-gray-600 bg-white/70 border border-gray-200 rounded-md p-2">
                    <p>Folder: <span className="font-mono">{childUploadFolder || image.folder || '[none]'}</span></p>
                    <p>Tags: <span className="font-mono">{childUploadTags || (image.tags && image.tags.length > 0 ? image.tags.join(', ') : '[none]')}</span></p>
                  </div>
                  {childUploadFiles.length > 0 && (
                    <div className="text-xs text-gray-700 space-y-1">
                      {childUploadFiles.map((file, idx) => (
                        <p key={`${file.name}-${idx}`} className="truncate">
                          • {file.name}
                        </p>
                      ))}
                      <button
                        type="button"
                        onClick={() => setChildUploadFiles([])}
                        className="mt-2 px-2 py-1 text-[11px] text-red-600 border border-red-200 rounded-md hover:bg-red-50"
                      >
                        Clear selected files
                      </button>
                    </div>
                  )}
                  <button
                    onClick={handleChildUpload}
                    disabled={childUploadLoading || childUploadFiles.length === 0}
                    className="px-4 py-2 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {childUploadLoading ? 'Uploading…' : 'Upload variation(s)'}
                  </button>
                </div>
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
          getMultipleImageUrls(target.id, ['thumbnail','small','medium','large','xlarge','original'])
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
