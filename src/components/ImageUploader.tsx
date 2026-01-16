'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X, CheckCircle, AlertCircle } from "lucide-react";
import clsx from "clsx";
import MonoSelect from "./MonoSelect";
import { normalizeOriginalUrl } from "@/utils/urlNormalization";

interface UploadedImage {
  id: string;
  url: string;
  filename: string;
  status: "uploading" | "success" | "error";
  error?: string;
  folder?: string;
  tags?: string[];
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  file?: File;
  remoteUrl?: string;
  folderInput?: string;
  tagsInput?: string;
  descriptionInput?: string;
  originalUrlInput?: string;
  sourceUrlInput?: string;
  parentId?: string;
}

interface ImageUploaderProps {
  onImageUploaded?: () => void;
  namespace?: string;
}

interface QueuedFile {
  id: string;
  file?: File;
  filename: string;
  remoteUrl?: string;
  previewUrl?: string;
  sizeBytes?: number;
  contentType?: string;
  selected?: boolean;
  originalUrl?: string;
  sourceUrl?: string;
  folder?: string;
  tags?: string;
  description?: string;
  captureDate?: string;
}

interface GalleryImageSummary {
  id: string;
  folder?: string | null;
  filename?: string;
  parentId?: string | null;
}

const base64ToFile = (base64: string, filename: string, mimeType: string) => {
  const byteString = atob(base64);
  const len = byteString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = byteString.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mimeType });
};

const MAX_BYTES = 10 * 1024 * 1024;

const isZipFile = (file: File) => (
  file.type === 'application/zip' ||
  file.type === 'application/x-zip-compressed' ||
  file.name.toLowerCase().endsWith('.zip')
);

const isImageFile = (file: File) => file.type.startsWith('image/');

const shrinkImageFile = async (file: File): Promise<File> => {
  if (!isImageFile(file)) return file;
  if (file.size <= MAX_BYTES) return file;
  const imageBitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const maxDim = 4000;
  const scale = Math.min(1, maxDim / Math.max(imageBitmap.width, imageBitmap.height));
  canvas.width = Math.round(imageBitmap.width * scale);
  canvas.height = Math.round(imageBitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
  let quality = 0.85;
  let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  while (blob && blob.size > MAX_BYTES && quality > 0.4) {
    quality -= 0.1;
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  }
  if (blob && blob.size <= MAX_BYTES) {
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  }
  return file;
};

export default function ImageUploader({ onImageUploaded, namespace }: ImageUploaderProps) {
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [newFolder, setNewFolder] = useState<string>("");
  const [tags, setTags] = useState<string>("found");
  const [description, setDescription] = useState<string>("");
  const [originalUrl, setOriginalUrl] = useState<string>("");
  const [sourceUrl, setSourceUrl] = useState<string>("");
  const [folders, setFolders] = useState<string[]>([
    "email-campaigns",
    "website-images",
    "social-media",
    "blog-posts",
  ]);
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [selectedParentId, setSelectedParentId] = useState<string>('');
  const [parentOptions, setParentOptions] = useState<GalleryImageSummary[]>([]);
  const [importUrl, setImportUrl] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [pageImportUrl, setPageImportUrl] = useState('');
  const [pageImportLoading, setPageImportLoading] = useState(false);
  const [pageImportError, setPageImportError] = useState<string | null>(null);
  const [pageImportAllowInsecure, setPageImportAllowInsecure] = useState(false);
  const [previewFailures, setPreviewFailures] = useState<Record<string, boolean>>({});
  const [animateFps, setAnimateFps] = useState<string>('');
  const [animateFpsTouched, setAnimateFpsTouched] = useState(false);
  const [animateLoop, setAnimateLoop] = useState(true);
  const [animateFilename, setAnimateFilename] = useState('');
  const [animateLoading, setAnimateLoading] = useState(false);
  const [animateError, setAnimateError] = useState<string | null>(null);
  const [expandedQueueMetadata, setExpandedQueueMetadata] = useState<Record<string, boolean>>({});

  const createQueueId = useCallback(
    () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    []
  );

  const updateQueuedFile = useCallback((id: string, updates: Partial<QueuedFile>) => {
    setQueuedFiles((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  }, []);

  const estimateMetadataBytes = useCallback((payload: Record<string, unknown>) => {
    const filtered = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined && value !== "")
    );
    const json = JSON.stringify(filtered);
    return new TextEncoder().encode(json).length;
  }, []);

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
        namespace: namespace || undefined,
        variationParentId: selectedParentId || undefined
      });
    },
    [estimateMetadataBytes, namespace, selectedParentId]
  );

  const formatUploadErrorMessage = useCallback((response: Response, payload: unknown) => {
    if (response.status === 409 && payload && typeof payload === 'object' && 'duplicates' in payload) {
      const data = payload as { error?: string; duplicates?: Array<{ filename?: string; folder?: string }> };
      if (Array.isArray(data.duplicates) && data.duplicates.length > 0) {
        const summary = data.duplicates
          .map((dup) => {
            const label = dup.filename || 'Untitled';
            return dup.folder ? `${label} (${dup.folder})` : label;
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
  }, []);

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

  const canonicalSelectOptions = useMemo(() => {
    const canonicalItems = parentOptions.map((option) => ({
      value: option.id,
      label: option.filename || option.id
    }));
    return [
      { value: '', label: 'No parent (upload canonical image)' },
      ...canonicalItems
    ];
  }, [parentOptions]);

  const selectedQueuedCount = useMemo(
    () => queuedFiles.filter((item) => item.selected !== false).length,
    [queuedFiles]
  );

  useEffect(() => {
    if (animateFpsTouched) return;
    if (selectedQueuedCount === 0) {
      setAnimateFps('');
      return;
    }
    const next = Math.max(1, selectedQueuedCount / 2);
    setAnimateFps(next.toString());
  }, [animateFpsTouched, selectedQueuedCount]);

  // Keep track of queued files for cleanup on unmount
  const queuedFilesRef = useRef(queuedFiles);
  useEffect(() => {
    queuedFilesRef.current = queuedFiles;
  }, [queuedFiles]);

  useEffect(() => {
    return () => {
      queuedFilesRef.current.forEach((file) => {
        if (file.previewUrl && file.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(file.previewUrl);
        }
      });
    };
  }, []);

  // Debug: Log current state
  console.log("ImageUploader - Selected folder:", selectedFolder);
  console.log("ImageUploader - Available folders:", folders);

  // Fetch existing folders from images endpoint and merge with local presets
  const fetchFolders = useCallback(async () => {
    try {
      const resp = await fetch("/api/images");
      const data = await resp.json();
      if (resp.ok && Array.isArray(data.images)) {
        const fetched: string[] = Array.from(
          new Set(
            (data.images as GalleryImageSummary[])
              .map((img) => (img.folder ?? '').trim())
              .filter((folder): folder is string => Boolean(folder))
          )
        );

        setFolders((prev: string[]) =>
          Array.from(new Set<string>([...prev, ...fetched]))
        );
        const canonical = (data.images as GalleryImageSummary[]).filter(
          (img) => !img.parentId && img.id && img.filename
        );
        setParentOptions(canonical);
      }
    } catch (err) {
      console.warn("Failed to fetch folders for uploader", err);
    }
  }, []);

  // Load folders on mount
  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  // Function to actually upload files
  const resolveFolder = useCallback(() => {
    if (selectedFolder && selectedFolder.trim()) {
      return selectedFolder.trim();
    }
    if (newFolder && newFolder.trim()) {
      const normalized = newFolder.trim().toLowerCase().replace(/\s+/g, "-");
      if (!folders.includes(normalized)) {
        setFolders((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
      }
      setSelectedFolder(normalized);
      return normalized;
    }
    return "";
  }, [selectedFolder, newFolder, folders]);

  const uploadFiles = useCallback(
    async (filesToUpload: QueuedFile[]) => {
      setIsUploading(true);

      const folderToUse = resolveFolder();

      // Create initial entries for all files
      const initialImages: UploadedImage[] = filesToUpload.map((entry) => {
        const originalUrlToSend =
          entry.originalUrl !== undefined ? entry.originalUrl : originalUrl.trim() || '';
        const sourceUrlToSend =
          entry.sourceUrl !== undefined ? entry.sourceUrl : sourceUrl.trim() || '';
        const folderToSend = entry.folder !== undefined ? entry.folder : folderToUse;
        const tagsToSend = entry.tags !== undefined ? entry.tags : tags;
        const descriptionToSend = entry.description !== undefined ? entry.description : description;

        return {
          id: entry.id,
          url: "",
          filename: entry.filename,
          status: "uploading" as const,
          file: entry.file,
          folderInput: folderToSend,
          tagsInput: tagsToSend,
          descriptionInput: descriptionToSend,
          originalUrlInput: originalUrlToSend || undefined,
          sourceUrlInput: sourceUrlToSend || undefined,
          parentId: selectedParentId || undefined
        };
      });

      setUploadedImages((prev) => {
        const ids = new Set(initialImages.map((item) => item.id));
        return [...prev.filter((img) => !ids.has(img.id)), ...initialImages];
      });

      // Upload each file
      for (let i = 0; i < filesToUpload.length; i++) {
        const {
          file,
          originalUrl: queuedOriginalUrl,
          sourceUrl: queuedSourceUrl,
          folder: queuedFolder,
          tags: queuedTags,
          description: queuedDescription,
          id: queuedId
        } = filesToUpload[i];
        const imageId = queuedId;
        const originalUrlToSend =
          queuedOriginalUrl !== undefined ? queuedOriginalUrl : originalUrl.trim() || '';
        const sourceUrlToSend =
          queuedSourceUrl !== undefined ? queuedSourceUrl : sourceUrl.trim() || '';
        const folderToSend = queuedFolder !== undefined ? queuedFolder : folderToUse;
        const tagsToSend = queuedTags !== undefined ? queuedTags : tags;
        const descriptionToSend =
          queuedDescription !== undefined ? queuedDescription : description;

        if (!file) {
          setUploadedImages((prev) =>
            prev.map((img) =>
              img.id === imageId
                ? { ...img, status: "error", error: "Missing file data" }
                : img
            )
          );
          continue;
        }

        try {
          const formData = new FormData();
          formData.append("file", file);
          if (folderToSend && folderToSend.trim()) {
            formData.append("folder", folderToSend.trim());
          }
          if (tagsToSend && tagsToSend.trim()) {
            formData.append("tags", tagsToSend.trim());
          }
          if (descriptionToSend && descriptionToSend.trim()) {
            formData.append("description", descriptionToSend.trim());
          }
          if (originalUrlToSend) {
            formData.append("originalUrl", originalUrlToSend);
          }
          if (sourceUrlToSend) {
            formData.append("sourceUrl", sourceUrlToSend);
          }
          if (namespace) {
            formData.append("namespace", namespace);
          }
          if (selectedParentId) {
            formData.append("parentId", selectedParentId);
          }

          const response = await fetch("/api/upload", {
            method: "POST",
            body: formData,
          });

          const result = await response.json();

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
                url: item.url,
                filename: item.filename,
                status: "success",
                folder: item.folder,
                tags: item.tags,
                description: item.description,
                originalUrl: item.originalUrl,
                sourceUrl: item.sourceUrl
              }));
              const failureEntries: UploadedImage[] = (zipResult.failures || []).map((item) => ({
                id: Math.random().toString(36).substring(7),
                url: "",
                filename: item.filename,
                status: "error",
                error: item.error
              }));
              const skippedEntries: UploadedImage[] = (zipResult.skipped || []).map((item) => ({
                id: Math.random().toString(36).substring(7),
                url: "",
                filename: item.filename,
                status: "error",
                error: item.reason
              }));
              setUploadedImages((prev) => [
                ...prev.filter((img) => img.id !== imageId),
                ...successEntries,
                ...failureEntries,
                ...skippedEntries
              ]);

              if (onImageUploaded && successEntries.length > 0) {
                setTimeout(() => {
                  onImageUploaded();
                }, 500);
              }
            } else {
              setUploadedImages((prev) =>
                prev.map((img) =>
                  img.id === imageId
                    ? {
                        ...img,
                        status: "success",
                        url: result.url,
                        folder: folderToSend || undefined,
                        tags: tagsToSend
                          .trim()
                          ? tagsToSend.trim().split(",").map((t) => t.trim())
                          : [],
                        description: descriptionToSend || undefined,
                        originalUrl: originalUrlToSend || undefined,
                        sourceUrl: sourceUrlToSend || undefined,
                        file: undefined,
                      }
                    : img
                )
              );

              // Call the callback to refresh the gallery after a short delay
              // This ensures Cloudflare has processed the image
              if (onImageUploaded) {
                setTimeout(() => {
                  onImageUploaded();
                }, 500);
              }
            }
          } else {
            const errorMessage = formatUploadErrorMessage(response, result);
            setUploadedImages((prev) =>
              prev.map((img) =>
                img.id === imageId
                  ? { ...img, status: "error", error: errorMessage }
                  : img
              )
            );
          }
        } catch (uploadError) {
          console.error("Upload error:", uploadError);
          setUploadedImages((prev) =>
            prev.map((img) =>
              img.id === imageId ? { ...img, status: "error", error: "Network error" } : img
            )
          );
        }
      }

      setIsUploading(false);

      // Refresh available folders after upload (new folder may have been added by server)
      try {
        await fetchFolders();
      } catch (e) {
        // ignore - non-critical
        console.warn("Failed to refresh folders after upload", e);
      }

      // Clear form inputs after successful upload
      setSelectedFolder("");
      setNewFolder("");
      setTags("found");
      setDescription("");
      setOriginalUrl("");
      setSourceUrl("");
      setSelectedParentId("");
    },
    [resolveFolder, tags, description, originalUrl, sourceUrl, namespace, selectedParentId, onImageUploaded, fetchFolders, formatUploadErrorMessage]
  );

  const uploadRemoteFiles = useCallback(
    async (itemsToUpload: QueuedFile[]) => {
      const validItems = itemsToUpload.filter((item) => Boolean(item.remoteUrl));
      if (validItems.length === 0) return;
      setIsUploading(true);

      const folderToUse = resolveFolder();
      const initialImages: UploadedImage[] = validItems.map((entry) => {
        const originalUrlToSend =
          entry.originalUrl !== undefined ? entry.originalUrl : originalUrl.trim() || entry.remoteUrl || '';
        const sourceUrlToSend =
          entry.sourceUrl !== undefined ? entry.sourceUrl : sourceUrl.trim() || '';
        const folderToSend = entry.folder !== undefined ? entry.folder : folderToUse;
        const tagsToSend = entry.tags !== undefined ? entry.tags : tags;
        const descriptionToSend = entry.description !== undefined ? entry.description : description;

        return {
          id: entry.id,
          url: "",
          filename: entry.filename,
          status: "uploading" as const,
          remoteUrl: entry.remoteUrl,
          folderInput: folderToSend,
          tagsInput: tagsToSend,
          descriptionInput: descriptionToSend,
          originalUrlInput: originalUrlToSend || undefined,
          sourceUrlInput: sourceUrlToSend || undefined,
          parentId: selectedParentId || undefined
        };
      });

      setUploadedImages((prev) => {
        const ids = new Set(initialImages.map((item) => item.id));
        return [...prev.filter((img) => !ids.has(img.id)), ...initialImages];
      });

      const payloadItems = validItems.map((entry) => {
        const originalUrlToSend =
          entry.originalUrl !== undefined ? entry.originalUrl : originalUrl.trim() || entry.remoteUrl || '';
        const sourceUrlToSend =
          entry.sourceUrl !== undefined ? entry.sourceUrl : sourceUrl.trim() || '';
        const folderToSend = entry.folder !== undefined ? entry.folder : folderToUse;
        const tagsToSend = entry.tags !== undefined ? entry.tags : tags;
        const descriptionToSend =
          entry.description !== undefined ? entry.description : description;

        return {
          clientId: entry.id,
          url: entry.remoteUrl,
          folder: folderToSend && folderToSend.trim() ? folderToSend.trim() : undefined,
          tags: tagsToSend && tagsToSend.trim() ? tagsToSend.trim() : undefined,
          description: descriptionToSend && descriptionToSend.trim() ? descriptionToSend.trim() : undefined,
          originalUrl: originalUrlToSend || undefined,
          sourceUrl: sourceUrlToSend || undefined,
          namespace,
          parentId: selectedParentId || undefined
        };
      });

      try {
        const response = await fetch('/api/import/page/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: payloadItems, allowInsecure: pageImportAllowInsecure })
        });
        const data = await response.json();

        if (!response.ok) {
          const message = typeof data?.error === 'string' ? data.error : 'Failed to upload page images';
          setUploadedImages((prev) =>
            prev.map((img) =>
              payloadItems.some((item) => item.clientId === img.id)
                ? { ...img, status: "error", error: message }
                : img
            )
          );
          return;
        }

        const resultList = Array.isArray(data?.results) ? data.results : [];
        const failureList = Array.isArray(data?.failures) ? data.failures : [];
        const successMap = new Map(resultList.map((item: { clientId: string }) => [item.clientId, item]));
        const failureMap = new Map(failureList.map((item: { clientId: string }) => [item.clientId, item]));

        setUploadedImages((prev) =>
          prev.map((img) => {
            const success = successMap.get(img.id);
            if (success) {
              return {
                ...img,
                status: "success",
                url: success.url,
                folder: success.folder,
                tags: success.tags,
                description: success.description,
                originalUrl: success.originalUrl,
                sourceUrl: success.sourceUrl,
                remoteUrl: undefined
              };
            }
            const failure = failureMap.get(img.id);
            if (failure) {
              return {
                ...img,
                status: "error",
                error: failure.error || 'Upload failed'
              };
            }
            if (payloadItems.some((item) => item.clientId === img.id)) {
              return {
                ...img,
                status: "error",
                error: "Upload failed"
              };
            }
            return img;
          })
        );

        if (onImageUploaded && resultList.length > 0) {
          setTimeout(() => {
            onImageUploaded();
          }, 500);
        }
      } catch (error) {
        console.error('Remote upload error:', error);
        setUploadedImages((prev) =>
          prev.map((img) =>
            payloadItems.some((item) => item.clientId === img.id)
              ? { ...img, status: "error", error: "Network error" }
              : img
          )
        );
      } finally {
        setIsUploading(false);
        try {
          await fetchFolders();
        } catch (e) {
          console.warn("Failed to refresh folders after upload", e);
        }
        setSelectedFolder("");
        setNewFolder("");
        setTags("found");
        setDescription("");
        setOriginalUrl("");
        setSourceUrl("");
        setSelectedParentId("");
      }
    },
    [resolveFolder, tags, description, originalUrl, sourceUrl, namespace, selectedParentId, onImageUploaded, fetchFolders]
  );

  // Handle drag and drop - either queue or upload immediately
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const resizedPromises = acceptedFiles.map(async (file) => {
      if (isZipFile(file)) {
        return file;
      }
      return shrinkImageFile(file);
    });
    const resizedFiles = await Promise.all(resizedPromises);
    setQueuedFiles((prev) => [
      ...prev,
      ...resizedFiles.map((file) => {
        const lowerName = file.name.toLowerCase();
        const isSnagx = lowerName.endsWith('.snagx');
        const tagOverride = isZipFile(file) ? 'zip' : isSnagx ? 'snagx' : undefined;
        return {
          id: createQueueId(),
          file,
          filename: file.name,
          tags: tagOverride,
          previewUrl: isImageFile(file) ? URL.createObjectURL(file) : undefined,
          selected: true
        };
      })
    ]);
  }, [createQueueId]);

  // Manual upload button handler
  const handleManualUpload = async () => {
    const selectedItems = queuedFiles.filter((item) => item.selected !== false);
    if (selectedItems.length === 0) return;

    const localItems = selectedItems.filter((item) => Boolean(item.file));
    const remoteItems = selectedItems.filter((item) => Boolean(item.remoteUrl) && !item.file);

    if (localItems.length > 0) {
      const processed: QueuedFile[] = [];
      for (const item of localItems) {
        if (!item.file) continue;
        const processedFile = isZipFile(item.file) ? item.file : await shrinkImageFile(item.file);
        processed.push({
          file: processedFile,
          filename: processedFile.name,
          id: item.id,
          originalUrl: item.originalUrl,
          sourceUrl: item.sourceUrl,
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

    const selectedIds = new Set(selectedItems.map((item) => item.id));
    selectedItems.forEach((item) => {
      if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
    setQueuedFiles((prev) => prev.filter((item) => !selectedIds.has(item.id)));
  };

  // Clear queued files
  const clearQueue = () => {
    queuedFiles.forEach((file) => {
      if (file.previewUrl && file.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(file.previewUrl);
      }
    });
    setQueuedFiles([]);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".jpeg", ".jpg", ".png", ".gif", ".webp"],
      "application/octet-stream": [".snagx"],
      "application/zip": [".zip", ".snagx"],
      "application/x-zip-compressed": [".zip"]
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
          filename: image.filename,
          remoteUrl: image.remoteUrl,
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
    if (!importUrl.trim()) return;
    try {
      setImportLoading(true);
      setImportError(null);
      const response = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl.trim() })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to import image');
      }
      if (!data?.data || !data?.type || !data?.name) {
        throw new Error('Invalid response from import service');
      }
      const file = base64ToFile(String(data.data), String(data.name), String(data.type));
      const sourceUrl = String(data.originalUrl || importUrl.trim());
      const descriptionFromSnagx = typeof data.snagxDescription === 'string' && data.snagxDescription.trim()
        ? data.snagxDescription.trim()
        : '';
      const tagsFromSnagx = data.snagxDescription || data.captureDate ? 'snagx' : undefined;
      setQueuedFiles((prev) => [
        ...prev,
        {
          id: createQueueId(),
          file,
          filename: file.name,
          originalUrl: sourceUrl,
          description: descriptionFromSnagx || undefined,
          captureDate: typeof data.captureDate === 'string' ? data.captureDate : undefined,
          tags: tagsFromSnagx,
          previewUrl: URL.createObjectURL(file),
          selected: true
        }
      ]);
      if (!originalUrl.trim()) {
        setOriginalUrl(sourceUrl);
      }
      setImportUrl('');
    } catch (err) {
      console.error('Import image failed', err);
      setImportError(err instanceof Error ? err.message : 'Failed to import image');
    } finally {
      setImportLoading(false);
    }
  };

  const handleImportFromPage = async () => {
    if (!pageImportUrl.trim()) return;
    try {
      setPageImportLoading(true);
      setPageImportError(null);
      const response = await fetch('/api/import/page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: pageImportUrl.trim(),
          minBytes: 8 * 1024,
          allowInsecure: pageImportAllowInsecure
        })
      });
      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const data = isJson ? await response.json() : await response.text();
      if (!response.ok) {
        if (isJson && typeof data === 'object' && data && 'error' in data) {
          throw new Error((data as { error?: string }).error || 'Failed to inspect page');
        }
        throw new Error('Failed to inspect page');
      }
      if (!isJson || typeof data !== 'object' || !data) {
        throw new Error('Failed to inspect page');
      }
      const images = Array.isArray(data?.images) ? data.images : [];
      if (images.length === 0) {
        // Not a catastrophic error - just inform the user gracefully
        setPageImportError(
          'No images found on that page. The images may be loaded via JavaScript or otherwise obfuscated. ' +
          'Try using your browser\'s dev tools (Network tab) to locate the image URL directly.'
        );
        return;
      }

      const newItems: QueuedFile[] = images.map((image: { url: string; filename?: string; contentLength?: number; contentType?: string }) => ({
        id: createQueueId(),
        filename: image.filename || image.url.split('/').pop() || 'remote-image',
        remoteUrl: image.url,
        previewUrl: image.url,
        sizeBytes: typeof image.contentLength === 'number' ? image.contentLength : undefined,
        contentType: typeof image.contentType === 'string' ? image.contentType : undefined,
        originalUrl: image.url,
        selected: true
      }));

      setQueuedFiles((prev) => {
        const existing = new Set(prev.map((item) => item.remoteUrl || item.originalUrl || item.filename));
        const filtered = newItems.filter((item) => !existing.has(item.remoteUrl || item.originalUrl || item.filename));
        return [...prev, ...filtered];
      });
      if (!sourceUrl.trim()) {
        setSourceUrl(pageImportUrl.trim());
      }
      setPageImportUrl('');
    } catch (err) {
      console.error('Import page failed', err);
      setPageImportError(err instanceof Error ? err.message : 'Failed to import page');
    } finally {
      setPageImportLoading(false);
    }
  };

  const handleCreateAnimation = async () => {
    const selectedItems = queuedFiles.filter((item) => item.selected !== false);
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
      let fileIndex = 0;

      for (const item of selectedItems) {
        if (item.file) {
          formData.append('files', item.file);
          itemsPayload.push({ kind: 'file', fileIndex });
          fileIndex += 1;
        } else if (item.remoteUrl) {
          itemsPayload.push({ kind: 'url', url: item.remoteUrl });
        }
      }

      if (itemsPayload.length < 2) {
        setAnimateError('Select at least two valid images to animate');
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
      if (namespace) {
        formData.append('namespace', namespace);
      }
      if (selectedParentId) {
        formData.append('parentId', selectedParentId);
      }

      const response = await fetch('/api/animate', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create animation');
      }

      setUploadedImages((prev) => [
        ...prev,
        {
          id: data.id,
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

      if (onImageUploaded) {
        setTimeout(() => {
          onImageUploaded();
        }, 500);
      }
    } catch (err) {
      console.error('Create animation failed', err);
      setAnimateError(err instanceof Error ? err.message : 'Failed to create animation');
    } finally {
      setAnimateLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xs font-mono  text-gray-900 mb-4">Upload Images</h2>

      {/* Organization Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
        <div>
          <label htmlFor="folder-select" className="block text-xs fonto-mono text-gray-700 mb-2">
            Folder (Optional)
          </label>
          <div className="flex space-x-2">
            <MonoSelect
              id="folder-select"
              value={selectedFolder}
              onChange={setSelectedFolder}
              options={folderSelectOptions}
              placeholder="Choose folder"
              className="flex-1"
            />
            <input
              type="text"
              placeholder="New folder"
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newFolder.trim()) {
                  const folderName = newFolder.trim().toLowerCase().replace(/\s+/g, "-");
                  if (!folders.includes(folderName)) {
                    setFolders((prev) => [...prev, folderName]);
                    setSelectedFolder(folderName);
                  }
                  setNewFolder("");
                }
              }}
              className="w-32 border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">Press Enter to create new folder</p>
        </div>

        <div>
          <label htmlFor="tags-input" className="block text-xs font-mono font-medium text-gray-700 mb-2">
            Tags (Optional)
          </label>
          <input
            id="tags-input"
            type="text"
            placeholder="logo, header, banner (comma separated)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">Separate tags with commas</p>
        </div>

        <div>
          <label htmlFor="description-input" className="block text-xs font-mono font-medium text-gray-700 mb-2">
            Description (Optional)
          </label>
          <textarea
            id="description-input"
            placeholder="Brief description of the image..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical"
          />
          <p className="text-xs text-gray-500 mt-1">Optional description for the image</p>
        </div>

        <div>
          <label htmlFor="original-url-input" className="block text-xs font-mono font-medium text-gray-700 mb-2">
            Original URL (Optional)
          </label>
          <input
            id="original-url-input"
            type="url"
            placeholder="https://example.com/original-image.jpg"
            value={originalUrl}
            onChange={(e) => setOriginalUrl(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">Asset URL used for duplicate detection</p>
        </div>
        <div>
          <label htmlFor="source-url-input" className="block text-xs font-mono font-medium text-gray-700 mb-2">
            Source URL (Optional)
          </label>
          <input
            id="source-url-input"
            type="url"
            placeholder="https://example.com/page-or-collection"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">Where the image was found (page or site)</p>
        </div>
      </div>
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
      <div
        {...getRootProps()}
        className={clsx(
          "border-2 border-dashed rounded-lg p-2 text-center transition-colors cursor-pointer",
          isDragActive ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-gray-400"
        )}
      >
        <input {...getInputProps()} />
        <Upload className="mx-auto h-8 w-8 text-gray-400 mb-4" />
        <p className="text-xs font-mono font-medium text-gray-900 mb-2">
          {isUploading ? "Uploading..." : isDragActive ? "Drop images or a .zip here" : "Drag & drop images or a .zip here"}
        </p>
        <p className="text-xs font-mono text-gray-500">
          {isUploading ? "Please wait while your images are being uploaded" : "or click to select files (.zip supported)"}
        </p>
      </div>

      <div className="mt-4 p-4 border border-dashed rounded-lg bg-white/60">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-mono font-medium text-gray-900">Import image from URL</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="url"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://example.com/asset.jpg"
            className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleImportFromUrl}
            disabled={importLoading || !importUrl.trim()}
            className="px-4 py-2 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {importLoading ? 'Fetching…' : 'Fetch image'}
          </button>
        </div>
        {importError && <p className="text-xs text-red-600 mt-1">{importError}</p>}
        <p className="text-[11px] text-gray-500 mt-1">
          We’ll download the image, add it to your queue, and prefill the “Original URL” field so you can finish tagging before uploading.
        </p>
      </div>

      <div className="mt-4 p-4 border border-dashed rounded-lg bg-white/60">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-mono font-medium text-gray-900">Import images from page URL</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="url"
            value={pageImportUrl}
            onChange={(e) => setPageImportUrl(e.target.value)}
            placeholder="https://example.com/gallery"
            className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleImportFromPage}
            disabled={pageImportLoading || !pageImportUrl.trim()}
            className="px-4 py-2 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {pageImportLoading ? 'Scanning…' : 'Scan page'}
          </button>
        </div>
        <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-600">
          <input
            type="checkbox"
            checked={pageImportAllowInsecure}
            onChange={(e) => setPageImportAllowInsecure(e.target.checked)}
            className="h-3 w-3"
          />
          Allow insecure TLS (expired/self-signed certs). Requires IMPORT_ALLOW_INSECURE_TLS=true on the server.
        </label>
        {pageImportError && <p className="text-xs text-red-600 mt-1">{pageImportError}</p>}
        <p className="text-[11px] text-gray-500 mt-1">
          We’ll scan the page for image URLs, show thumbnails in your queue, and you can select what to ingest before uploading.
        </p>
      </div>

      {/* Queued Files Section */}
      {queuedFiles.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-mono font-medium text-gray-900">Queued Files ({queuedFiles.length})</p>
            <div className="flex space-x-2">
              <button
                onClick={clearQueue}
                className="px-3 py-1 text-xs text-gray-600 hover:text-red-600 border border-gray-300 rounded-md hover:border-red-300"
                disabled={isUploading}
              >
                Clear Queue
              </button>
              <button
                onClick={handleManualUpload}
                disabled={isUploading || selectedQueuedCount === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <Upload className="h-4 w-4" />
                <span>
                  Upload {selectedQueuedCount} File{selectedQueuedCount !== 1 ? "s" : ""}
                </span>
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3 border border-blue-200 rounded-lg p-3 bg-white/70">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-[11px] text-gray-600 flex items-center gap-2">
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
                  className="w-20 border border-gray-300 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </label>
              <label className="text-[11px] text-gray-600 flex items-center gap-2">
                Loop
                <input
                  type="checkbox"
                  checked={animateLoop}
                  onChange={(e) => setAnimateLoop(e.target.checked)}
                  className="h-3 w-3"
                />
              </label>
              <label className="text-[11px] text-gray-600 flex items-center gap-2">
                Output name
                <input
                  type="text"
                  value={animateFilename}
                  onChange={(e) => setAnimateFilename(e.target.value)}
                  placeholder="animated-webp"
                  className="w-40 border border-gray-300 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCreateAnimation}
                disabled={animateLoading || selectedQueuedCount < 2}
                className="px-3 py-2 text-xs bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {animateLoading ? 'Building…' : 'Create animated WebP'}
              </button>
              {animateError && <p className="text-[11px] text-red-600">{animateError}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {queuedFiles.map((item) => {
              const hasCustomFolder = item.folder !== undefined;
              const hasCustomTags = item.tags !== undefined;
              const hasCustomDescription = item.description !== undefined;
              const hasCustomOriginalUrl = item.originalUrl !== undefined;
              const hasCustomSourceUrl = item.sourceUrl !== undefined;
              const previewUrl = item.previewUrl || item.remoteUrl;
              const previewFailed = Boolean(previewFailures[item.id]);
              const displaySizeBytes = item.file?.size ?? item.sizeBytes;
              const previewFolder = selectedFolder.trim()
                ? selectedFolder.trim()
                : newFolder.trim()
                  ? newFolder.trim().toLowerCase().replace(/\s+/g, "-")
                  : "";
              const effectiveFolder = hasCustomFolder ? item.folder || "" : previewFolder;
              const effectiveTags = hasCustomTags ? item.tags || "" : tags;
              const effectiveDescription = hasCustomDescription ? item.description || "" : description;
              const effectiveOriginalUrl = hasCustomOriginalUrl ? item.originalUrl || "" : originalUrl;
              const effectiveSourceUrl = hasCustomSourceUrl ? item.sourceUrl || "" : sourceUrl;
              const metadataExpanded = Boolean(expandedQueueMetadata[item.id]);
              const metadataBytes = buildMetadataEstimate(item, {
                folder: effectiveFolder,
                tags: effectiveTags,
                description: effectiveDescription,
                originalUrl: effectiveOriginalUrl,
                sourceUrl: effectiveSourceUrl
              });
              const metadataOverLimit = metadataBytes >= 1024;

              return (
              <div key={item.id} className="p-3 bg-blue-50 border border-blue-200 rounded-lg w-full">
                <div className="flex items-start gap-3">
                  {previewUrl && !previewFailed ? (
                    <img
                      src={previewUrl}
                      alt={item.filename}
                      className="h-14 w-14 rounded border border-blue-200 object-cover bg-white"
                      onError={() => setPreviewFailures((prev) => ({ ...prev, [item.id]: true }))}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="h-14 w-14 rounded border border-blue-200 bg-white flex items-center justify-center text-[10px] text-gray-400">
                      {item.file ? "Local file" : "No preview"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono font-medium text-gray-900 truncate">{item.filename}</p>
                    <p className="text-xs text-gray-500">
                      {typeof displaySizeBytes === 'number'
                        ? `${(displaySizeBytes / 1024 / 1024).toFixed(2)} MB`
                        : "Size unknown"}
                    </p>
                    {effectiveOriginalUrl && (
                      <p className="text-[11px] text-gray-600 truncate" title={effectiveOriginalUrl}>
                        🔗 {effectiveOriginalUrl}
                      </p>
                    )}
                  </div>
                  <label className="flex items-center gap-1 text-[11px] text-gray-600">
                    <input
                      type="checkbox"
                      checked={item.selected !== false}
                      onChange={(e) => updateQueuedFile(item.id, { selected: e.target.checked })}
                      className="h-3 w-3"
                      disabled={isUploading}
                    />
                    Include
                  </label>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedQueueMetadata((prev) => ({
                        ...prev,
                        [item.id]: !metadataExpanded
                      }))
                    }
                    className="text-[11px] text-blue-600 hover:text-blue-800"
                  >
                    {metadataExpanded ? "Hide metadata" : "Show metadata"}
                  </button>
                  <button
                    onClick={() => {
                      if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
                        URL.revokeObjectURL(item.previewUrl);
                      }
                      setQueuedFiles((prev) => prev.filter((entry) => entry.id !== item.id));
                    }}
                    className="text-xs text-red-600 hover:text-red-800"
                    disabled={isUploading}
                  >
                    Remove
                  </button>
                </div>
                {metadataExpanded && (
                  <div className="mt-2 border-t border-blue-200 pt-2 space-y-2">
                    <div className="space-y-1">
                      <p className="text-[11px] text-gray-600 truncate" title={effectiveFolder || "—"}>
                        Folder: {effectiveFolder || "—"}
                      </p>
                      <p className="text-[11px] text-gray-600 truncate" title={effectiveTags || "—"}>
                        Tags: {effectiveTags || "—"}
                      </p>
                      <p className="text-[11px] text-gray-600 truncate" title={effectiveDescription || "—"}>
                        Description: {effectiveDescription || "—"}
                      </p>
                      <p className="text-[11px] text-gray-600 truncate" title={effectiveOriginalUrl || "—"}>
                        Original URL: {effectiveOriginalUrl || "—"}
                      </p>
                      <p className="text-[11px] text-gray-600 truncate" title={effectiveSourceUrl || "—"}>
                        Source URL: {effectiveSourceUrl || "—"}
                      </p>
                      <p className="text-[11px] text-gray-600 truncate" title={namespace || "—"}>
                        Namespace: {namespace || "—"}
                      </p>
                      {item.captureDate && (
                        <p className="text-[11px] text-gray-600 truncate" title={item.captureDate}>
                          Capture date: {item.captureDate}
                        </p>
                      )}
                      {selectedParentId && (
                        <p className="text-[11px] text-gray-600 truncate" title={selectedParentId}>
                          Parent ID: {selectedParentId}
                        </p>
                      )}
                      <p className={clsx("text-[11px]", metadataOverLimit ? "text-red-600" : "text-gray-600")}>
                        Estimated metadata size: {metadataBytes} bytes
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Estimate excludes content hash and EXIF fields added server-side.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-[11px] text-gray-700">
                        Override folder
                        <input
                          type="text"
                          value={item.folder ?? ""}
                          onChange={(e) => updateQueuedFile(item.id, { folder: e.target.value })}
                          placeholder={previewFolder || "No folder"}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <button
                          type="button"
                          onClick={() => updateQueuedFile(item.id, { folder: undefined })}
                          className="mt-1 text-[10px] text-blue-600 hover:text-blue-800"
                        >
                          Use global folder
                        </button>
                      </label>
                      <label className="block text-[11px] text-gray-700">
                        Override tags
                        <input
                          type="text"
                          value={item.tags ?? ""}
                          onChange={(e) => updateQueuedFile(item.id, { tags: e.target.value })}
                          placeholder={tags || "No tags"}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <button
                          type="button"
                          onClick={() => updateQueuedFile(item.id, { tags: undefined })}
                          className="mt-1 text-[10px] text-blue-600 hover:text-blue-800"
                        >
                          Use global tags
                        </button>
                      </label>
                      <label className="block text-[11px] text-gray-700">
                        Override description
                        <input
                          type="text"
                          value={item.description ?? ""}
                          onChange={(e) => updateQueuedFile(item.id, { description: e.target.value })}
                          placeholder={description || "No description"}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <button
                          type="button"
                          onClick={() => updateQueuedFile(item.id, { description: undefined })}
                          className="mt-1 text-[10px] text-blue-600 hover:text-blue-800"
                        >
                          Use global description
                        </button>
                      </label>
                      <label className="block text-[11px] text-gray-700">
                        Override original URL
                        <input
                          type="text"
                          value={item.originalUrl ?? ""}
                          onChange={(e) => updateQueuedFile(item.id, { originalUrl: e.target.value })}
                          placeholder={originalUrl || "No original URL"}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <button
                          type="button"
                          onClick={() => updateQueuedFile(item.id, { originalUrl: undefined })}
                          className="mt-1 text-[10px] text-blue-600 hover:text-blue-800"
                        >
                          Use global original URL
                        </button>
                      </label>
                      <label className="block text-[11px] text-gray-700">
                        Override source URL
                        <input
                          type="text"
                          value={item.sourceUrl ?? ""}
                          onChange={(e) => updateQueuedFile(item.id, { sourceUrl: e.target.value })}
                          placeholder={sourceUrl || "No source URL"}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <button
                          type="button"
                          onClick={() => updateQueuedFile(item.id, { sourceUrl: undefined })}
                          className="mt-1 text-[10px] text-blue-600 hover:text-blue-800"
                        >
                          Use global source URL
                        </button>
                      </label>
                      <p className="text-[10px] text-gray-500">
                        Leave a field blank to omit it for this file.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )})}
          </div>
        </div>
      )}

      {uploadedImages.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Uploaded Images ({uploadedImages.length})</h3>
          <div className="space-y-3">
            {uploadedImages.map((image) => (
              <div key={image.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="flex-shrink-0">
                    {image.status === "uploading" && <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>}
                    {image.status === "success" && <CheckCircle className="h-5 w-5 text-green-500" />}
                    {image.status === "error" && <AlertCircle className="h-5 w-5 text-red-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono font-medium text-gray-900 truncate">{image.filename}</p>
                    {image.folder && <p className="text-xs text-gray-500">📁 {image.folder}</p>}
                    {image.description && <p className="text-xs text-gray-500">📝 {image.description}</p>}
                    {image.originalUrl && (
                      <p className="text-xs text-gray-500">🔗 <a href={image.originalUrl} target="_blank" rel="noreferrer" className="underline">Original</a></p>
                    )}
                    {image.sourceUrl && (
                      <p className="text-xs text-gray-500">🔗 <a href={image.sourceUrl} target="_blank" rel="noreferrer" className="underline">Source</a></p>
                    )}
                    {image.tags && image.tags.length > 0 && <p className="text-xs text-gray-500">🏷️ {image.tags.join(", ")}</p>}
                    {image.status === "success" && image.url && (
                      <button onClick={() => copyToClipboard(image.url)} className="text-xs text-blue-600 hover:text-blue-800 truncate block max-w-xs">
                        {image.url}
                      </button>
                    )}
                    {image.status === "error" && (
                      <div className="space-y-1">
                        <p className="text-xs text-red-600">{image.error}</p>
                        <button
                          type="button"
                          onClick={() => handleRetryUpload(image)}
                          disabled={!image.file || isUploading}
                          className={clsx(
                            "text-[11px] text-blue-600 hover:text-blue-800",
                            (!image.file || isUploading) && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          Retry upload
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={() => removeImage(image.id)} className="flex-shrink-0 text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
 
