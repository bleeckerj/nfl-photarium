'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Loader2 } from "lucide-react";
import clsx from "clsx";
import { normalizeOriginalUrl } from "@/utils/urlNormalization";
import { inferAssetTypeFromUrl, isImageOnlyImportError } from "@/utils/mediaAssetType";
import { appendTextToFilename, removeFilenameExtension } from "@/utils/filename";
import { usePageImportSession } from "@/features/page-import/hooks/usePageImportSession";
import { usePageImportDiscovery } from "@/features/page-import/hooks/usePageImportDiscovery";
import { useCandidateMetadataEnrichment } from "@/features/page-import/hooks/useCandidateMetadataEnrichment";
import { PageImportControls } from "@/features/page-import/components/PageImportControls";
import { PageImportQueue } from "@/features/page-import/components/PageImportQueue";
import type { UploaderQueueItem } from "@/features/page-import/types";
import { unselectAttemptedQueuedItems } from "@/features/page-import/utils/queueSelection";
import ActivityIndicator, { type ActivityStats } from "@/components/image-uploader/ActivityIndicator";
import { NAMESPACE_REQUIRED_UPLOAD_ERROR, QUEUE_RENDER_LIMIT } from "@/components/image-uploader/constants";
import type { GalleryImageSummary, UploadedImage } from "@/components/image-uploader/types";
import { useUploadActivity } from "@/components/image-uploader/useUploadActivity";
import { useUploaderUploadActions } from "@/components/image-uploader/useUploaderUploadActions";
import UploadedImagesList from "@/components/image-uploader/UploadedImagesList";
import UploaderMetadataControls from "@/components/image-uploader/UploaderMetadataControls";
import UploadNamespaceControls from "@/components/image-uploader/UploadNamespaceControls";
import {
  MAX_UPLOAD_IMAGE_BYTES,
  base64ToFile,
  buildUploaderGallerySummaryUrl,
  extractKeynoteImages,
  extractZipImages,
  getFileSourcePath,
  inferAssetTypeFromFile,
  isArchiveFile,
  isImageFile,
  isKeynoteFile,
  isZipFile,
  mergeTagInputs,
  reduceImageFileToLimit,
  resolveTagInput,
} from "@/components/image-uploader/fileHelpers";

interface ImageUploaderProps {
  onImageUploaded?: () => void;
  namespace?: string;
  onNamespaceChange?: (value: string) => void;
}

type QueuedFile = UploaderQueueItem;

export default function ImageUploader({ onImageUploaded, namespace, onNamespaceChange }: ImageUploaderProps) {
  const {
    uploadedImages,
    setUploadedImages,
    isUploading,
    activeUploadOps,
    embeddingQueueDepth,
    beginUploadActivity,
    endUploadActivity,
    enqueueEmbedding,
  } = useUploadActivity();
  const [embedClipOnUpload, setEmbedClipOnUpload] = useState(true);
  const [embedColorOnUpload, setEmbedColorOnUpload] = useState(true);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [newFolder, setNewFolder] = useState<string>("");
  const [tags, setTags] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [originalUrl, setOriginalUrl] = useState<string>("");
  const [omitOriginalUrl, setOmitOriginalUrl] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string>("");
  const [folders, setFolders] = useState<string[]>([
    "email-campaigns",
    "website-images",
    "social-media",
    "blog-posts",
  ]);
  const [registryNamespaces, setRegistryNamespaces] = useState<string[]>([]);
  const [uploadNamespaceSelectValue, setUploadNamespaceSelectValue] = useState<string>('');
  const [uploadNamespaceDraft, setUploadNamespaceDraft] = useState<string>('');
  const {
    queuedFiles,
    setQueuedFiles,
    updateQueuedFile,
    addQueuedFiles,
    applyMetadataPatches,
    removeQueuedFile,
    clearQueue,
    unselectAllQueuedFiles,
    createQueueId,
    ensureImportSession,
  } = usePageImportSession();
  const [selectedParentId, setSelectedParentId] = useState<string>('');
  const [importUrl, setImportUrl] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const previewFallbackAttemptedRef = useRef<Set<string>>(new Set());
  const [reducingQueueItems, setReducingQueueItems] = useState<Record<string, boolean>>({});
  const [previewFailures, setPreviewFailures] = useState<Record<string, boolean>>({});
  const [animateFps, setAnimateFps] = useState<string>('');
  const [animateFpsTouched, setAnimateFpsTouched] = useState(false);
  const [animateLoop, setAnimateLoop] = useState(true);
  const [animateFilename, setAnimateFilename] = useState('');
  const [animateLoading, setAnimateLoading] = useState(false);
  const [animateError, setAnimateError] = useState<string | null>(null);
  const [expandedQueueMetadata, setExpandedQueueMetadata] = useState<Record<string, boolean>>({});
  const [showAllQueuedItems, setShowAllQueuedItems] = useState(false);
  const [aiRefiningNames, setAiRefiningNames] = useState(false);
  const [queueRenameValue, setQueueRenameValue] = useState('');
  const [queueAppendValue, setQueueAppendValue] = useState('');
  const manualUploadInFlightRef = useRef(false);
  const galleryRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSourceUrlIfEmpty = useCallback((value: string) => {
    if (!sourceUrl.trim()) {
      setSourceUrl(value);
    }
  }, [sourceUrl]);

  const {
    pageImportUrl,
    setPageImportUrl,
    pageImportLoading,
    pageImportError,
    pageImportAllowInsecure,
    setPageImportAllowInsecure,
    pageImportIncludeUiChrome,
    setPageImportIncludeUiChrome,
    pageImportIncludeSmallAssets,
    setPageImportIncludeSmallAssets,
    pageImportScrollMode,
    setPageImportScrollMode,
    pageImportAutoScroll,
    setPageImportAutoScroll,
    pageImportMaxScrolls,
    setPageImportMaxScrolls,
    pageImportScrollDelayMs,
    setPageImportScrollDelayMs,
    pageImportMaxPages,
    setPageImportMaxPages,
    pageImportMaxAssets,
    setPageImportMaxAssets,
    pageImportCookieHeader,
    setPageImportCookieHeader,
    pageImportProgress,
    handleImportPage,
    handleImportHtmlFile,
    handleStopImportPage,
    handlePasteCookiesAndScan,
  } = usePageImportDiscovery({
    addQueuedFiles,
    createQueueId,
    ensureImportSession,
    setSourceUrlIfEmpty,
  });

  const notifyGalleryUploaded = useCallback((delayMs = 0) => {
    if (!onImageUploaded) return;
    if (galleryRefreshTimerRef.current) {
      clearTimeout(galleryRefreshTimerRef.current);
      galleryRefreshTimerRef.current = null;
    }
    if (delayMs <= 0) {
      onImageUploaded();
      return;
    }
    galleryRefreshTimerRef.current = setTimeout(() => {
      galleryRefreshTimerRef.current = null;
      onImageUploaded();
    }, delayMs);
  }, [onImageUploaded]);

  useEffect(() => {
    return () => {
      if (galleryRefreshTimerRef.current) {
        clearTimeout(galleryRefreshTimerRef.current);
      }
    };
  }, []);

  const handlePreviewLoadError = useCallback(async (item: QueuedFile) => {
    const effectiveAssetType = item.assetType ?? (item.file ? inferAssetTypeFromFile(item.file) : inferAssetTypeFromUrl(item.remoteUrl));
    if (effectiveAssetType === 'video') {
      setPreviewFailures((prev) => ({ ...prev, [item.id]: true }));
      return;
    }

    // Local files or items without a remote URL can't be recovered via import proxy.
    if (item.file || !item.remoteUrl) {
      setPreviewFailures((prev) => ({ ...prev, [item.id]: true }));
      return;
    }

    // Avoid repeated network attempts for the same queue item.
    if (previewFallbackAttemptedRef.current.has(item.id)) {
      setPreviewFailures((prev) => ({ ...prev, [item.id]: true }));
      return;
    }
    previewFallbackAttemptedRef.current.add(item.id);

    try {
      const response = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.remoteUrl })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Preview proxy fetch failed');
      }
      if (!data?.data || !data?.type || !data?.name) {
        throw new Error('Invalid preview proxy response');
      }

      const previewFile = base64ToFile(String(data.data), String(data.name), String(data.type));
      const previewBlobUrl = URL.createObjectURL(previewFile);

      setQueuedFiles((prev) =>
        prev.map((queued) => {
          if (queued.id !== item.id) return queued;
          if (queued.previewUrl && queued.previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(queued.previewUrl);
          }
          return {
            ...queued,
            previewUrl: previewBlobUrl,
            sizeBytes: queued.sizeBytes ?? previewFile.size,
            contentType: queued.contentType ?? previewFile.type,
          };
        })
      );
      setPreviewFailures((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } catch (error) {
      console.warn('[uploader] Preview fallback failed', {
        id: item.id,
        remoteUrl: item.remoteUrl,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      setPreviewFailures((prev) => ({ ...prev, [item.id]: true }));
    }
  }, []);

  const reduceQueuedFileSize = useCallback(async (id: string) => {
    const target = queuedFiles.find((item) => item.id === id);
    if (!target?.file) return;
    if (!isImageFile(target.file)) return;
    if (target.file.size <= MAX_UPLOAD_IMAGE_BYTES) return;

    setReducingQueueItems((prev) => ({ ...prev, [id]: true }));
    try {
      const reduced = await reduceImageFileToLimit(target.file, MAX_UPLOAD_IMAGE_BYTES);
      if (!reduced) {
        updateQueuedFile(id, {
          processingNote: 'Unable to reduce below 10MB'
        });
        return;
      }
      const ext = reduced.type === 'image/webp' ? '.webp' : '.jpg';
      const baseName = target.filename.replace(/\.[^.]+$/, '');
      const nextFilename = `${baseName}${ext}`;
      const nextFile = new File([reduced.blob], nextFilename, { type: reduced.type });
      if (target.previewUrl && target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      updateQueuedFile(id, {
        file: nextFile,
        filename: nextFilename,
        previewUrl: URL.createObjectURL(nextFile),
        processingNote: reduced.note
      });
      setPreviewFailures((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (error) {
      console.error('Failed to reduce file size', error);
      updateQueuedFile(id, {
        processingNote: 'Size reduction failed'
      });
    } finally {
      setReducingQueueItems((prev) => ({ ...prev, [id]: false }));
    }
  }, [queuedFiles, updateQueuedFile]);

  const estimateMetadataBytes = useCallback((payload: Record<string, unknown>) => {
    const filtered = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined && value !== "")
    );
    const json = JSON.stringify(filtered);
    return new TextEncoder().encode(json).length;
  }, []);

  const uploadNamespace = useMemo(() => {
    const trimmed = (namespace || '').trim();
    if (!trimmed || trimmed === '__all__' || trimmed === '__none__') return null;
    return trimmed;
  }, [namespace]);

  const uploadNamespaceOptions = useMemo(() => {
    const envDefault = (process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '').trim();
    const knownRaw = process.env.NEXT_PUBLIC_KNOWN_NAMESPACES || '';
    const defaults = new Set<string>();
    const known = new Set<string>();
    const registry = new Set<string>();

    if (envDefault) defaults.add(envDefault);

    knownRaw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => {
        if (!defaults.has(entry)) known.add(entry);
      });

    registryNamespaces
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => {
        if (!defaults.has(entry) && !known.has(entry)) registry.add(entry);
      });

    const options = [
      { value: '__all__', label: 'All namespaces' },
    ];

    defaults.forEach((value) => options.push({ value, label: `${value} (default)` }));
    Array.from(known).sort().forEach((value) => options.push({ value, label: value }));
    Array.from(registry).sort().forEach((value) => options.push({ value, label: `${value} (registry)` }));
    options.push({ value: '__custom__', label: 'Enter manually...' });

    if (namespace && namespace !== '__custom__' && !options.some((option) => option.value === namespace)) {
      options.splice(options.length - 1, 0, { value: namespace, label: namespace });
    }

    return options;
  }, [namespace, registryNamespaces]);

  const buildMetadataEstimate = useCallback(
    (
      item: QueuedFile,
      overrides: { folder?: string; tags?: string; description?: string; originalUrl?: string; sourceUrl?: string }
    ) => {
      const normalizedOriginalUrl = normalizeOriginalUrl(overrides.originalUrl);
      const normalizedSourceUrl = normalizeOriginalUrl(overrides.sourceUrl);
      const tagList = overrides.tags
        ? overrides.tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
        : undefined;
      return estimateMetadataBytes({
        filename: item.filename,
        displayName: item.filename,
        uploadedAt: new Date().toISOString(),
        size: item.file?.size ?? item.sizeBytes ?? 0,
        type: item.file?.type ?? item.contentType ?? undefined,
        folder: overrides.folder || undefined,
        tags: tagList,
        description: overrides.description || undefined,
        originalUrl: overrides.originalUrl || undefined,
        originalUrlNormalized: normalizedOriginalUrl,
        sourceUrl: overrides.sourceUrl || undefined,
        sourceUrlNormalized: normalizedSourceUrl,
        namespace: uploadNamespace || undefined,
        variationParentId: selectedParentId || undefined
      });
    },
    [estimateMetadataBytes, uploadNamespace, selectedParentId]
  );

  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.localeCompare(b)),
    [folders]
  );

  const folderSelectOptions = useMemo(
    () => [
      { value: '', label: 'No folder' },
      ...sortedFolders.map((folder) => ({ value: folder, label: folder }))
    ],
    [sortedFolders]
  );

  const selectedQueuedCount = useMemo(
    () => queuedFiles.filter((item) => item.selected !== false).length,
    [queuedFiles]
  );
  const uploadBlockedByNamespace = selectedQueuedCount > 0 && !uploadNamespace;
  const visibleQueuedFiles = useMemo(
    () => (showAllQueuedItems ? queuedFiles : queuedFiles.slice(0, QUEUE_RENDER_LIMIT)),
    [queuedFiles, showAllQueuedItems]
  );

  useCandidateMetadataEnrichment({
    queuedFiles,
    visibleIds: visibleQueuedFiles.map((item) => item.id),
    allowInsecure: pageImportAllowInsecure,
    cookieHeader: pageImportCookieHeader,
    applyMetadataPatches,
  });

  // Activity stats for the prominent progress indicator
  const activityStats = useMemo((): ActivityStats => {
    const uploading = uploadedImages.filter(img => img.status === 'uploading').length;
    const uploaded = uploadedImages.filter(img => img.status === 'success').length;
    const errors = uploadedImages.filter(img => img.status === 'error').length;
    const embedding = uploadedImages.filter(img => img.embeddingStatus === 'embedding').length;
    const embedded = uploadedImages.filter(img => img.embeddingStatus === 'success').length;
    const embeddingQueued = uploadedImages.filter(img => img.embeddingStatus === 'queued').length;
    
    return {
      total: uploadedImages.length,
      uploading,
      uploaded,
      embedding,
      embedded,
      errors,
      embeddingQueue: embeddingQueueDepth + embeddingQueued
    };
  }, [uploadedImages, embeddingQueueDepth]);

  const isActivityActive = useMemo(() => 
    activeUploadOps > 0 || activityStats.uploading > 0 || activityStats.embedding > 0 || embeddingQueueDepth > 0,
    [activeUploadOps, activityStats.uploading, activityStats.embedding, embeddingQueueDepth]
  );
  const uploadGuardActive = useMemo(
    () => isActivityActive || importLoading || pageImportLoading || aiRefiningNames || animateLoading,
    [aiRefiningNames, animateLoading, importLoading, isActivityActive, pageImportLoading]
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !uploadGuardActive) {
      return;
    }

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    const currentPath = window.location.pathname + window.location.search + window.location.hash;

    const blockSpaNav = (kind: 'pushState' | 'replaceState', target?: string | URL | null) => {
      const targetUrl = target ? String(target) : '';
      // Allow no-op updates to the same URL.
      if (targetUrl && targetUrl === currentPath) {
        return false;
      }
      console.warn('[UploadGuard] Blocked SPA navigation during active upload work', {
        kind,
        target: targetUrl || '(unknown)',
      });
      return true;
    };

    window.history.pushState = ((data: unknown, unused: string, url?: string | URL | null) => {
      if (blockSpaNav('pushState', url)) return;
      return originalPushState(data, unused, url);
    }) as History['pushState'];

    window.history.replaceState = ((data: unknown, unused: string, url?: string | URL | null) => {
      if (blockSpaNav('replaceState', url)) return;
      return originalReplaceState(data, unused, url);
    }) as History['replaceState'];

    const handlePopState = () => {
      console.warn('[UploadGuard] Blocked popstate navigation during active upload work');
      originalPushState(null, '', currentPath);
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('popstate', handlePopState, true);
    window.addEventListener('beforeunload', handleBeforeUnload, true);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', handlePopState, true);
      window.removeEventListener('beforeunload', handleBeforeUnload, true);
    };
  }, [uploadGuardActive]);

  useEffect(() => {
    if (animateFpsTouched) return;
    if (selectedQueuedCount === 0) {
      setAnimateFps('');
      return;
    }
    const next = Math.max(1, selectedQueuedCount / 2);
    setAnimateFps(next.toString());
  }, [animateFpsTouched, selectedQueuedCount]);

  useEffect(() => {
    if (queuedFiles.length <= QUEUE_RENDER_LIMIT && showAllQueuedItems) {
      setShowAllQueuedItems(false);
    }
  }, [queuedFiles.length, showAllQueuedItems]);

  useEffect(() => {
    const nextNamespace = namespace ?? '';
    setUploadNamespaceDraft(nextNamespace && nextNamespace !== '__all__' ? nextNamespace : '');
    if (!nextNamespace) {
      setUploadNamespaceSelectValue('');
      return;
    }
    const hasKnownOption = uploadNamespaceOptions.some((option) => option.value === nextNamespace);
    setUploadNamespaceSelectValue(hasKnownOption ? nextNamespace : '__custom__');
  }, [namespace, uploadNamespaceOptions]);

  // Fetch existing folders from images endpoint and merge with local presets
  const fetchFolders = useCallback(async () => {
    try {
      const resp = await fetch(buildUploaderGallerySummaryUrl(namespace));
      const data = await resp.json();
      if (resp.ok && Array.isArray(data.images)) {
        const facetFolders = Array.isArray(data?.facets?.folders)
          ? data.facets.folders
              .map((entry: { value?: unknown }) => (typeof entry.value === 'string' ? entry.value.trim() : ''))
              .filter((folder: string): folder is string => Boolean(folder))
          : [];
        const imageFolders: string[] = Array.from(
          new Set(
            (data.images as GalleryImageSummary[])
              .map((img) => (img.folder ?? '').trim())
              .filter((folder): folder is string => Boolean(folder))
          )
        );
        const fetched = facetFolders.length > 0 ? facetFolders : imageFolders;

        setFolders((prev: string[]) =>
          Array.from(new Set<string>([...prev, ...fetched]))
        );
      }
    } catch (err) {
      console.warn("Failed to fetch folders for uploader", err);
    }
  }, [namespace]);

  // Load folders on mount
  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  useEffect(() => {
    fetch('/api/namespaces', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        const namespaces = Array.isArray(data?.namespaces)
          ? data.namespaces.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          : [];
        setRegistryNamespaces(namespaces);
      })
      .catch((error) => {
        console.warn('Failed to load namespace registry for uploader', error);
      });
  }, []);

  const registerUploadNamespace = useCallback(async (value: string) => {
    const namespace = value.trim();
    if (!namespace || namespace === '__all__' || namespace === '__none__') return;

    try {
      const response = await fetch('/api/namespaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ namespace }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to register namespace');
      }
      const namespaces = Array.isArray(data?.namespaces)
        ? data.namespaces.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
      setRegistryNamespaces(namespaces);
    } catch (error) {
      console.warn('Failed to register namespace for uploader', error);
    }
  }, []);

  const handleUploadNamespaceSelectChange = useCallback((value: string) => {
    setUploadNamespaceSelectValue(value);
    if (value === '__custom__') return;
    setUploadNamespaceDraft(value && value !== '__all__' ? value : '');
    onNamespaceChange?.(value);
  }, [onNamespaceChange]);

  const handleUploadNamespaceApply = useCallback(() => {
    const nextNamespace = uploadNamespaceDraft.trim();
    if (!nextNamespace) return;
    setUploadNamespaceSelectValue('__custom__');
    void registerUploadNamespace(nextNamespace);
    onNamespaceChange?.(nextNamespace);
  }, [onNamespaceChange, registerUploadNamespace, uploadNamespaceDraft]);

  const resetUploadForm = useCallback(() => {
    setSelectedFolder("");
    setNewFolder("");
    setTags("");
    setDescription("");
    setOriginalUrl("");
    setSourceUrl("");
    setSelectedParentId("");
  }, []);

  const { markNamespaceUploadFailures, uploadFiles, uploadRemoteFiles } = useUploaderUploadActions({
    uploadNamespace,
    embedClipOnUpload,
    embedColorOnUpload,
    omitOriginalUrl,
    tags,
    description,
    originalUrl,
    sourceUrl,
    selectedParentId,
    pageImportAllowInsecure,
    pageImportCookieHeader,
    pageImportIncludeSmallAssets,
    resolveFolder,
    beginUploadActivity,
    endUploadActivity,
    enqueueEmbedding,
    notifyGalleryUploaded,
    fetchFolders,
    setUploadedImages,
    resetUploadForm,
  });

  // Handle drag and drop - either queue or upload immediately
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const resizedPromises = acceptedFiles.map(async (file) => {
      if (isArchiveFile(file)) {
        return file;
      }
      return file;
    });
    const resizedFiles = await Promise.all(resizedPromises);
    const queued: QueuedFile[] = [];
    let firstKeynoteName: string | null = null;

    for (const file of resizedFiles) {
      if (isKeynoteFile(file)) {
        const keynoteName = file.name.replace(/\.[^.]+$/, '');
        const sourcePath = getFileSourcePath(file) || file.name;
        const groupId = createQueueId();
        if (!firstKeynoteName) {
          firstKeynoteName = keynoteName;
        }
        try {
          const extracted = await extractKeynoteImages(file);
          extracted.forEach((entry, index) => {
            queued.push({
              id: createQueueId(),
              assetType: 'image',
              file: entry.file,
              filename: entry.filename,
              tags: 'keynote',
              description: keynoteName,
              sourcePath,
              groupId,
              groupIndex: index,
              previewUrl: isImageFile(entry.file) ? URL.createObjectURL(entry.file) : undefined,
              selected: true
            });
          });
        } catch (error) {
          console.error('Failed to extract Keynote images', error);
        }
        continue;
      }

      if (isZipFile(file)) {
        const sourcePath = getFileSourcePath(file) || file.name;
        try {
          const extracted = await extractZipImages(file);
          extracted.forEach((entry) => {
            queued.push({
              id: createQueueId(),
              assetType: 'image',
              file: entry.file,
              filename: entry.filename,
              sourcePath,
              previewUrl: isImageFile(entry.file) ? URL.createObjectURL(entry.file) : undefined,
              selected: true
            });
          });
        } catch (error) {
          console.error('Failed to extract zip images', error);
        }
        continue;
      }

      const lowerName = file.name.toLowerCase();
      const isSnagx = lowerName.endsWith('.snagx');
      const tagOverride = isSnagx ? 'snagx' : undefined;
      queued.push({
        id: createQueueId(),
        assetType: inferAssetTypeFromFile(file),
        file,
        filename: file.name,
        tags: tagOverride,
        sourcePath: getFileSourcePath(file),
        previewUrl: isImageFile(file) ? URL.createObjectURL(file) : undefined,
        selected: true
      });
    }

    if (queued.length > 0) {
      setQueuedFiles((prev) => [...prev, ...queued]);
    }
    if (firstKeynoteName) {
      setTags((prev) => mergeTagInputs(prev, 'keynote'));
      setDescription(firstKeynoteName);
    }
  }, [createQueueId, setTags, setDescription]);

  // Manual upload button handler
  const handleManualUpload = async () => {
    if (manualUploadInFlightRef.current) {
      return;
    }

    const selectedItems = queuedFiles.filter((item) => item.selected !== false);
    if (selectedItems.length === 0) return;
    if (!uploadNamespace) {
      markNamespaceUploadFailures(selectedItems);
      return;
    }

    manualUploadInFlightRef.current = true;
    try {
      const localItems = selectedItems.filter((item) => Boolean(item.file));
      const remoteItems = selectedItems.filter((item) => Boolean(item.remoteUrl) && !item.file);

      if (localItems.length > 0) {
        const processed: QueuedFile[] = [];
        for (const item of localItems) {
          if (!item.file) continue;
          const processedFile = isArchiveFile(item.file) ? item.file : item.file;
          processed.push({
            assetType: item.assetType,
            file: processedFile,
            filename: item.filename,
            id: item.id,
            originalUrl: item.originalUrl,
            sourceUrl: item.sourceUrl,
            sourcePath: item.sourcePath,
            posterUrl: item.posterUrl,
            isBlobSource: item.isBlobSource,
            folder: item.folder,
            tags: item.tags,
            description: item.description,
            selected: item.selected
          });
        }
        await uploadFiles(processed);
      }

      if (remoteItems.length > 0) {
        await uploadRemoteFiles(remoteItems);
      }

      const attemptedIds = new Set(selectedItems.map((item) => item.id));
      setQueuedFiles((prev) => unselectAttemptedQueuedItems(prev, attemptedIds));
    } finally {
      manualUploadInFlightRef.current = false;
    }
  };

  const handleAiRefineSelectedNames = useCallback(async () => {
    const selectedItems = queuedFiles.filter((item) => item.selected !== false);
    if (selectedItems.length === 0) return;

    setAiRefiningNames(true);
    try {
      const fallbackFolder = resolveFolder();
      for (const item of selectedItems) {
        try {
          const effectiveAssetType = item.assetType ?? (item.file ? inferAssetTypeFromFile(item.file) : inferAssetTypeFromUrl(item.remoteUrl));
          if (effectiveAssetType !== 'image') {
            updateQueuedFile(item.id, { processingNote: 'AI naming currently supports images only' });
            continue;
          }

          const formData = new FormData();
          if (item.file) {
            formData.append('file', item.file);
          } else if (item.remoteUrl) {
            formData.append('remoteUrl', item.remoteUrl);
          } else {
            updateQueuedFile(item.id, { processingNote: 'AI naming skipped: no image source' });
            continue;
          }

          formData.append('filename', item.filename);
          const folderHint = item.folder !== undefined ? item.folder : fallbackFolder;
          if (folderHint) formData.append('folder', folderHint);
          const tagHint = resolveTagInput(tags, item.tags);
          if (tagHint) formData.append('tags', tagHint);

          let response: Response | null = null;
          let payload: { displayName?: string; error?: string } = {};
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              response = await fetch('/api/display-name/suggest', {
                method: 'POST',
                body: formData,
              });
              payload = (await response.json().catch(() => ({}))) as {
                displayName?: string;
                error?: string;
              };
              break;
            } catch (error) {
              const abortedLike =
                error instanceof Error &&
                (error.name === 'AbortError' ||
                  error.message.includes('aborted') ||
                  error.message.includes('ECONNRESET'));
              if (attempt === 0 && abortedLike) {
                await new Promise((resolve) => setTimeout(resolve, 200));
                continue;
              }
              throw error;
            }
          }

          if (!response || !response.ok || !payload.displayName) {
            updateQueuedFile(item.id, {
              processingNote: payload.error || 'AI naming failed',
            });
            continue;
          }

          updateQueuedFile(item.id, {
            filename: payload.displayName,
            processingNote: `AI shortname: ${payload.displayName}`,
          });
        } catch (error) {
          const message =
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : 'Network request failed';
          updateQueuedFile(item.id, {
            processingNote: `AI naming failed: ${message}`,
          });
          console.error('Failed to refine queued name for item', { itemId: item.id, error });
        }
      }
    } catch (error) {
      console.error('Failed to refine queued names with AI', error);
    } finally {
      setAiRefiningNames(false);
    }
  }, [queuedFiles, resolveFolder, tags, updateQueuedFile]);

  const applyQueueNameToAll = useCallback(() => {
    const nextName = queueRenameValue.trim();
    if (!nextName) {
      return;
    }
    setQueuedFiles((prev) => prev.map((item) => ({ ...item, filename: nextName })));
  }, [queueRenameValue, setQueuedFiles]);

  const removeQueueExtensions = useCallback(() => {
    setQueuedFiles((prev) =>
      prev.map((item) => ({
        ...item,
        filename: removeFilenameExtension(item.filename),
      }))
    );
  }, [setQueuedFiles]);

  const appendTextToQueueNames = useCallback(() => {
    const text = queueAppendValue.trim();
    if (!text) {
      return;
    }
    setQueuedFiles((prev) =>
      prev.map((item) => ({
        ...item,
        filename: appendTextToFilename(item.filename, text),
      }))
    );
  }, [queueAppendValue, setQueuedFiles]);

  const handleClearQueuedItems = useCallback(() => {
    clearQueue();
    setPreviewFailures({});
    setReducingQueueItems({});
    setExpandedQueueMetadata({});
    setShowAllQueuedItems(false);
  }, [clearQueue]);

  const handleUnselectAllQueuedItems = useCallback(() => {
    unselectAllQueuedFiles();
  }, [unselectAllQueuedFiles]);

  const handleRemoveQueuedItem = useCallback((id: string) => {
    removeQueuedFile(id);
    setPreviewFailures((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setReducingQueueItems((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setExpandedQueueMetadata((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [removeQueuedFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".jpeg", ".jpg", ".png", ".gif", ".webp"],
      "video/*": [".mp4", ".webm", ".mov", ".m4v", ".ogv", ".ogg"],
      "application/octet-stream": [".snagx", ".key"],
      "application/zip": [".zip", ".snagx", ".key"],
      "application/x-zip-compressed": [".zip", ".key"],
      "application/vnd.apple.keynote": [".key"],
      "application/x-iwork-keynote-sffkey": [".key"]
    },
    multiple: true,
  });

  const removeImage = (id: string) => {
    setUploadedImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleRetryUpload = useCallback(
    (image: UploadedImage) => {
      if (image.file) {
        const retryItem: QueuedFile = {
          id: image.id,
          assetType: image.assetType,
          file: image.file,
          filename: image.filename,
          originalUrl: image.originalUrlInput ?? image.originalUrl,
          sourceUrl: image.sourceUrlInput ?? image.sourceUrl,
          folder: image.folderInput,
          tags: image.tagsInput,
          description: image.descriptionInput,
          selected: true
        };
        uploadFiles([retryItem]);
        return;
      }
      if (image.remoteUrl) {
        const retryItem: QueuedFile = {
          id: image.id,
          assetType: image.assetType,
          filename: image.filename,
          remoteUrl: image.remoteUrl,
          posterUrl: image.url || undefined,
          originalUrl: image.originalUrlInput ?? image.originalUrl,
          sourceUrl: image.sourceUrlInput ?? image.sourceUrl,
          folder: image.folderInput,
          tags: image.tagsInput,
          description: image.descriptionInput,
          selected: true
        };
        uploadRemoteFiles([retryItem]);
      }
    },
    [uploadFiles, uploadRemoteFiles]
  );

  const copyToClipboard = async (url: string) => {
    try {
      // Check if the modern clipboard API is available
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        alert("URL copied to clipboard!");
      } else {
        // Fallback for older browsers or non-secure contexts
        const textArea = document.createElement("textarea");
        textArea.value = url;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
          document.execCommand("copy");
          alert("URL copied to clipboard!");
        } catch (fallbackErr) {
          console.error("Fallback copy failed: ", fallbackErr);
          // Show the URL in a prompt as last resort
          prompt("Copy this URL manually:", url);
        }

        document.body.removeChild(textArea);
      }
    } catch (err) {
      console.error("Failed to copy: ", err);
      // Show the URL in a prompt as fallback
      prompt("Copy this URL manually:", url);
    }
  };

  const handleImportFromUrl = async () => {
    const sourceUrl = importUrl.trim();
    if (!sourceUrl) return;
    try {
      setImportLoading(true);
      setImportError(null);
      const inferredAssetType = inferAssetTypeFromUrl(sourceUrl);
      if (inferredAssetType === 'video') {
        setQueuedFiles((prev) => [
          ...prev,
          {
            id: createQueueId(),
            assetType: 'video',
            filename: sourceUrl.split('/').pop() || 'remote-video',
            remoteUrl: sourceUrl,
            originalUrl: sourceUrl,
            selected: true
          }
        ]);
        if (!originalUrl.trim()) {
          setOriginalUrl(sourceUrl);
        }
        setImportUrl('');
        return;
      }

      const response = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl })
      });
      const data = await response.json();
      if (!response.ok) {
        const errorMessage = data?.error || 'Failed to import image';
        if (isImageOnlyImportError(errorMessage)) {
          setQueuedFiles((prev) => [
            ...prev,
            {
              id: createQueueId(),
              assetType: 'video',
              filename: sourceUrl.split('/').pop() || 'remote-video',
              remoteUrl: sourceUrl,
              originalUrl: sourceUrl,
              selected: true
            }
          ]);
          if (!originalUrl.trim()) {
            setOriginalUrl(sourceUrl);
          }
          setImportUrl('');
          return;
        }
        throw new Error(errorMessage);
      }
      if (!data?.data || !data?.type || !data?.name) {
        throw new Error('Invalid response from import service');
      }
      const file = base64ToFile(String(data.data), String(data.name), String(data.type));
      const importedSourceUrl = String(data.originalUrl || sourceUrl);
      const descriptionFromSnagx = typeof data.snagxDescription === 'string' && data.snagxDescription.trim()
        ? data.snagxDescription.trim()
        : '';
      const tagsFromSnagx = data.snagxDescription || data.captureDate ? 'snagx' : undefined;
      setQueuedFiles((prev) => [
        ...prev,
        {
          id: createQueueId(),
          assetType: 'image',
          file,
          filename: file.name,
          originalUrl: importedSourceUrl,
          description: descriptionFromSnagx || undefined,
          captureDate: typeof data.captureDate === 'string' ? data.captureDate : undefined,
          tags: tagsFromSnagx,
          previewUrl: URL.createObjectURL(file),
          selected: true
        }
      ]);
      if (!originalUrl.trim()) {
        setOriginalUrl(importedSourceUrl);
      }
      setImportUrl('');
    } catch (err) {
      console.error('Import image failed', err);
      setImportError(err instanceof Error ? err.message : 'Failed to import media');
    } finally {
      setImportLoading(false);
    }
  };

  const handleCreateAnimation = async () => {
    if (!uploadNamespace) {
      setAnimateError(NAMESPACE_REQUIRED_UPLOAD_ERROR);
      return;
    }

    const selectedItems = queuedFiles.filter((item) => {
      if (item.selected === false) return false;
      const effectiveAssetType = item.assetType ?? (item.file ? inferAssetTypeFromFile(item.file) : inferAssetTypeFromUrl(item.remoteUrl));
      return effectiveAssetType === 'image';
    });
    if (selectedItems.length < 2) {
      setAnimateError('Select at least two images to animate');
      return;
    }
    const fpsValue = Number(animateFps);
    if (!Number.isFinite(fpsValue) || fpsValue <= 0) {
      setAnimateError('FPS must be greater than 0');
      return;
    }
    setAnimateLoading(true);
    setAnimateError(null);

    try {
      const formData = new FormData();
      const folderToUse = resolveFolder();
      const itemsPayload: Array<{ kind: 'file'; fileIndex: number } | { kind: 'url'; url: string }> = [];
      const hydratedFrames: Array<{ id: string; file: File; previewUrl: string }> = [];
      const hydrationErrors: string[] = [];
      let fileIndex = 0;
      const getHost = (value: string) => {
        try {
          return new URL(value).host;
        } catch {
          return value;
        }
      };

      for (const item of selectedItems) {
        if (item.file) {
          formData.append('files', item.file);
          itemsPayload.push({ kind: 'file', fileIndex });
          fileIndex += 1;
        } else if (item.remoteUrl) {
          let hydratedFile: File | null = null;
          try {
            const importResponse = await fetch('/api/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: item.remoteUrl })
            });
            const importData = await importResponse.json();
            if (importResponse.ok && importData?.data && importData?.type) {
              const importName =
                (typeof importData.name === 'string' && importData.name.trim())
                  ? importData.name.trim()
                  : item.filename || 'remote-frame';
              hydratedFile = base64ToFile(String(importData.data), importName, String(importData.type));
            } else {
              const detail = typeof importData?.error === 'string'
                ? importData.error
                : `HTTP ${importResponse.status}`;
              hydrationErrors.push(`${getHost(item.remoteUrl)}: ${detail}`);
            }
          } catch (error) {
            const detail = error instanceof Error ? error.message : 'Network error';
            hydrationErrors.push(`${getHost(item.remoteUrl)}: ${detail}`);
          }

          if (hydratedFile) {
            formData.append('files', hydratedFile, hydratedFile.name);
            itemsPayload.push({ kind: 'file', fileIndex });
            fileIndex += 1;
            hydratedFrames.push({
              id: item.id,
              file: hydratedFile,
              previewUrl: URL.createObjectURL(hydratedFile),
            });
          } else {
            // Fallback to server-side URL fetch in /api/animate.
            itemsPayload.push({ kind: 'url', url: item.remoteUrl });
          }
        }
      }

      if (itemsPayload.length < 2) {
        const hydrationContext = hydrationErrors.length
          ? ` Failed frame prep: ${hydrationErrors.slice(0, 3).join(' | ')}`
          : '';
        setAnimateError(`Select at least two valid images to animate.${hydrationContext}`);
        return;
      }

      formData.append('items', JSON.stringify(itemsPayload));
      formData.append('fps', String(fpsValue));
      formData.append('loop', animateLoop ? '1' : '0');
      if (animateFilename.trim()) {
        formData.append('filename', animateFilename.trim());
      }
      if (folderToUse && folderToUse.trim()) {
        formData.append('folder', folderToUse.trim());
      }
      if (tags.trim()) {
        formData.append('tags', tags.trim());
      }
      if (description.trim()) {
        formData.append('description', description.trim());
      }
      if (originalUrl.trim()) {
        formData.append('originalUrl', originalUrl.trim());
      }
      if (sourceUrl.trim()) {
        formData.append('sourceUrl', sourceUrl.trim());
      }
      formData.append('namespace', uploadNamespace);
      if (selectedParentId) {
        formData.append('parentId', selectedParentId);
      }

      const response = await fetch('/api/animate', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (!response.ok) {
        const details = Array.isArray(data?.details)
          ? data.details.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0).slice(0, 4)
          : [];
        const frameCounts =
          typeof data?.validFrames === 'number' && typeof data?.totalRequested === 'number'
            ? ` (usable ${data.validFrames}/${data.totalRequested} frames)`
            : '';
        const detailText = details.length ? ` Details: ${details.join(' | ')}` : '';
        throw new Error(`${data.error || 'Failed to create animation'}${frameCounts}${detailText}`);
      }

      if (hydratedFrames.length > 0) {
        const hydratedById = new Map(hydratedFrames.map((entry) => [entry.id, entry]));
        setQueuedFiles((prev) =>
          prev.map((queued) => {
            const hydrated = hydratedById.get(queued.id);
            if (!hydrated) {
              return queued;
            }
            if (queued.previewUrl && queued.previewUrl.startsWith('blob:')) {
              URL.revokeObjectURL(queued.previewUrl);
            }
            return {
              ...queued,
              file: hydrated.file,
              previewUrl: hydrated.previewUrl,
              sizeBytes: queued.sizeBytes ?? hydrated.file.size,
              contentType: queued.contentType ?? hydrated.file.type,
              processingNote: 'Frame cached locally for animation',
            };
          })
        );
        setPreviewFailures((prev) => {
          const next = { ...prev };
          hydratedFrames.forEach((entry) => {
            delete next[entry.id];
          });
          return next;
        });
      }

      setUploadedImages((prev) => [
        ...prev,
        {
          id: data.id,
          assetType: 'image',
          url: data.url,
          filename: data.filename,
          status: 'success',
          folder: data.folder,
          tags: data.tags,
          description: data.description,
          originalUrl: data.originalUrl,
          sourceUrl: data.sourceUrl
        }
      ]);

      notifyGalleryUploaded();
    } catch (err) {
      console.error('Create animation failed', err);
      setAnimateError(err instanceof Error ? err.message : 'Failed to create animation');
    } finally {
      setAnimateLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xs font-mono  text-gray-900 mb-4">Upload Media</h2>

      {/* Activity Indicator - prominent progress during bulk operations */}
      {(isActivityActive || activityStats.total > 0) && (
        <ActivityIndicator stats={activityStats} isActive={isActivityActive} />
      )}
      {uploadGuardActive && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Upload guard is active. Navigation/reload is blocked while upload tasks are running.
        </div>
      )}
      {!uploadNamespace && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {NAMESPACE_REQUIRED_UPLOAD_ERROR}
        </div>
      )}
      {uploadNamespace && (
        <div className="mb-4 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          You are uploading to the <span className="font-mono font-semibold">{uploadNamespace}</span> namespace. Are you sure this is what you want?
        </div>
      )}

      <UploaderMetadataControls
        selectedFolder={selectedFolder}
        setSelectedFolder={setSelectedFolder}
        newFolder={newFolder}
        setNewFolder={setNewFolder}
        folders={folders}
        setFolders={setFolders}
        folderSelectOptions={folderSelectOptions}
        tags={tags}
        setTags={setTags}
        description={description}
        setDescription={setDescription}
        originalUrl={originalUrl}
        setOriginalUrl={setOriginalUrl}
        omitOriginalUrl={omitOriginalUrl}
        setOmitOriginalUrl={setOmitOriginalUrl}
        sourceUrl={sourceUrl}
        setSourceUrl={setSourceUrl}
      />
{/*  Not sure how you thought it ever made sense to show a huge list of filenames here...Leave this commented out
A long list of filenames is not user friendly and essentially useless for selecting a parent image.
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <label htmlFor="parent-select" className="block text-xs font-mono font-medium text-blue-900 mb-2">
          Upload variation of…
        </label>
        <MonoSelect
          id="parent-select"
          value={selectedParentId}
          onChange={setSelectedParentId}
          options={
            parentOptions.length === 0
              ? [
                  { value: '', label: 'No parent (upload canonical image)' },
                  {
                    value: '__no-parent-notice__',
                    label: 'Upload a base image first to assign variations',
                    disabled: true
                  }
                ]
              : canonicalSelectOptions
          }
          placeholder="Select parent image"
        />
        <p className="text-xs text-blue-700 mt-2">
          Select an existing canonical image to group this upload as a variation. Leave empty to store a new master asset.
        </p> 
      </div> */}
      <UploadNamespaceControls
        uploadNamespace={uploadNamespace}
        uploadNamespaceSelectValue={uploadNamespaceSelectValue}
        uploadNamespaceDraft={uploadNamespaceDraft}
        uploadNamespaceOptions={uploadNamespaceOptions}
        isUploading={isUploading}
        onSelectChange={handleUploadNamespaceSelectChange}
        onDraftChange={(value) => {
          setUploadNamespaceDraft(value);
          setUploadNamespaceSelectValue('__custom__');
        }}
        onApply={handleUploadNamespaceApply}
      />

      <div
        {...getRootProps()}
        className={clsx(
          "mt-4 border-2 border-dashed rounded-lg p-2 text-center transition-all cursor-pointer relative overflow-hidden",
          isDragActive ? "border-blue-400 bg-blue-50" : 
          isUploading ? "border-blue-300 bg-gradient-to-r from-blue-50 via-white to-blue-50" :
          "border-gray-300 hover:border-gray-400"
        )}
      >
        {/* Animated border during upload */}
        {isUploading && (
          <div className="absolute inset-0 rounded-lg pointer-events-none">
            <div className="absolute inset-0 rounded-lg border-2 border-blue-400 animate-pulse" />
          </div>
        )}
        <input {...getInputProps()} />
        {isUploading ? (
          <Loader2 className="mx-auto h-8 w-8 text-blue-500 mb-4 animate-spin" />
        ) : (
          <Upload className="mx-auto h-8 w-8 text-gray-400 mb-4" />
        )}
        <p className="text-xs font-mono font-medium text-gray-900 mb-2">
          {isUploading ? "Uploading..." : isDragActive ? "Drop images or a .zip/.key here" : "Drag & drop images or a .zip/.key here"}
        </p>
        <p className="text-xs font-mono text-gray-500">
          {isUploading ? "Please wait while your images are being uploaded" : "or click to select files (.zip/.key supported)"}
        </p>
      </div>

      <div className="mt-4 p-4 border border-dashed rounded-lg bg-white/60">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-mono font-medium text-gray-900">Embeddings after upload</p>
          {embeddingQueueDepth > 0 && (
            <div className="flex items-center gap-2 text-[11px] text-purple-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-600"></span>
              </span>
              {embeddingQueueDepth} queued
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-[11px] text-gray-600">
            <input
              type="checkbox"
              checked={embedClipOnUpload}
              onChange={(e) => setEmbedClipOnUpload(e.target.checked)}
              className="h-3 w-3"
            />
            Similarity (CLIP)
          </label>
          <label className="flex items-center gap-2 text-[11px] text-gray-600">
            <input
              type="checkbox"
              checked={embedColorOnUpload}
              onChange={(e) => setEmbedColorOnUpload(e.target.checked)}
              className="h-3 w-3"
            />
            Color palette
          </label>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          Embeddings run in the background after upload and may take a while. You can keep uploading while they finish.
        </p>
      </div>

      <div className="mt-4 p-4 border border-dashed rounded-lg bg-white/60">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-mono font-medium text-gray-900">Import media from URL</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="url"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://example.com/asset.jpg or .mp4"
            className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleImportFromUrl}
            disabled={importLoading || !importUrl.trim()}
            className="px-4 py-2 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {importLoading ? 'Fetching…' : 'Fetch media'}
          </button>
        </div>
        {importError && <p className="text-xs text-red-600 mt-1">{importError}</p>}
        <p className="text-[11px] text-gray-500 mt-1">
          Images are downloaded into the queue. Short videos are queued by URL and uploaded through the video pipeline when you click Upload.
        </p>
      </div>

      <PageImportControls
        pageImportUrl={pageImportUrl}
        setPageImportUrl={setPageImportUrl}
        pageImportLoading={pageImportLoading}
        pageImportScrollMode={pageImportScrollMode}
        pageImportAutoScroll={pageImportAutoScroll}
        setPageImportAutoScroll={setPageImportAutoScroll}
        pageImportIncludeSmallAssets={pageImportIncludeSmallAssets}
        setPageImportIncludeSmallAssets={setPageImportIncludeSmallAssets}
        pageImportIncludeUiChrome={pageImportIncludeUiChrome}
        setPageImportIncludeUiChrome={setPageImportIncludeUiChrome}
        setPageImportScrollMode={setPageImportScrollMode}
        pageImportMaxScrolls={pageImportMaxScrolls}
        setPageImportMaxScrolls={setPageImportMaxScrolls}
        pageImportScrollDelayMs={pageImportScrollDelayMs}
        setPageImportScrollDelayMs={setPageImportScrollDelayMs}
        pageImportMaxPages={pageImportMaxPages}
        setPageImportMaxPages={setPageImportMaxPages}
        pageImportMaxAssets={pageImportMaxAssets}
        setPageImportMaxAssets={setPageImportMaxAssets}
        pageImportAllowInsecure={pageImportAllowInsecure}
        setPageImportAllowInsecure={setPageImportAllowInsecure}
        pageImportCookieHeader={pageImportCookieHeader}
        setPageImportCookieHeader={setPageImportCookieHeader}
        pageImportError={pageImportError}
        pageImportProgress={pageImportProgress}
        handleImportPage={handleImportPage}
        handleImportHtmlFile={handleImportHtmlFile}
        handleStopImportPage={handleStopImportPage}
        handlePasteCookiesAndScan={handlePasteCookiesAndScan}
      />

      {queuedFiles.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 rounded-lg border border-blue-200 bg-white/70 p-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[11px] text-gray-600">
              FPS
              <input
                type="number"
                min="0.1"
                step="0.5"
                value={animateFps}
                onChange={(e) => {
                  setAnimateFpsTouched(true);
                  setAnimateFps(e.target.value);
                }}
                className="w-20 rounded-md border border-gray-300 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-gray-600">
              Loop
              <input
                type="checkbox"
                checked={animateLoop}
                onChange={(e) => setAnimateLoop(e.target.checked)}
                className="h-3 w-3"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-gray-600">
              Output name
              <input
                type="text"
                value={animateFilename}
                onChange={(e) => setAnimateFilename(e.target.value)}
                placeholder="animated-webp"
                className="w-40 rounded-md border border-gray-300 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCreateAnimation}
              disabled={animateLoading || selectedQueuedCount < 2}
              className="rounded-md bg-emerald-600 px-3 py-2 text-xs text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {animateLoading ? 'Building...' : 'Create animated WebP'}
            </button>
            {animateError && <p className="text-[11px] text-red-600">{animateError}</p>}
          </div>
        </div>
      )}

      <PageImportQueue
        queuedFiles={queuedFiles}
        visibleQueuedFiles={visibleQueuedFiles}
        selectedQueuedCount={selectedQueuedCount}
        isUploading={isUploading}
        uploadBlockedByNamespace={uploadBlockedByNamespace}
        aiRefiningNames={aiRefiningNames}
        queueRenameValue={queueRenameValue}
        setQueueRenameValue={setQueueRenameValue}
        queueAppendValue={queueAppendValue}
        setQueueAppendValue={setQueueAppendValue}
        showAllQueuedItems={showAllQueuedItems}
        setShowAllQueuedItems={setShowAllQueuedItems}
        previewFailures={previewFailures}
        reducingQueueItems={reducingQueueItems}
        expandedQueueMetadata={expandedQueueMetadata}
        selectedFolder={selectedFolder}
        newFolder={newFolder}
        tags={tags}
        description={description}
        originalUrl={originalUrl}
        sourceUrl={sourceUrl}
        updateQueuedFile={updateQueuedFile}
        resolveTagInput={resolveTagInput}
        buildMetadataEstimate={buildMetadataEstimate}
        onPreviewLoadError={(item) => {
          void handlePreviewLoadError(item);
        }}
        onReduceSize={(id) => {
          void reduceQueuedFileSize(id);
        }}
        onRemove={handleRemoveQueuedItem}
        onToggleMetadata={(id) =>
          setExpandedQueueMetadata((prev) => ({
            ...prev,
            [id]: !prev[id],
          }))
        }
        onClearQueue={handleClearQueuedItems}
        onUnselectAll={handleUnselectAllQueuedItems}
        onAiRefineSelectedNames={() => {
          void handleAiRefineSelectedNames();
        }}
        onManualUpload={() => {
          void handleManualUpload();
        }}
        onApplyQueueNameToAll={applyQueueNameToAll}
        onRemoveQueueExtensions={removeQueueExtensions}
        onAppendTextToQueueNames={appendTextToQueueNames}
      />

      <UploadedImagesList
        uploadedImages={uploadedImages}
        isUploading={isUploading}
        onClearAll={() => setUploadedImages([])}
        onCopyUrl={(url) => {
          void copyToClipboard(url);
        }}
        onRemove={removeImage}
        onRetryUpload={handleRetryUpload}
      />
    </div>
  );
}
 
