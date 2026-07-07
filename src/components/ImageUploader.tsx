'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { normalizeOriginalUrl } from "@/utils/urlNormalization";
import { inferAssetTypeFromUrl } from "@/utils/mediaAssetType";
import { appendTextToFilename, removeFilenameExtension, sanitizeFilename } from "@/utils/filename";
import { usePageImportSession } from "@/features/page-import/hooks/usePageImportSession";
import { usePageImportDiscovery } from "@/features/page-import/hooks/usePageImportDiscovery";
import { useCandidateMetadataEnrichment } from "@/features/page-import/hooks/useCandidateMetadataEnrichment";
import { PageImportControls } from "@/features/page-import/components/PageImportControls";
import { PageImportQueue } from "@/features/page-import/components/PageImportQueue";
import type { UploaderQueueItem } from "@/features/page-import/types";
import {
  setAllQueuedItemsSelected,
  setSmallAssetReviewItemsSelected,
  unselectAttemptedQueuedItems,
} from "@/features/page-import/utils/queueSelection";
import ActivityIndicator from "@/components/image-uploader/ActivityIndicator";
import { QUEUE_RENDER_LIMIT } from "@/components/image-uploader/constants";
import type { GalleryImageSummary } from "@/components/image-uploader/types";
import { useUploadActivity } from "@/components/image-uploader/useUploadActivity";
import { useUploaderUploadActions } from "@/components/image-uploader/useUploaderUploadActions";
import { useUploaderAnimation } from "@/components/image-uploader/useUploaderAnimation";
import { useUploaderImportUrl } from "@/components/image-uploader/useUploaderImportUrl";
import { useUploadGuard } from "@/components/image-uploader/useUploadGuard";
import { useUploadNamespaceControls } from "@/components/image-uploader/useUploadNamespaceControls";
import { useUploaderActivityStats } from "@/components/image-uploader/useUploaderActivityStats";
import { useQueuedImageReduction } from "@/components/image-uploader/useQueuedImageReduction";
import { copyUrlToClipboard } from "@/components/image-uploader/clipboard";
import { useUploadedImageActions } from "@/components/image-uploader/useUploadedImageActions";
import UploadedImagesList from "@/components/image-uploader/UploadedImagesList";
import UploaderMetadataControls from "@/components/image-uploader/UploaderMetadataControls";
import UploadNamespaceControls from "@/components/image-uploader/UploadNamespaceControls";
import UploaderStatusAlerts from "@/components/image-uploader/UploaderStatusAlerts";
import UploaderDropzone from "@/components/image-uploader/UploaderDropzone";
import EmbeddingSettingsPanel from "@/components/image-uploader/EmbeddingSettingsPanel";
import ImportUrlPanel from "@/components/image-uploader/ImportUrlPanel";
import AnimationControlsBar from "@/components/image-uploader/AnimationControlsBar";
import {
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
  const previewFallbackAttemptedRef = useRef<Set<string>>(new Set());
  const [previewFailures, setPreviewFailures] = useState<Record<string, boolean>>({});
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
    pageImportSmallAssetThresholdMb,
    setPageImportSmallAssetThresholdMb,
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
  const {
    importUrl,
    setImportUrl,
    importLoading,
    importError,
    handleImportFromUrl,
  } = useUploaderImportUrl({
    createQueueId,
    originalUrl,
    setOriginalUrl,
    setQueuedFiles,
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
  }, [setQueuedFiles]);

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
  }, [setQueuedFiles]);

  const {
    reducingQueueItems,
    reduceQueuedFileSize,
    clearReducingQueueItem,
    clearReducingQueueItems,
  } = useQueuedImageReduction({
    queuedFiles,
    updateQueuedFile,
    setPreviewFailures,
  });

  const estimateMetadataBytes = useCallback((payload: Record<string, unknown>) => {
    const filtered = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined && value !== "")
    );
    const json = JSON.stringify(filtered);
    return new TextEncoder().encode(json).length;
  }, []);

  const {
    uploadNamespace,
    uploadNamespaceSelectValue,
    uploadNamespaceDraft,
    uploadNamespaceOptions,
    handleUploadNamespaceSelectChange,
    handleUploadNamespaceApply,
    handleUploadNamespaceDraftChange,
  } = useUploadNamespaceControls({ namespace, onNamespaceChange });

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

  const resolveFolder = useCallback(
    () => newFolder.trim() || selectedFolder,
    [newFolder, selectedFolder]
  );

  const selectedQueuedCount = useMemo(
    () => queuedFiles.filter((item) => item.selected !== false).length,
    [queuedFiles]
  );
  const smallAssetReviewQueuedCount = useMemo(
    () => queuedFiles.filter((item) => item.smallAssetReview).length,
    [queuedFiles]
  );
  const queuedImageCount = useMemo(
    () =>
      queuedFiles.filter((item) => {
        const effectiveAssetType = item.assetType ?? (item.file ? inferAssetTypeFromFile(item.file) : inferAssetTypeFromUrl(item.remoteUrl));
        return effectiveAssetType === 'image';
      }).length,
    [queuedFiles]
  );
  const {
    animateFps,
    setAnimateFps,
    setAnimateFpsTouched,
    animateLoop,
    setAnimateLoop,
    animateFilename,
    setAnimateFilename,
    animateLoading,
    animateError,
    handleCreateAnimation,
  } = useUploaderAnimation({
    queuedFiles,
    selectedQueuedCount,
    uploadNamespace,
    tags,
    description,
    originalUrl,
    sourceUrl,
    selectedParentId,
    resolveFolder,
    setQueuedFiles,
    setPreviewFailures,
    setUploadedImages,
    notifyGalleryUploaded,
  });
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

  const { activityStats, isActivityActive } = useUploaderActivityStats({
    uploadedImages,
    activeUploadOps,
    embeddingQueueDepth,
  });
  const uploadGuardActive = useMemo(
    () => isActivityActive || importLoading || pageImportLoading || aiRefiningNames || animateLoading,
    [aiRefiningNames, animateLoading, importLoading, isActivityActive, pageImportLoading]
  );
  useUploadGuard(uploadGuardActive);

  useEffect(() => {
    if (queuedFiles.length <= QUEUE_RENDER_LIMIT && showAllQueuedItems) {
      setShowAllQueuedItems(false);
    }
  }, [queuedFiles.length, showAllQueuedItems]);

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
  }, [createQueueId, setQueuedFiles, setTags, setDescription]);

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

  const handleAiRefineQueuedNames = useCallback(async (scope: 'selected' | 'all-images') => {
    const targetItems = queuedFiles.filter((item) => {
      if (scope === 'selected' && item.selected === false) return false;
      const effectiveAssetType = item.assetType ?? (item.file ? inferAssetTypeFromFile(item.file) : inferAssetTypeFromUrl(item.remoteUrl));
      return effectiveAssetType === 'image';
    });
    if (targetItems.length === 0) return;

    setAiRefiningNames(true);
    try {
      const fallbackFolder = resolveFolder();
      for (const item of targetItems) {
        try {
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

  const sanitizeQueueNames = useCallback(() => {
    setQueuedFiles((prev) =>
      prev.map((item) => ({
        ...item,
        filename: sanitizeFilename(item.filename),
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
    clearReducingQueueItems();
    setExpandedQueueMetadata({});
    setShowAllQueuedItems(false);
  }, [clearQueue, clearReducingQueueItems]);

  const handleUnselectAllQueuedItems = useCallback(() => {
    unselectAllQueuedFiles();
  }, [unselectAllQueuedFiles]);

  const handleSelectAllQueuedItems = useCallback(() => {
    setQueuedFiles((prev) => setAllQueuedItemsSelected(prev, true));
  }, [setQueuedFiles]);

  const handleSelectSmallAssetQueuedItems = useCallback(() => {
    setQueuedFiles((prev) => setSmallAssetReviewItemsSelected(prev, true));
  }, [setQueuedFiles]);

  const handleRemoveQueuedItem = useCallback((id: string) => {
    removeQueuedFile(id);
    setPreviewFailures((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    clearReducingQueueItem(id);
    setExpandedQueueMetadata((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [clearReducingQueueItem, removeQueuedFile]);

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

  const { removeImage, handleRetryUpload } = useUploadedImageActions({
    setUploadedImages,
    uploadFiles,
    uploadRemoteFiles,
  });

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xs font-mono  text-gray-900 mb-4">Upload Media</h2>

      {/* Activity Indicator - prominent progress during bulk operations */}
      {(isActivityActive || activityStats.total > 0) && (
        <ActivityIndicator stats={activityStats} isActive={isActivityActive} />
      )}
      <UploaderStatusAlerts uploadGuardActive={uploadGuardActive} uploadNamespace={uploadNamespace} />

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
      <UploadNamespaceControls
        uploadNamespace={uploadNamespace}
        uploadNamespaceSelectValue={uploadNamespaceSelectValue}
        uploadNamespaceDraft={uploadNamespaceDraft}
        uploadNamespaceOptions={uploadNamespaceOptions}
        isUploading={isUploading}
        onSelectChange={handleUploadNamespaceSelectChange}
        onDraftChange={handleUploadNamespaceDraftChange}
        onApply={handleUploadNamespaceApply}
      />

      <UploaderDropzone
        rootProps={getRootProps()}
        inputProps={getInputProps()}
        isDragActive={isDragActive}
        isUploading={isUploading}
      />

      <EmbeddingSettingsPanel
        embeddingQueueDepth={embeddingQueueDepth}
        embedClipOnUpload={embedClipOnUpload}
        setEmbedClipOnUpload={setEmbedClipOnUpload}
        embedColorOnUpload={embedColorOnUpload}
        setEmbedColorOnUpload={setEmbedColorOnUpload}
      />

      <ImportUrlPanel
        importUrl={importUrl}
        setImportUrl={setImportUrl}
        importLoading={importLoading}
        importError={importError}
        onImportFromUrl={() => {
          void handleImportFromUrl();
        }}
      />

      <PageImportControls
        pageImportUrl={pageImportUrl}
        setPageImportUrl={setPageImportUrl}
        pageImportLoading={pageImportLoading}
        pageImportScrollMode={pageImportScrollMode}
        pageImportAutoScroll={pageImportAutoScroll}
        setPageImportAutoScroll={setPageImportAutoScroll}
        pageImportIncludeSmallAssets={pageImportIncludeSmallAssets}
        setPageImportIncludeSmallAssets={setPageImportIncludeSmallAssets}
        pageImportSmallAssetThresholdMb={pageImportSmallAssetThresholdMb}
        setPageImportSmallAssetThresholdMb={setPageImportSmallAssetThresholdMb}
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

      <AnimationControlsBar
        visible={queuedFiles.length > 0}
        animateFps={animateFps}
        setAnimateFps={setAnimateFps}
        setAnimateFpsTouched={setAnimateFpsTouched}
        animateLoop={animateLoop}
        setAnimateLoop={setAnimateLoop}
        animateFilename={animateFilename}
        setAnimateFilename={setAnimateFilename}
        animateLoading={animateLoading}
        animateError={animateError}
        selectedQueuedCount={selectedQueuedCount}
        onCreateAnimation={() => {
          void handleCreateAnimation();
        }}
      />

      <PageImportQueue
        queuedFiles={queuedFiles}
        visibleQueuedFiles={visibleQueuedFiles}
        selectedQueuedCount={selectedQueuedCount}
        smallAssetReviewQueuedCount={smallAssetReviewQueuedCount}
        queuedImageCount={queuedImageCount}
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
        onSelectAll={handleSelectAllQueuedItems}
        onSelectSmallAssets={handleSelectSmallAssetQueuedItems}
        onAiRefineSelectedNames={() => {
          void handleAiRefineQueuedNames('selected');
        }}
        onAiRefineAllImageNames={() => {
          void handleAiRefineQueuedNames('all-images');
        }}
        onManualUpload={() => {
          void handleManualUpload();
        }}
        onApplyQueueNameToAll={applyQueueNameToAll}
        onSanitizeQueueNames={sanitizeQueueNames}
        onRemoveQueueExtensions={removeQueueExtensions}
        onAppendTextToQueueNames={appendTextToQueueNames}
      />

      <UploadedImagesList
        uploadedImages={uploadedImages}
        isUploading={isUploading}
        onClearAll={() => setUploadedImages([])}
        onCopyUrl={(url) => {
          void copyUrlToClipboard(url);
        }}
        onRemove={removeImage}
        onRetryUpload={handleRetryUpload}
      />
    </div>
  );
}
 
