import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { UploaderQueueItem } from '@/features/page-import/types';
import { runWithConcurrency } from '@/components/image-uploader/concurrency';
import { NAMESPACE_REQUIRED_UPLOAD_ERROR } from '@/components/image-uploader/constants';
import { resolveTagInput } from '@/components/image-uploader/fileHelpers';
import type { UploadedImage } from '@/components/image-uploader/types';
import { uploadFormDataWithRetry } from '@/services/uploadRequestService';
import { inferAssetTypeFromFile, inferAssetTypeFromUrl } from '@/utils/mediaAssetType';

type QueuedFile = UploaderQueueItem;

interface UploadResult {
  clientId: string;
  id?: string;
  url?: string;
  folder?: string;
  tags?: string[];
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
}

interface UploadFailure {
  clientId: string;
  error?: string;
}

interface UseUploaderUploadActionsOptions {
  uploadNamespace: string | null;
  embedClipOnUpload: boolean;
  embedColorOnUpload: boolean;
  omitOriginalUrl: boolean;
  tags: string;
  description: string;
  originalUrl: string;
  sourceUrl: string;
  selectedParentId: string;
  pageImportAllowInsecure: boolean;
  pageImportCookieHeader: string;
  pageImportIncludeSmallAssets: boolean;
  resolveFolder: () => string;
  beginUploadActivity: () => void;
  endUploadActivity: () => void;
  enqueueEmbedding: (imageId: string, clip: boolean, color: boolean) => void;
  notifyGalleryUploaded: (delayMs?: number) => void;
  fetchFolders: () => Promise<void>;
  setUploadedImages: Dispatch<SetStateAction<UploadedImage[]>>;
  resetUploadForm: () => void;
}

const VIDEO_REMOTE_UPLOAD_CONCURRENCY = 2;

const formatUploadErrorMessage = (response: Response, payload: unknown) => {
  if (response.status === 409 && payload && typeof payload === 'object' && 'duplicates' in payload) {
    const data = payload as { error?: string; duplicates?: Array<{ id?: string; filename?: string; folder?: string }> };
    if (Array.isArray(data.duplicates) && data.duplicates.length > 0) {
      const summary = data.duplicates
        .map((dup) => {
          const label = dup.filename || 'Untitled';
          const location = dup.folder ? `${label} (${dup.folder})` : label;
          return dup.id ? `${location} [${dup.id}]` : location;
        })
        .slice(0, 3)
        .join(', ');
      const extra = data.duplicates.length > 3 ? '…' : '';
      return `${data.error || 'Duplicate detected.'} Existing: ${summary}${extra}`;
    }
  }
  if (payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error?: string }).error === 'string') {
    return (payload as { error?: string }).error as string;
  }
  return 'Upload failed';
};

export const useUploaderUploadActions = ({
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
}: UseUploaderUploadActionsOptions) => {
  const markNamespaceUploadFailures = useCallback((items: QueuedFile[]) => {
    const failures: UploadedImage[] = items.map((item) => ({
      id: item.id,
      assetType: item.assetType ?? (item.file ? inferAssetTypeFromFile(item.file) : inferAssetTypeFromUrl(item.remoteUrl)),
      url: '',
      filename: item.filename,
      status: 'error',
      error: NAMESPACE_REQUIRED_UPLOAD_ERROR,
      file: item.file,
      remoteUrl: item.remoteUrl,
    }));
    setUploadedImages((prev) => {
      const ids = new Set(failures.map((entry) => entry.id));
      return [...prev.filter((entry) => !ids.has(entry.id)), ...failures];
    });
  }, [setUploadedImages]);

  const uploadFiles = useCallback(
    async (filesToUpload: QueuedFile[]) => {
      if (!uploadNamespace) {
        markNamespaceUploadFailures(filesToUpload);
        return;
      }

      beginUploadActivity();
      let uploadedAny = false;
      const shouldEmbedClip = embedClipOnUpload;
      const shouldEmbedColor = embedColorOnUpload;
      const shouldEmbedAnything = shouldEmbedClip || shouldEmbedColor;
      const folderToUse = resolveFolder();
      const uploadDelayMs = 200;
      const maxRetries = 3;
      const retryDelayMs = 2000;
      const rateLimitDelayMs = 5000;
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const uploadWithRetry = async (
        formData: FormData
      ): Promise<{ response: Response; result: unknown }> =>
        uploadFormDataWithRetry('/api/upload', formData, {
          maxRetries,
          retryDelayMs,
          rateLimitDelayMs,
        });

      const uploadVideoWithRetry = async (
        formData: FormData
      ): Promise<{ response: Response; result: unknown }> =>
        uploadFormDataWithRetry('/api/import/page/upload-video', formData, {
          maxRetries,
          retryDelayMs,
          rateLimitDelayMs,
        });

      const initialImages: UploadedImage[] = filesToUpload.map((entry) => {
        const originalUrlToSend = omitOriginalUrl
          ? ''
          : entry.originalUrl !== undefined
            ? entry.originalUrl
            : originalUrl.trim() || '';
        const sourceUrlToSend = entry.sourceUrl !== undefined ? entry.sourceUrl : sourceUrl.trim() || '';
        const folderToSend = entry.folder !== undefined ? entry.folder : folderToUse;
        const tagsToSend = resolveTagInput(tags, entry.tags);
        const descriptionToSend = entry.description !== undefined ? entry.description : description;

        return {
          id: entry.id,
          assetType: entry.assetType ?? (entry.file ? inferAssetTypeFromFile(entry.file) : 'image'),
          url: '',
          filename: entry.filename,
          status: 'uploading' as const,
          file: entry.file,
          folderInput: folderToSend,
          tagsInput: tagsToSend,
          descriptionInput: descriptionToSend,
          originalUrlInput: originalUrlToSend || undefined,
          sourceUrlInput: sourceUrlToSend || undefined,
          parentId: entry.groupId ? undefined : selectedParentId || undefined,
        };
      });

      setUploadedImages((prev) => {
        const ids = new Set(initialImages.map((item) => item.id));
        return [...prev.filter((img) => !ids.has(img.id)), ...initialImages];
      });

      const groupParentMap = new Map<string, string>();
      const groupFirstId = new Map<string, string>();
      filesToUpload.forEach((entry) => {
        if (entry.groupId && !groupFirstId.has(entry.groupId)) {
          groupFirstId.set(entry.groupId, entry.id);
        }
      });

      for (let i = 0; i < filesToUpload.length; i += 1) {
        const {
          file,
          assetType,
          filename: queuedFilename,
          originalUrl: queuedOriginalUrl,
          sourceUrl: queuedSourceUrl,
          sourcePath: queuedSourcePath,
          folder: queuedFolder,
          tags: queuedTags,
          description: queuedDescription,
          groupId: queuedGroupId,
          id: queuedId,
        } = filesToUpload[i];
        const imageId = queuedId;
        const originalUrlToSend = omitOriginalUrl
          ? ''
          : queuedOriginalUrl !== undefined
            ? queuedOriginalUrl
            : originalUrl.trim() || '';
        const sourceUrlToSend = queuedSourceUrl !== undefined ? queuedSourceUrl : sourceUrl.trim() || '';
        const sourcePathToSend = queuedSourcePath && queuedSourcePath.trim() ? queuedSourcePath.trim() : '';
        const folderToSend = queuedFolder !== undefined ? queuedFolder : folderToUse;
        const tagsToSend = resolveTagInput(tags, queuedTags);
        const descriptionToSend = queuedDescription !== undefined ? queuedDescription : description;
        const displayNameToSend = queuedFilename?.trim() || file?.name || '';
        const groupId = queuedGroupId || '';
        const groupParentId = groupId ? groupParentMap.get(groupId) : undefined;
        const isGroupParent = groupId ? groupFirstId.get(groupId) === imageId : false;
        const parentIdToSend = groupId
          ? (isGroupParent ? undefined : groupParentId)
          : selectedParentId || undefined;

        if (!file) {
          setUploadedImages((prev) =>
            prev.map((img) =>
              img.id === imageId ? { ...img, status: 'error', error: 'Missing file data' } : img
            )
          );
          continue;
        }

        if (groupId && !isGroupParent && !groupParentId) {
          setUploadedImages((prev) =>
            prev.map((img) =>
              img.id === imageId
                ? { ...img, status: 'error', error: 'Missing parent image for Keynote group' }
                : img
            )
          );
          continue;
        }

        try {
          const formData = new FormData();
          formData.append('file', file);
          const effectiveAssetType = assetType ?? inferAssetTypeFromFile(file);
          if (displayNameToSend) formData.append('displayName', displayNameToSend);
          if (folderToSend && folderToSend.trim()) formData.append('folder', folderToSend.trim());
          if (tagsToSend && tagsToSend.trim()) formData.append('tags', tagsToSend.trim());
          if (descriptionToSend && descriptionToSend.trim()) formData.append('description', descriptionToSend.trim());
          if (originalUrlToSend) formData.append('originalUrl', originalUrlToSend);
          if (sourceUrlToSend) formData.append('sourceUrl', sourceUrlToSend);
          if (sourcePathToSend) formData.append('sourcePath', sourcePathToSend);
          formData.append('namespace', uploadNamespace);
          if (parentIdToSend) formData.append('parentId', parentIdToSend);
          if (i > 0) await delay(uploadDelayMs);

          const { response, result } =
            effectiveAssetType === 'video'
              ? await uploadVideoWithRetry(formData)
              : await uploadWithRetry(formData);

          if (response.ok) {
            if (result && typeof result === 'object' && Array.isArray((result as { results?: unknown }).results)) {
              const zipResult = result as {
                results: Array<{
                  id: string;
                  filename: string;
                  url: string;
                  folder?: string;
                  tags?: string[];
                  description?: string;
                  originalUrl?: string;
                  sourceUrl?: string;
                }>;
                failures?: Array<{ filename: string; error: string }>;
                skipped?: Array<{ filename: string; reason: string }>;
              };
              const successEntries: UploadedImage[] = zipResult.results.map((item) => ({
                id: item.id,
                assetType: 'image',
                url: item.url,
                filename: item.filename,
                status: 'success',
                embeddingStatus: shouldEmbedAnything ? 'queued' : undefined,
                embeddingRequested: shouldEmbedAnything ? { clip: shouldEmbedClip, color: shouldEmbedColor } : undefined,
                folder: item.folder,
                tags: item.tags,
                description: item.description,
                originalUrl: item.originalUrl,
                sourceUrl: item.sourceUrl,
              }));
              const failureEntries: UploadedImage[] = (zipResult.failures || []).map((item) => ({
                id: Math.random().toString(36).substring(7),
                assetType: 'image',
                url: '',
                filename: item.filename,
                status: 'error',
                error: item.error,
              }));
              const skippedEntries: UploadedImage[] = (zipResult.skipped || []).map((item) => ({
                id: Math.random().toString(36).substring(7),
                assetType: 'image',
                url: '',
                filename: item.filename,
                status: 'error',
                error: item.reason,
              }));
              setUploadedImages((prev) => [
                ...prev.filter((img) => img.id !== imageId),
                ...successEntries,
                ...failureEntries,
                ...skippedEntries,
              ]);
              if (shouldEmbedAnything) {
                successEntries.forEach((entry) => enqueueEmbedding(entry.id, shouldEmbedClip, shouldEmbedColor));
              }
              if (successEntries.length > 0) uploadedAny = true;
            } else {
              const typedResult = result as {
                id?: string;
                url?: string;
                playbackUrl?: string;
                hlsUrl?: string;
                thumbnailUrl?: string;
              };
              const serverId =
                typedResult && typeof typedResult === 'object' && 'id' in typedResult && typeof typedResult.id === 'string'
                  ? typedResult.id
                  : imageId;
              if (groupId && isGroupParent && serverId) {
                groupParentMap.set(groupId, serverId);
              }
              setUploadedImages((prev) =>
                prev.map((img) =>
                  img.id === imageId
                    ? {
                        ...img,
                        id: serverId,
                        status: 'success',
                        embeddingStatus: effectiveAssetType === 'image' && shouldEmbedAnything ? 'queued' : undefined,
                        embeddingRequested:
                          effectiveAssetType === 'image' && shouldEmbedAnything
                            ? { clip: shouldEmbedClip, color: shouldEmbedColor }
                            : undefined,
                        assetType: effectiveAssetType,
                        url: typedResult.url || typedResult.playbackUrl || typedResult.hlsUrl || typedResult.thumbnailUrl || '',
                        folder: folderToSend || undefined,
                        tags: tagsToSend.trim() ? tagsToSend.trim().split(',').map((tag) => tag.trim()) : [],
                        description: descriptionToSend || undefined,
                        originalUrl: originalUrlToSend || undefined,
                        sourceUrl: sourceUrlToSend || undefined,
                        file: undefined,
                      }
                    : img
                )
              );
              if (effectiveAssetType === 'image' && shouldEmbedAnything) {
                enqueueEmbedding(serverId, shouldEmbedClip, shouldEmbedColor);
              }
              uploadedAny = true;
            }
          } else {
            const errorMessage = formatUploadErrorMessage(response, result);
            setUploadedImages((prev) =>
              prev.map((img) => (img.id === imageId ? { ...img, status: 'error', error: errorMessage } : img))
            );
          }
        } catch (uploadError) {
          console.error('Upload error:', uploadError);
          const errorMessage =
            uploadError instanceof Error && uploadError.message ? uploadError.message : 'Network error';
          setUploadedImages((prev) =>
            prev.map((img) => (img.id === imageId ? { ...img, status: 'error', error: errorMessage } : img))
          );
        }
      }

      endUploadActivity();
      if (uploadedAny) notifyGalleryUploaded();
      void fetchFolders().catch((error) => {
        console.warn('Failed to refresh folders after upload', error);
      });
      resetUploadForm();
    },
    [
      beginUploadActivity,
      description,
      embedClipOnUpload,
      embedColorOnUpload,
      endUploadActivity,
      enqueueEmbedding,
      fetchFolders,
      markNamespaceUploadFailures,
      notifyGalleryUploaded,
      omitOriginalUrl,
      originalUrl,
      resetUploadForm,
      resolveFolder,
      selectedParentId,
      setUploadedImages,
      sourceUrl,
      tags,
      uploadNamespace,
    ]
  );

  const uploadRemoteFiles = useCallback(
    async (itemsToUpload: QueuedFile[]) => {
      const validItems = itemsToUpload.filter((item) => Boolean(item.remoteUrl));
      if (validItems.length === 0) return;
      if (!uploadNamespace) {
        markNamespaceUploadFailures(validItems);
        return;
      }
      beginUploadActivity();

      const shouldEmbedClip = embedClipOnUpload;
      const shouldEmbedColor = embedColorOnUpload;
      const shouldEmbedAnything = shouldEmbedClip || shouldEmbedColor;
      const folderToUse = resolveFolder();
      const imagePayloadItems = validItems
        .filter((entry) => (entry.assetType ?? inferAssetTypeFromUrl(entry.remoteUrl)) === 'image')
        .map((entry) => {
          const originalUrlToSend = omitOriginalUrl
            ? ''
            : entry.originalUrl !== undefined
              ? entry.originalUrl
              : originalUrl.trim() || entry.remoteUrl || '';
          const sourceUrlToSend = entry.sourceUrl !== undefined ? entry.sourceUrl : sourceUrl.trim() || '';
          const folderToSend = entry.folder !== undefined ? entry.folder : folderToUse;
          const tagsToSend = resolveTagInput(tags, entry.tags);
          const descriptionToSend = entry.description !== undefined ? entry.description : description;
          const displayNameToSend = entry.filename?.trim() || undefined;

          return {
            clientId: entry.id,
            url: entry.remoteUrl,
            displayName: displayNameToSend,
            folder: folderToSend && folderToSend.trim() ? folderToSend.trim() : undefined,
            tags: tagsToSend && tagsToSend.trim() ? tagsToSend.trim() : undefined,
            description: descriptionToSend && descriptionToSend.trim() ? descriptionToSend.trim() : undefined,
            originalUrl: originalUrlToSend || undefined,
            sourceUrl: sourceUrlToSend || undefined,
            namespace: uploadNamespace,
            parentId: selectedParentId || undefined,
            sessionId: entry.importSessionId,
            tempAssetKey: entry.tempAssetKey,
          };
        });
      const videoPayloadItems = validItems
        .filter((entry) => (entry.assetType ?? inferAssetTypeFromUrl(entry.remoteUrl)) === 'video')
        .map((entry) => {
          const originalUrlToSend = omitOriginalUrl
            ? ''
            : entry.originalUrl !== undefined
              ? entry.originalUrl
              : originalUrl.trim() || entry.remoteUrl || '';
          const sourceUrlToSend = entry.sourceUrl !== undefined ? entry.sourceUrl : sourceUrl.trim() || '';
          const folderToSend = entry.folder !== undefined ? entry.folder : folderToUse;
          const tagsToSend = resolveTagInput(tags, entry.tags);
          const descriptionToSend = entry.description !== undefined ? entry.description : description;
          return {
            clientId: entry.id,
            url: entry.remoteUrl || '',
            filename: entry.filename,
            isBlobSource: Boolean(entry.isBlobSource) || (entry.remoteUrl || '').startsWith('blob:'),
            folder: folderToSend && folderToSend.trim() ? folderToSend.trim() : undefined,
            tags: tagsToSend && tagsToSend.trim() ? tagsToSend.trim() : undefined,
            description: descriptionToSend && descriptionToSend.trim() ? descriptionToSend.trim() : undefined,
            originalUrl: originalUrlToSend || undefined,
            sourceUrl: sourceUrlToSend || undefined,
            namespace: uploadNamespace,
          };
        });

      const initialImages: UploadedImage[] = validItems.map((entry) => {
        const effectiveAssetType = entry.assetType ?? inferAssetTypeFromUrl(entry.remoteUrl);
        const originalUrlToSend = omitOriginalUrl
          ? ''
          : entry.originalUrl !== undefined
            ? entry.originalUrl
            : originalUrl.trim() || entry.remoteUrl || '';
        const sourceUrlToSend = entry.sourceUrl !== undefined ? entry.sourceUrl : sourceUrl.trim() || '';
        const folderToSend = entry.folder !== undefined ? entry.folder : folderToUse;
        const tagsToSend = resolveTagInput(tags, entry.tags);
        const descriptionToSend = entry.description !== undefined ? entry.description : description;
        return {
          id: entry.id,
          assetType: effectiveAssetType,
          url: '',
          filename: entry.filename,
          status: 'uploading' as const,
          remoteUrl: entry.remoteUrl,
          folderInput: folderToSend,
          tagsInput: tagsToSend,
          descriptionInput: descriptionToSend,
          originalUrlInput: originalUrlToSend || undefined,
          sourceUrlInput: sourceUrlToSend || undefined,
          parentId: selectedParentId || undefined,
        };
      });

      setUploadedImages((prev) => {
        const ids = new Set(initialImages.map((item) => item.id));
        return [...prev.filter((img) => !ids.has(img.id)), ...initialImages];
      });

      try {
        const resultList: UploadResult[] = [];
        const failureList: UploadFailure[] = [];

        if (imagePayloadItems.length > 0) {
          const imageResponse = await fetch('/api/import/page/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: imagePayloadItems,
              allowInsecure: pageImportAllowInsecure,
              includeSmallAssets: pageImportIncludeSmallAssets,
              ...(pageImportCookieHeader.trim() ? { cookieHeader: pageImportCookieHeader.trim() } : {}),
            }),
          });
          const imageData = await imageResponse.json();

          if (!imageResponse.ok) {
            const message = typeof imageData?.error === 'string' ? imageData.error : 'Failed to upload page images';
            setUploadedImages((prev) =>
              prev.map((img) =>
                imagePayloadItems.some((item) => item.clientId === img.id)
                  ? { ...img, status: 'error', error: message }
                  : img
              )
            );
            return;
          }

          if (Array.isArray(imageData?.results)) resultList.push(...imageData.results);
          if (Array.isArray(imageData?.failures)) failureList.push(...imageData.failures);
        }

        if (videoPayloadItems.length > 0) {
          await runWithConcurrency(videoPayloadItems, VIDEO_REMOTE_UPLOAD_CONCURRENCY, async (item) => {
            const isBlobSource = item.isBlobSource || item.url.startsWith('blob:');
            let videoResponse: Response;
            if (isBlobSource) {
              try {
                const blobResponse = await fetch(item.url);
                if (!blobResponse.ok) throw new Error(`Blob fetch failed (${blobResponse.status})`);
                const blob = await blobResponse.blob();
                const extension = blob.type.includes('webm') ? 'webm' : blob.type.includes('ogg') ? 'ogv' : 'mp4';
                const filename = item.filename || `captured-video.${extension}`;
                const file = new File([blob], filename, { type: blob.type || 'video/mp4' });
                const formData = new FormData();
                formData.append('file', file);
                if (item.folder) formData.append('folder', item.folder);
                if (item.tags) formData.append('tags', item.tags);
                if (item.description) formData.append('description', item.description);
                if (item.originalUrl) formData.append('originalUrl', item.originalUrl);
                if (item.sourceUrl) formData.append('sourceUrl', item.sourceUrl);
                if (item.namespace) formData.append('namespace', item.namespace);
                videoResponse = await fetch('/api/import/page/upload-video', {
                  method: 'POST',
                  body: formData,
                });
              } catch (error) {
                failureList.push({
                  clientId: item.clientId,
                  error: `Blob video capture failed. Open the source page and upload/download the video manually. (${error instanceof Error ? error.message : 'Unknown error'})`,
                });
                return;
              }
            } else {
              videoResponse = await fetch('/api/import/page/upload-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url: item.url,
                  filename: item.filename,
                  folder: item.folder,
                  tags: item.tags,
                  description: item.description,
                  originalUrl: item.originalUrl,
                  sourceUrl: item.sourceUrl,
                  namespace: item.namespace,
                }),
              });
            }
            const videoData = await videoResponse.json();
            if (!videoResponse.ok) {
              failureList.push({ clientId: item.clientId, error: videoData?.error || 'Video upload failed' });
              return;
            }
            resultList.push({
              clientId: item.clientId,
              id: videoData.id,
              url: videoData.playbackUrl || videoData.hlsUrl || videoData.thumbnailUrl || '',
              folder: videoData.folder,
              tags: videoData.tags,
              description: videoData.description,
              originalUrl: videoData.originalUrl,
              sourceUrl: videoData.sourceUrl,
            });
          });
        }

        const successMap = new Map<string, UploadResult>(resultList.map((item) => [item.clientId, item]));
        const failureMap = new Map<string, UploadFailure>(failureList.map((item) => [item.clientId, item]));

        setUploadedImages((prev) =>
          prev.map((img) => {
            const success = successMap.get(img.id);
            if (success) {
              const sourceItem = validItems.find((item) => item.id === img.id);
              const assetType = sourceItem?.assetType ?? inferAssetTypeFromUrl(sourceItem?.remoteUrl);
              return {
                ...img,
                id: success.id ?? img.id,
                status: 'success' as const,
                assetType,
                embeddingStatus: assetType === 'image' && shouldEmbedAnything ? 'queued' : undefined,
                embeddingRequested:
                  assetType === 'image' && shouldEmbedAnything
                    ? { clip: shouldEmbedClip, color: shouldEmbedColor }
                    : undefined,
                url: success.url ?? img.url,
                folder: success.folder,
                tags: success.tags,
                description: success.description,
                originalUrl: success.originalUrl,
                sourceUrl: success.sourceUrl,
                remoteUrl: undefined,
              };
            }
            const failure = failureMap.get(img.id);
            if (failure) {
              return { ...img, status: 'error' as const, error: failure.error || 'Upload failed' };
            }
            if (validItems.some((item) => item.id === img.id)) {
              return { ...img, status: 'error' as const, error: 'Upload failed' };
            }
            return img;
          })
        );

        if (shouldEmbedAnything) {
          resultList.forEach((item) => {
            const sourceItem = validItems.find((entry) => entry.id === item.clientId);
            const assetType = sourceItem?.assetType ?? inferAssetTypeFromUrl(sourceItem?.remoteUrl);
            if (item.id && assetType === 'image') {
              enqueueEmbedding(item.id, shouldEmbedClip, shouldEmbedColor);
            }
          });
        }

        if (resultList.length > 0) notifyGalleryUploaded();
      } catch (error) {
        console.error('Remote upload error:', error);
        setUploadedImages((prev) =>
          prev.map((img) =>
            validItems.some((item) => item.id === img.id)
              ? { ...img, status: 'error', error: 'Network error' }
              : img
          )
        );
      } finally {
        endUploadActivity();
        void fetchFolders().catch((error) => {
          console.warn('Failed to refresh folders after upload', error);
        });
        resetUploadForm();
      }
    },
    [
      beginUploadActivity,
      description,
      embedClipOnUpload,
      embedColorOnUpload,
      endUploadActivity,
      enqueueEmbedding,
      fetchFolders,
      markNamespaceUploadFailures,
      notifyGalleryUploaded,
      omitOriginalUrl,
      originalUrl,
      pageImportAllowInsecure,
      pageImportCookieHeader,
      pageImportIncludeSmallAssets,
      resetUploadForm,
      resolveFolder,
      selectedParentId,
      setUploadedImages,
      sourceUrl,
      tags,
      uploadNamespace,
    ]
  );

  return {
    markNamespaceUploadFailures,
    uploadFiles,
    uploadRemoteFiles,
  };
};
