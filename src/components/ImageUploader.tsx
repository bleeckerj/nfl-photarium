'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { inferAssetTypeFromUrl } from "@/utils/mediaAssetType";
import { usePageImportSession } from "@/features/page-import/hooks/usePageImportSession";
import { usePageImportDiscovery } from "@/features/page-import/hooks/usePageImportDiscovery";
import { useCandidateMetadataEnrichment } from "@/features/page-import/hooks/useCandidateMetadataEnrichment";
import { useLocalVideoPreviews } from "@/features/page-import/hooks/useLocalVideoPreviews";
import { PageImportControls } from "@/features/page-import/components/PageImportControls";
import { PageImportQueue } from "@/features/page-import/components/PageImportQueue";
import type { UploaderQueueItem } from "@/features/page-import/types";
import ActivityIndicator from "@/components/image-uploader/ActivityIndicator";
import { useUploadActivity } from "@/components/image-uploader/useUploadActivity";
import { useUploaderUploadActions } from "@/components/image-uploader/useUploaderUploadActions";
import { useUploaderAnimation } from "@/components/image-uploader/useUploaderAnimation";
import { useUploaderImportUrl } from "@/components/image-uploader/useUploaderImportUrl";
import { useUploadGuard } from "@/components/image-uploader/useUploadGuard";
import { useUploadNamespaceControls } from "@/components/image-uploader/useUploadNamespaceControls";
import { useUploaderActivityStats } from "@/components/image-uploader/useUploaderActivityStats";
import { useQueuedImageReduction } from "@/components/image-uploader/useQueuedImageReduction";
import { useQueuePreviewFallback } from "@/components/image-uploader/useQueuePreviewFallback";
import { useQueueNameTools } from "@/components/image-uploader/useQueueNameTools";
import { useQueueViewActions } from "@/components/image-uploader/useQueueViewActions";
import { useUploaderFileIntake } from "@/components/image-uploader/useUploaderFileIntake";
import { useUploaderFolders } from "@/components/image-uploader/useUploaderFolders";
import { useManualUpload } from "@/components/image-uploader/useManualUpload";
import { buildMetadataEstimate, type MetadataOverrides } from "@/components/image-uploader/metadataEstimate";
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
import { inferAssetTypeFromFile, resolveTagInput } from "@/components/image-uploader/fileHelpers";

interface ImageUploaderProps {
  onImageUploaded?: () => void;
  namespace?: string;
  onNamespaceChange?: (value: string) => void;
}

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
  const [selectedParentId, setSelectedParentId] = useState<string>('');
  const galleryRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const { folderSelectOptions, fetchFolders } = useUploaderFolders(namespace);

  const setSourceUrlIfEmpty = useCallback((value: string) => {
    if (!sourceUrl.trim()) {
      setSourceUrl(value);
    }
  }, [sourceUrl]);

  // The discovery hook's return is exactly PageImportControls' prop set, so it
  // is kept whole and spread rather than unpacked into 30 pass-through locals.
  const pageImport = usePageImportDiscovery({
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
  }, []);

  const { previewFailures, setPreviewFailures, handlePreviewLoadError } = useQueuePreviewFallback({
    setQueuedFiles,
  });

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

  const {
    uploadNamespace,
    uploadNamespaceSelectValue,
    uploadNamespaceDraft,
    uploadNamespaceOptions,
    handleUploadNamespaceSelectChange,
    handleUploadNamespaceApply,
    handleUploadNamespaceDraftChange,
  } = useUploadNamespaceControls({ namespace, onNamespaceChange });

  const estimateQueueItemMetadata = useCallback(
    (item: UploaderQueueItem, overrides: MetadataOverrides) =>
      buildMetadataEstimate(item, overrides, {
        namespace: uploadNamespace,
        parentId: selectedParentId,
      }),
    [uploadNamespace, selectedParentId]
  );

  const resolveFolder = useCallback(() => selectedFolder, [selectedFolder]);

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

  const {
    expandedQueueMetadata,
    showAllQueuedItems,
    setShowAllQueuedItems,
    visibleQueuedFiles,
    handleClearQueuedItems,
    handleRemoveQueuedItem,
    handleToggleQueueMetadata,
    handleSelectAllQueuedItems,
    handleSelectSmallAssetQueuedItems,
    handleUnselectAllQueuedItems,
  } = useQueueViewActions({
    queuedFiles,
    clearQueue,
    removeQueuedFile,
    unselectAllQueuedFiles,
    clearReducingQueueItem,
    clearReducingQueueItems,
    setQueuedFiles,
    setPreviewFailures,
  });

  useCandidateMetadataEnrichment({
    queuedFiles,
    visibleIds: visibleQueuedFiles.map((item) => item.id),
    allowInsecure: pageImport.pageImportAllowInsecure,
    cookieHeader: pageImport.pageImportCookieHeader,
    applyMetadataPatches,
  });

  useLocalVideoPreviews({ queuedFiles, updateQueuedFile });

  const {
    aiRefiningNames,
    queueRenameValue,
    setQueueRenameValue,
    queueAppendValue,
    setQueueAppendValue,
    handleAiRefineQueuedNames,
    applyQueueNameToAll,
    removeQueueExtensions,
    sanitizeQueueNames,
    appendTextToQueueNames,
  } = useQueueNameTools({
    queuedFiles,
    tags,
    resolveFolder,
    updateQueuedFile,
    setQueuedFiles,
  });

  const { activityStats, isActivityActive } = useUploaderActivityStats({
    uploadedImages,
    activeUploadOps,
    embeddingQueueDepth,
  });
  const uploadGuardActive = useMemo(
    () => isActivityActive || importLoading || pageImport.pageImportLoading || aiRefiningNames || animateLoading,
    [aiRefiningNames, animateLoading, importLoading, isActivityActive, pageImport.pageImportLoading]
  );
  useUploadGuard(uploadGuardActive);

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
    pageImportAllowInsecure: pageImport.pageImportAllowInsecure,
    pageImportCookieHeader: pageImport.pageImportCookieHeader,
    pageImportIncludeSmallAssets: pageImport.pageImportIncludeSmallAssets,
    resolveFolder,
    beginUploadActivity,
    endUploadActivity,
    enqueueEmbedding,
    notifyGalleryUploaded,
    fetchFolders,
    setUploadedImages,
    resetUploadForm,
  });

  const handleManualUpload = useManualUpload({
    queuedFiles,
    uploadNamespace,
    markNamespaceUploadFailures,
    uploadFiles,
    uploadRemoteFiles,
    setQueuedFiles,
  });

  const { getRootProps, getInputProps, isDragActive } = useUploaderFileIntake({
    createQueueId,
    setQueuedFiles,
    setTags,
    setDescription,
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

      <PageImportControls {...pageImport} />

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
        buildMetadataEstimate={estimateQueueItemMetadata}
        onPreviewLoadError={(item) => {
          void handlePreviewLoadError(item);
        }}
        onReduceSize={(id) => {
          void reduceQueuedFileSize(id);
        }}
        onRemove={handleRemoveQueuedItem}
        onToggleMetadata={handleToggleQueueMetadata}
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
