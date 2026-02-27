'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X, CheckCircle, AlertCircle, Loader2, Zap, CloudUpload, Cpu, Sparkles } from "lucide-react";
import clsx from "clsx";
import JSZip from "jszip";
import MonoSelect from "./MonoSelect";
import { normalizeOriginalUrl } from "@/utils/urlNormalization";
import { setEmbeddingPendingEntry } from "@/utils/embeddingPending";
import { sanitizeFilename, needsSanitization, MAX_FILENAME_LENGTH } from "@/utils/filename";

interface UploadedImage {
  id: string;
  assetType: "image" | "video";
  url: string;
  filename: string;
  status: "uploading" | "success" | "error";
  embeddingStatus?: "queued" | "embedding" | "success" | "error";
  embeddingError?: string;
  embeddingRequested?: { clip: boolean; color: boolean };
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
  assetType?: "image" | "video";
  file?: File;
  filename: string;
  remoteUrl?: string;
  previewUrl?: string;
  posterUrl?: string;
  isBlobSource?: boolean;
  sizeBytes?: number;
  contentType?: string;
  selected?: boolean;
  originalUrl?: string;
  sourceUrl?: string;
  sourcePath?: string;
  folder?: string;
  tags?: string;
  description?: string;
  captureDate?: string;
  groupId?: string;
  groupIndex?: number;
  processingNote?: string;
}

interface GalleryImageSummary {
  id: string;
  folder?: string | null;
  filename?: string;
  parentId?: string | null;
}

/**
 * Kinetic Activity Indicator
 * Shows prominent, animated feedback during bulk uploads and embedding generation
 */
interface ActivityStats {
  total: number;
  uploading: number;
  uploaded: number;
  embedding: number;
  embedded: number;
  errors: number;
  embeddingQueue: number;
}

function ActivityIndicator({ stats, isActive }: { stats: ActivityStats; isActive: boolean }) {
  const [dots, setDots] = useState(0);
  const [pulsePhase, setPulsePhase] = useState(0);
  
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      setDots(d => (d + 1) % 4);
      setPulsePhase(p => (p + 1) % 3);
    }, 400);
    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive && stats.total === 0) return null;

  const uploadProgress = stats.total > 0 ? (stats.uploaded / stats.total) * 100 : 0;
  const embeddingProgress = stats.embedded > 0 || stats.embedding > 0 || stats.embeddingQueue > 0
    ? (stats.embedded / (stats.embedded + stats.embedding + stats.embeddingQueue)) * 100
    : 0;
  
  const totalWork = stats.uploading + stats.embedding + stats.embeddingQueue;
  const isWorking = totalWork > 0;

  // Calculate what phase of work we're in
  const phase = stats.uploading > 0 ? 'upload' : stats.embedding > 0 || stats.embeddingQueue > 0 ? 'embed' : 'complete';
  
  return (
    <div className={clsx(
      "rounded-xl border-2 p-4 mb-4 transition-all duration-300",
      isWorking 
        ? "border-blue-400 bg-gradient-to-r from-blue-50 via-purple-50 to-blue-50 shadow-lg shadow-blue-200/50" 
        : stats.errors > 0 
          ? "border-amber-300 bg-amber-50"
          : "border-emerald-300 bg-emerald-50"
    )}>
      {/* Main activity header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {/* Animated icon */}
          <div className={clsx(
            "relative w-10 h-10 rounded-full flex items-center justify-center",
            isWorking ? "bg-blue-500" : stats.errors > 0 ? "bg-amber-500" : "bg-emerald-500"
          )}>
            {isWorking ? (
              <>
                <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-40" />
                <div className="absolute inset-0 rounded-full bg-blue-300 animate-pulse opacity-30" />
                {phase === 'upload' ? (
                  <CloudUpload className="w-5 h-5 text-white animate-bounce" />
                ) : (
                  <Cpu className="w-5 h-5 text-white animate-spin" style={{ animationDuration: '2s' }} />
                )}
              </>
            ) : stats.errors > 0 ? (
              <AlertCircle className="w-5 h-5 text-white" />
            ) : (
              <Sparkles className="w-5 h-5 text-white" />
            )}
          </div>
          
          {/* Status text */}
          <div>
            <h3 className="text-sm font-bold text-gray-900">
              {phase === 'upload' && `Uploading${'.'.repeat(dots)}`}
              {phase === 'embed' && `Generating embeddings${'.'.repeat(dots)}`}
              {phase === 'complete' && (stats.errors > 0 ? 'Completed with errors' : 'All done!')}
            </h3>
            <p className="text-xs text-gray-600">
              {isWorking ? (
                <>
                  {stats.uploading > 0 && `${stats.uploading} uploading`}
                  {stats.uploading > 0 && (stats.embedding > 0 || stats.embeddingQueue > 0) && ' · '}
                  {(stats.embedding > 0 || stats.embeddingQueue > 0) && `${stats.embedding + stats.embeddingQueue} in embedding pipeline`}
                </>
              ) : (
                `${stats.uploaded} images processed`
              )}
            </p>
          </div>
        </div>
        
        {/* Quick stats badges */}
        <div className="flex items-center gap-2">
          {stats.uploaded > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
              <CheckCircle className="w-3 h-3" />
              {stats.uploaded}
            </span>
          )}
          {stats.errors > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-medium">
              <AlertCircle className="w-3 h-3" />
              {stats.errors}
            </span>
          )}
        </div>
      </div>

      {/* Progress bars */}
      {(stats.uploading > 0 || stats.uploaded > 0) && (
        <div className="space-y-2">
          {/* Upload progress */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-gray-600">
              <span className="flex items-center gap-1">
                <CloudUpload className="w-3 h-3" />
                Upload progress
              </span>
              <span>{stats.uploaded} / {stats.total}</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className={clsx(
                  "h-full rounded-full transition-all duration-300",
                  stats.uploading > 0 
                    ? "bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500 bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite]"
                    : "bg-emerald-500"
                )}
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>

          {/* Embedding progress */}
          {(stats.embedding > 0 || stats.embeddingQueue > 0 || stats.embedded > 0) && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-gray-600">
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  Embeddings
                </span>
                <span>{stats.embedded} / {stats.embedded + stats.embedding + stats.embeddingQueue}</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className={clsx(
                    "h-full rounded-full transition-all duration-300",
                    stats.embedding > 0 
                      ? "bg-gradient-to-r from-purple-500 via-purple-400 to-purple-500 bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite]"
                      : "bg-emerald-500"
                  )}
                  style={{ width: `${embeddingProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live file ticker during active upload */}
      {isWorking && stats.uploading > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="font-mono">Processing files...</span>
          </div>
        </div>
      )}
    </div>
  );
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
const PAGE_IMPORT_PREVIEW_LIMIT = 60;
const VIDEO_REMOTE_UPLOAD_CONCURRENCY = 2;
const QUEUE_RENDER_LIMIT = 250;
const STREAM_QUEUE_FLUSH_BATCH_SIZE = 24;
const STREAM_PROGRESS_UPDATE_INTERVAL_MS = 200;
const NAMESPACE_REQUIRED_UPLOAD_ERROR = 'Select a specific namespace before uploading. "All namespaces" and "(no namespace)" are browse-only for uploads.';

const isZipFile = (file: File) => (
  file.type === 'application/zip' ||
  file.type === 'application/x-zip-compressed' ||
  file.name.toLowerCase().endsWith('.zip')
);

const isKeynoteFile = (file: File) => file.name.toLowerCase().endsWith('.key');

const isArchiveFile = (file: File) => isZipFile(file) || isKeynoteFile(file);

const isImageFile = (file: File) => file.type.startsWith('image/');
const isVideoFile = (file: File) => file.type.startsWith('video/');
const inferAssetTypeFromUrl = (value?: string): "image" | "video" => {
  if (!value) return 'image';
  if (/^blob:/i.test(value)) return 'video';
  return /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|$)/i.test(value) ? 'video' : 'image';
};
const inferAssetTypeFromFile = (file: File): "image" | "video" => (isVideoFile(file) ? 'video' : 'image');
const KEYNOTE_IMAGE_EXTENSIONS = ['.jpeg', '.jpg', '.png', '.gif', '.webp', '.svg'];
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const isSupportedImageName = (name: string) => {
  const lower = name.toLowerCase();
  return KEYNOTE_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

const normalizeEntryName = (entryName: string) => {
  const parts = entryName.split(/[\\/]/);
  return parts[parts.length - 1] || entryName;
};

const getMimeTypeFromFilename = (filename: string) => {
  const lower = filename.toLowerCase();
  const match = Object.keys(MIME_BY_EXTENSION).find((ext) => lower.endsWith(ext));
  return match ? MIME_BY_EXTENSION[match] : undefined;
};

const getFileSourcePath = (file: File) => {
  const relative = 'webkitRelativePath' in file ? (file as File & { webkitRelativePath?: string }).webkitRelativePath : undefined;
  return relative && relative.trim() ? relative : undefined;
};

const formatBytesMB = (bytes?: number) => {
  if (typeof bytes !== 'number') return 'Size unknown';
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const parseTagInput = (value?: string): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
};

const mergeTagInputs = (baseTags?: string, extraTags?: string): string => {
  const merged = new Map<string, string>();
  parseTagInput(baseTags).forEach((tag) => merged.set(tag.toLowerCase(), tag));
  parseTagInput(extraTags).forEach((tag) => merged.set(tag.toLowerCase(), tag));
  return Array.from(merged.values()).join(', ');
};

const resolveTagInput = (globalTags: string, itemTags?: string): string => {
  if (itemTags === undefined) {
    return globalTags;
  }
  if (!itemTags.trim()) {
    return '';
  }
  return mergeTagInputs(globalTags, itemTags);
};

const runWithConcurrency = async <T,>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> => {
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  let index = 0;

  const runners = Array.from({ length: Math.min(safeConcurrency, items.length) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await worker(items[current]);
    }
  });

  await Promise.all(runners);
};

const renderBitmapToBlob = (bitmap: ImageBitmap, width: number, height: number, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resolve(null);
      return;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });

const reduceImageFileToLimit = async (file: File, maxBytes: number) => {
  const bitmap = await createImageBitmap(file);
  const startWidth = bitmap.width;
  const startHeight = bitmap.height;
  const candidates = ['image/webp', 'image/jpeg'];
  const qualityByType: Record<string, number> = { 'image/webp': 0.85, 'image/jpeg': 0.85 };
  let bestBlob: Blob | null = null;
  let bestType = 'image/jpeg';

  for (const type of candidates) {
    const blob = await renderBitmapToBlob(bitmap, startWidth, startHeight, type, qualityByType[type]);
    if (!blob) continue;
    if (!bestBlob || blob.size < bestBlob.size) {
      bestBlob = blob;
      bestType = type;
    }
    if (blob.size <= maxBytes) {
      bitmap.close();
      return {
        blob,
        type,
        width: startWidth,
        height: startHeight,
        note: `Converted to ${type === 'image/webp' ? 'WebP' : 'JPEG'}`
      };
    }
  }

  let width = startWidth;
  let height = startHeight;
  let resizedBlob = bestBlob;
  let attempts = 0;
  const minDimension = 320;
  const targetType = bestBlob ? bestType : 'image/jpeg';
  const targetQuality = targetType === 'image/webp' ? 0.82 : 0.8;

  while (
    resizedBlob &&
    resizedBlob.size > maxBytes &&
    attempts < 8 &&
    Math.max(width, height) > minDimension
  ) {
    width = Math.max(minDimension, Math.round(width * 0.85));
    height = Math.max(minDimension, Math.round(height * 0.85));
    resizedBlob = await renderBitmapToBlob(bitmap, width, height, targetType, targetQuality);
    attempts += 1;
  }

  bitmap.close();

  if (resizedBlob && resizedBlob.size <= maxBytes) {
    return {
      blob: resizedBlob,
      type: targetType,
      width,
      height,
      note: `Converted to ${targetType === 'image/webp' ? 'WebP' : 'JPEG'} and resized`
    };
  }

  return null;
};

const extractKeynoteImages = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .filter((entry) => {
      const normalized = entry.name.replace(/\\/g, '/').toLowerCase();
      return (normalized.startsWith('data/') || normalized.includes('/data/')) && isSupportedImageName(normalized);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const extracted: Array<{ filename: string; file: File }> = [];
  for (const entry of entries) {
    const blob = await entry.async('blob');
    const filename = normalizeEntryName(entry.name);
    const blobType = (blob as Blob).type || '';
    const fileType = blobType || getMimeTypeFromFilename(filename) || 'application/octet-stream';
    extracted.push({
      filename,
      file: new File([blob], filename, { type: fileType })
    });
  }

  return extracted;
};

const extractZipImages = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .filter((entry) => isSupportedImageName(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const extracted: Array<{ filename: string; file: File }> = [];
  for (const entry of entries) {
    const blob = await entry.async('blob');
    const filename = normalizeEntryName(entry.name);
    const blobType = (blob as Blob).type || '';
    const fileType = blobType || getMimeTypeFromFilename(filename) || 'application/octet-stream';
    extracted.push({
      filename,
      file: new File([blob], filename, { type: fileType })
    });
  }

  return extracted;
};

export default function ImageUploader({ onImageUploaded, namespace }: ImageUploaderProps) {
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [embedClipOnUpload, setEmbedClipOnUpload] = useState(true);
  const [embedColorOnUpload, setEmbedColorOnUpload] = useState(true);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [newFolder, setNewFolder] = useState<string>("");
  const [tags, setTags] = useState<string>("found");
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
  const [pageImportScrollMode, setPageImportScrollMode] = useState(true);
  const [pageImportAutoScroll, setPageImportAutoScroll] = useState(true);
  const [pageImportMaxScrolls, setPageImportMaxScrolls] = useState('10');
  const [pageImportScrollDelayMs, setPageImportScrollDelayMs] = useState('1500');
  const [pageImportMaxPages, setPageImportMaxPages] = useState('1');
  const [pageImportCookieHeader, setPageImportCookieHeader] = useState('');
  const [pageImportProgress, setPageImportProgress] = useState<{
    message: string;
    scrollCount: number;
    imageCount: number;
    pageNum?: number;
  } | null>(null);
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
  const [embeddingQueueDepth, setEmbeddingQueueDepth] = useState(0);
  const [activeUploadOps, setActiveUploadOps] = useState(0);
  const embeddingQueueRef = useRef<Array<{ id: string; clip: boolean; color: boolean }>>([]);
  const embeddingWorkerRef = useRef(false);
  const activeUploadOpsRef = useRef(0);

  const updateEmbeddingPending = useCallback((
    id: string,
    status?: 'queued' | 'embedding' | 'error',
    clip?: boolean,
    color?: boolean,
    error?: string
  ) => {
    if (!status || clip === undefined || color === undefined) {
      setEmbeddingPendingEntry(id, undefined);
      return;
    }
    setEmbeddingPendingEntry(id, {
      status,
      clip,
      color,
      error,
      updatedAt: new Date().toISOString()
    });
  }, []);

  const beginUploadActivity = useCallback(() => {
    activeUploadOpsRef.current += 1;
    setActiveUploadOps(activeUploadOpsRef.current);
    setIsUploading(true);
  }, []);

  const endUploadActivity = useCallback(() => {
    activeUploadOpsRef.current = Math.max(0, activeUploadOpsRef.current - 1);
    setActiveUploadOps(activeUploadOpsRef.current);
    setIsUploading(activeUploadOpsRef.current > 0);
  }, []);

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
    if (target.file.size <= MAX_BYTES) return;

    setReducingQueueItems((prev) => ({ ...prev, [id]: true }));
    try {
      const reduced = await reduceImageFileToLimit(target.file, MAX_BYTES);
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

  const processEmbeddingQueue = useCallback(async () => {
    if (embeddingWorkerRef.current) return;
    if (activeUploadOpsRef.current > 0) return;
    embeddingWorkerRef.current = true;

    while (embeddingQueueRef.current.length > 0) {
      if (activeUploadOpsRef.current > 0) {
        break;
      }
      const job = embeddingQueueRef.current.shift();
      setEmbeddingQueueDepth(embeddingQueueRef.current.length);
      if (!job) continue;

      updateEmbeddingPending(job.id, 'embedding', job.clip, job.color);
      setUploadedImages((prev) =>
        prev.map((img) =>
          img.id === job.id
            ? {
                ...img,
                embeddingStatus: "embedding",
                embeddingError: undefined,
                embeddingRequested: { clip: job.clip, color: job.color }
              }
            : img
        )
      );

      try {
        const response = await fetch(`/api/images/${job.id}/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clip: job.clip, color: job.color })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const message = typeof data?.error === 'string' ? data.error : 'Embedding failed';
          throw new Error(message);
        }

        updateEmbeddingPending(job.id, undefined);
        setUploadedImages((prev) =>
          prev.map((img) =>
            img.id === job.id
              ? { ...img, embeddingStatus: "success", embeddingError: undefined }
              : img
          )
        );
        if (onImageUploaded) {
          onImageUploaded();
        }
      } catch (error) {
        updateEmbeddingPending(
          job.id,
          'error',
          job.clip,
          job.color,
          error instanceof Error ? error.message : 'Embedding failed'
        );
        setUploadedImages((prev) =>
          prev.map((img) =>
            img.id === job.id
              ? {
                  ...img,
                  embeddingStatus: "error",
                  embeddingError: error instanceof Error ? error.message : 'Embedding failed'
                }
              : img
          )
        );
      }
    }

    embeddingWorkerRef.current = false;
  }, [onImageUploaded, updateEmbeddingPending]);

  const enqueueEmbedding = useCallback((imageId: string, clip: boolean, color: boolean) => {
    if (!clip && !color) return;
    embeddingQueueRef.current.push({ id: imageId, clip, color });
    setEmbeddingQueueDepth(embeddingQueueRef.current.length);
    updateEmbeddingPending(imageId, 'queued', clip, color);
    setUploadedImages((prev) =>
      prev.map((img) =>
        img.id === imageId
          ? {
              ...img,
              embeddingStatus: "queued",
              embeddingError: undefined,
              embeddingRequested: { clip, color }
            }
          : img
      )
    );
    void processEmbeddingQueue();
  }, [processEmbeddingQueue, updateEmbeddingPending]);

  useEffect(() => {
    if (activeUploadOps > 0) return;
    if (embeddingQueueRef.current.length === 0) return;
    void processEmbeddingQueue();
  }, [activeUploadOps, processEmbeddingQueue]);

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
  const visibleQueuedFiles = useMemo(
    () => (showAllQueuedItems ? queuedFiles : queuedFiles.slice(0, QUEUE_RENDER_LIMIT)),
    [queuedFiles, showAllQueuedItems]
  );

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
  }, []);

  const uploadFiles = useCallback(
    async (filesToUpload: QueuedFile[]) => {
      if (!uploadNamespace) {
        markNamespaceUploadFailures(filesToUpload);
        return;
      }

      beginUploadActivity();

      const shouldEmbedClip = embedClipOnUpload;
      const shouldEmbedColor = embedColorOnUpload;
      const shouldEmbedAnything = shouldEmbedClip || shouldEmbedColor;

      const folderToUse = resolveFolder();
      
      // Rate limiting configuration
      const UPLOAD_DELAY_MS = 200; // Delay between uploads to avoid rate limits
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 2000; // Wait 2s before retry
      const RATE_LIMIT_DELAY_MS = 5000; // Wait 5s if rate limited

      // Helper to delay execution
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      // Helper to upload with retry logic
      const uploadWithRetry = async (
        formData: FormData, 
        retryCount = 0
      ): Promise<{ response: Response; result: unknown }> => {
        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        const result = await response.json();
        
        // Check for rate limiting or server errors that warrant retry
        if (!response.ok && retryCount < MAX_RETRIES) {
          const errorMessage = typeof result?.error === 'string' ? result.error.toLowerCase() : '';
          const isRateLimit = response.status === 429 || errorMessage.includes('rate limit');
          const isServerError = response.status >= 500;
          const isTimeout = errorMessage.includes('timeout');
          
          if (isRateLimit || isServerError || isTimeout) {
            const waitTime = isRateLimit ? RATE_LIMIT_DELAY_MS : RETRY_DELAY_MS;
            await delay(waitTime);
            return uploadWithRetry(formData, retryCount + 1);
          }
        }
        
        return { response, result };
      };

      const uploadVideoWithRetry = async (
        formData: FormData,
        retryCount = 0
      ): Promise<{ response: Response; result: unknown }> => {
        const response = await fetch('/api/import/page/upload-video', {
          method: 'POST',
          body: formData,
        });

        const result = await response.json();
        if (!response.ok && retryCount < MAX_RETRIES && response.status >= 500) {
          await delay(RETRY_DELAY_MS);
          return uploadVideoWithRetry(formData, retryCount + 1);
        }
        return { response, result };
      };

      // Create initial entries for all files
      const initialImages: UploadedImage[] = filesToUpload.map((entry) => {
        const originalUrlToSend = omitOriginalUrl
          ? ''
          : entry.originalUrl !== undefined
            ? entry.originalUrl
            : originalUrl.trim() || '';
        const sourceUrlToSend =
          entry.sourceUrl !== undefined ? entry.sourceUrl : sourceUrl.trim() || '';
        const folderToSend = entry.folder !== undefined ? entry.folder : folderToUse;
        const tagsToSend = resolveTagInput(tags, entry.tags);
        const descriptionToSend = entry.description !== undefined ? entry.description : description;

        return {
          id: entry.id,
          assetType: entry.assetType ?? (entry.file ? inferAssetTypeFromFile(entry.file) : 'image'),
          url: "",
          filename: entry.filename,
          status: "uploading" as const,
          file: entry.file,
          folderInput: folderToSend,
          tagsInput: tagsToSend,
          descriptionInput: descriptionToSend,
          originalUrlInput: originalUrlToSend || undefined,
          sourceUrlInput: sourceUrlToSend || undefined,
          parentId: entry.groupId ? undefined : (selectedParentId || undefined)
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

      // Upload each file
      for (let i = 0; i < filesToUpload.length; i++) {
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
          id: queuedId
        } = filesToUpload[i];
        const imageId = queuedId;
        const originalUrlToSend = omitOriginalUrl
          ? ''
          : queuedOriginalUrl !== undefined
            ? queuedOriginalUrl
            : originalUrl.trim() || '';
        const sourceUrlToSend =
          queuedSourceUrl !== undefined ? queuedSourceUrl : sourceUrl.trim() || '';
        const sourcePathToSend = queuedSourcePath && queuedSourcePath.trim() ? queuedSourcePath.trim() : '';
        const folderToSend = queuedFolder !== undefined ? queuedFolder : folderToUse;
        const tagsToSend = resolveTagInput(tags, queuedTags);
        const descriptionToSend =
          queuedDescription !== undefined ? queuedDescription : description;
        const displayNameToSend = queuedFilename?.trim() || file?.name || '';
        const groupId = queuedGroupId || '';
        const groupParentId = groupId ? groupParentMap.get(groupId) : undefined;
        const isGroupParent = groupId ? groupFirstId.get(groupId) === imageId : false;
        const parentIdToSend = groupId
          ? (isGroupParent ? undefined : groupParentId)
          : (selectedParentId || undefined);

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

        if (groupId && !isGroupParent && !groupParentId) {
          setUploadedImages((prev) =>
            prev.map((img) =>
              img.id === imageId
                ? { ...img, status: "error", error: "Missing parent image for Keynote group" }
                : img
            )
          );
          continue;
        }

        try {
          const formData = new FormData();
          formData.append("file", file);
          const effectiveAssetType = assetType ?? inferAssetTypeFromFile(file);
          if (displayNameToSend) {
            formData.append("displayName", displayNameToSend);
          }
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
          if (sourcePathToSend) {
            formData.append("sourcePath", sourcePathToSend);
          }
          formData.append("namespace", uploadNamespace);
          if (parentIdToSend) {
            formData.append("parentId", parentIdToSend);
          }

          // Add delay between uploads to avoid rate limits (except first file)
          if (i > 0) {
            await delay(UPLOAD_DELAY_MS);
          }

          // Upload with automatic retry on rate limits/server errors
          const { response, result } = effectiveAssetType === 'video'
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
                status: "success",
                embeddingStatus: shouldEmbedAnything ? "queued" : undefined,
                embeddingRequested: shouldEmbedAnything ? { clip: shouldEmbedClip, color: shouldEmbedColor } : undefined,
                folder: item.folder,
                tags: item.tags,
                description: item.description,
                originalUrl: item.originalUrl,
                sourceUrl: item.sourceUrl
              }));
              const failureEntries: UploadedImage[] = (zipResult.failures || []).map((item) => ({
                id: Math.random().toString(36).substring(7),
                assetType: 'image',
                url: "",
                filename: item.filename,
                status: "error",
                error: item.error
              }));
              const skippedEntries: UploadedImage[] = (zipResult.skipped || []).map((item) => ({
                id: Math.random().toString(36).substring(7),
                assetType: 'image',
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

              if (shouldEmbedAnything) {
                successEntries.forEach((entry) => enqueueEmbedding(entry.id, shouldEmbedClip, shouldEmbedColor));
              }

              if (onImageUploaded && successEntries.length > 0) {
                setTimeout(() => {
                  onImageUploaded();
                }, 500);
              }
            } else {
              const typedResult = result as {
                id?: string;
                url?: string;
                playbackUrl?: string;
                hlsUrl?: string;
                thumbnailUrl?: string;
              };
              const serverId = typedResult && typeof typedResult === 'object' && 'id' in typedResult && typeof typedResult.id === 'string'
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
                        status: "success",
                        embeddingStatus: effectiveAssetType === 'image' && shouldEmbedAnything ? "queued" : undefined,
                        embeddingRequested: effectiveAssetType === 'image' && shouldEmbedAnything ? { clip: shouldEmbedClip, color: shouldEmbedColor } : undefined,
                        assetType: effectiveAssetType,
                        url: typedResult.url || typedResult.playbackUrl || typedResult.hlsUrl || typedResult.thumbnailUrl || '',
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

              if (effectiveAssetType === 'image' && shouldEmbedAnything) {
                enqueueEmbedding(serverId, shouldEmbedClip, shouldEmbedColor);
              }

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

      endUploadActivity();

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
    [resolveFolder, tags, description, originalUrl, sourceUrl, uploadNamespace, selectedParentId, onImageUploaded, fetchFolders, formatUploadErrorMessage, embedClipOnUpload, embedColorOnUpload, enqueueEmbedding, omitOriginalUrl, markNamespaceUploadFailures, beginUploadActivity, endUploadActivity]
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
      const initialImages: UploadedImage[] = validItems.map((entry) => {
        const effectiveAssetType = entry.assetType ?? inferAssetTypeFromUrl(entry.remoteUrl);
        const originalUrlToSend = omitOriginalUrl
          ? ''
          : entry.originalUrl !== undefined
            ? entry.originalUrl
            : originalUrl.trim() || entry.remoteUrl || '';
        const sourceUrlToSend =
          entry.sourceUrl !== undefined ? entry.sourceUrl : sourceUrl.trim() || '';
        const folderToSend = entry.folder !== undefined ? entry.folder : folderToUse;
        const tagsToSend = resolveTagInput(tags, entry.tags);
        const descriptionToSend = entry.description !== undefined ? entry.description : description;

        return {
          id: entry.id,
          assetType: effectiveAssetType,
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

      const imagePayloadItems = validItems
        .filter((entry) => (entry.assetType ?? inferAssetTypeFromUrl(entry.remoteUrl)) === 'image')
        .map((entry) => {
        const originalUrlToSend = omitOriginalUrl
          ? ''
          : entry.originalUrl !== undefined
            ? entry.originalUrl
            : originalUrl.trim() || entry.remoteUrl || '';
        const sourceUrlToSend =
          entry.sourceUrl !== undefined ? entry.sourceUrl : sourceUrl.trim() || '';
        const folderToSend = entry.folder !== undefined ? entry.folder : folderToUse;
        const tagsToSend = resolveTagInput(tags, entry.tags);
        const descriptionToSend =
          entry.description !== undefined ? entry.description : description;
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
          parentId: selectedParentId || undefined
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
          const sourceUrlToSend =
            entry.sourceUrl !== undefined ? entry.sourceUrl : sourceUrl.trim() || '';
          const folderToSend = entry.folder !== undefined ? entry.folder : folderToUse;
          const tagsToSend = resolveTagInput(tags, entry.tags);
          const descriptionToSend =
            entry.description !== undefined ? entry.description : description;
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
              ...(pageImportCookieHeader.trim() ? { cookieHeader: pageImportCookieHeader.trim() } : {}),
            })
          });
          const imageData = await imageResponse.json();

          if (!imageResponse.ok) {
            const message = typeof imageData?.error === 'string' ? imageData.error : 'Failed to upload page images';
            setUploadedImages((prev) =>
              prev.map((img) =>
                imagePayloadItems.some((item) => item.clientId === img.id)
                  ? { ...img, status: "error", error: message }
                  : img
              )
            );
            return;
          }

          if (Array.isArray(imageData?.results)) {
            resultList.push(...imageData.results);
          }
          if (Array.isArray(imageData?.failures)) {
            failureList.push(...imageData.failures);
          }
        }

        if (videoPayloadItems.length > 0) {
          await runWithConcurrency(videoPayloadItems, VIDEO_REMOTE_UPLOAD_CONCURRENCY, async (item) => {
            const isBlobSource = item.isBlobSource || item.url.startsWith('blob:');
            let videoResponse: Response;
            if (isBlobSource) {
              try {
                const blobResponse = await fetch(item.url);
                if (!blobResponse.ok) {
                  throw new Error(`Blob fetch failed (${blobResponse.status})`);
                }
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
                })
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

        const successMap = new Map<string, UploadResult>(
          resultList.map((item: UploadResult) => [item.clientId, item])
        );
        const failureMap = new Map<string, UploadFailure>(
          failureList.map((item: UploadFailure) => [item.clientId, item])
        );

        setUploadedImages((prev) =>
          prev.map((img) => {
            const success = successMap.get(img.id);
            if (success) {
              const sourceItem = validItems.find((item) => item.id === img.id);
              const assetType = sourceItem?.assetType ?? inferAssetTypeFromUrl(sourceItem?.remoteUrl);
              return {
                ...img,
                id: success.id ?? img.id,
                status: "success" as const,
                assetType,
                embeddingStatus: assetType === 'image' && shouldEmbedAnything ? "queued" : undefined,
                embeddingRequested: assetType === 'image' && shouldEmbedAnything ? { clip: shouldEmbedClip, color: shouldEmbedColor } : undefined,
                url: success.url ?? img.url,
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
                status: "error" as const,
                error: failure.error || 'Upload failed'
              };
            }
            if (validItems.some((item) => item.id === img.id)) {
              return {
                ...img,
                status: "error" as const,
                error: "Upload failed"
              };
            }
            return img;
          })
        );

        if (shouldEmbedAnything) {
          resultList.forEach((item: UploadResult) => {
            const sourceItem = validItems.find((entry) => entry.id === item.clientId);
            const assetType = sourceItem?.assetType ?? inferAssetTypeFromUrl(sourceItem?.remoteUrl);
            if (item.id && assetType === 'image') {
              enqueueEmbedding(item.id, shouldEmbedClip, shouldEmbedColor);
            }
          });
        }

        if (onImageUploaded && resultList.length > 0) {
          setTimeout(() => {
            onImageUploaded();
          }, 500);
        }
      } catch (error) {
        console.error('Remote upload error:', error);
        setUploadedImages((prev) =>
          prev.map((img) =>
            validItems.some((item) => item.id === img.id)
              ? { ...img, status: "error", error: "Network error" }
              : img
          )
        );
      } finally {
        endUploadActivity();
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
    [resolveFolder, tags, description, originalUrl, sourceUrl, uploadNamespace, selectedParentId, onImageUploaded, fetchFolders, embedClipOnUpload, embedColorOnUpload, enqueueEmbedding, omitOriginalUrl, pageImportAllowInsecure, pageImportCookieHeader, markNamespaceUploadFailures, beginUploadActivity, endUploadActivity]
  );

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
    const selectedItems = queuedFiles.filter((item) => item.selected !== false);
    if (selectedItems.length === 0) return;

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

    const selectedIds = new Set(selectedItems.map((item) => item.id));
    selectedItems.forEach((item) => {
      if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
    setQueuedFiles((prev) => prev.filter((item) => !selectedIds.has(item.id)));
  };

  const handleAiRefineSelectedNames = useCallback(async () => {
    const selectedItems = queuedFiles.filter((item) => item.selected !== false);
    if (selectedItems.length === 0) return;

    setAiRefiningNames(true);
    try {
      const fallbackFolder = resolveFolder();
      for (const item of selectedItems) {
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

        const response = await fetch('/api/display-name/suggest', {
          method: 'POST',
          body: formData,
        });
        const payload = (await response.json().catch(() => ({}))) as {
          displayName?: string;
          error?: string;
        };

        if (!response.ok || !payload.displayName) {
          updateQueuedFile(item.id, {
            processingNote: payload.error || 'AI naming failed',
          });
          continue;
        }

        updateQueuedFile(item.id, {
          filename: payload.displayName,
          processingNote: `AI shortname: ${payload.displayName}`,
        });
      }
    } catch (error) {
      console.error('Failed to refine queued names with AI', error);
    } finally {
      setAiRefiningNames(false);
    }
  }, [queuedFiles, resolveFolder, tags, updateQueuedFile]);

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
          assetType: 'image',
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

  const parseCookieHeaderFromClipboard = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const cookieLine = lines.find((line) => /^cookie\s*:/i.test(line));
    const candidate = (cookieLine || trimmed).replace(/^cookie\s*:\s*/i, '').trim();
    return candidate;
  };

  const handleImportFromPage = async (cookieHeaderOverride?: string) => {
    if (!pageImportUrl.trim()) return;
    const cookieHeaderValue = (cookieHeaderOverride ?? pageImportCookieHeader).trim();
    try {
      setPageImportLoading(true);
      setPageImportError(null);
      setPageImportProgress(null);
      
      // For scroll mode, use streaming SSE endpoint for progressive loading
      if (pageImportScrollMode) {
        const maxPages = Number(pageImportMaxPages) || 1;
        const maxScrolls = Number(pageImportMaxScrolls) || 10;
        const scrollDelayMs = Number(pageImportScrollDelayMs) || 1500;
        const autoScrollUntilStable = pageImportAutoScroll;
        
        const response = await fetch('/api/import/page/scroll/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: pageImportUrl.trim(),
            maxPages,
            scrollDelayMs,
            autoScrollUntilStable,
            ...(cookieHeaderValue ? { cookieHeader: cookieHeaderValue } : {}),
            ...(autoScrollUntilStable ? {} : { maxScrolls })
          })
        });

        if (!response.ok || !response.body) {
          throw new Error('Failed to start page scan');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let totalAssets = 0;
        let scrollCount = 0;
        let lastProgressUpdateAt = 0;
        const pendingQueueItems: QueuedFile[] = [];
        const existingUrls = new Set(queuedFiles.map(f => f.remoteUrl || f.originalUrl || f.filename));
        const flushPendingQueueItems = () => {
          if (pendingQueueItems.length === 0) return;
          const batch = pendingQueueItems.splice(0, pendingQueueItems.length);
          setQueuedFiles((prev) => [...prev, ...batch]);
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let eventType = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ') && eventType) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (eventType === 'status') {
                  const now = Date.now();
                  if (now - lastProgressUpdateAt >= STREAM_PROGRESS_UPDATE_INTERVAL_MS) {
                    setPageImportProgress({
                      message: data.message || 'Processing...',
                      scrollCount: data.scrollCount || 0,
                      imageCount: data.imageCount || 0
                    });
                    lastProgressUpdateAt = now;
                  }
                  scrollCount = data.scrollCount || 0;
                } else if (eventType === 'image' || eventType === 'video' || eventType === 'media') {
                  const mediaUrl = typeof data.url === 'string' ? data.url : '';
                  if (mediaUrl && !existingUrls.has(mediaUrl)) {
                    existingUrls.add(mediaUrl);
                    totalAssets++;
                    const isBlobSource = Boolean(data.isBlob) || mediaUrl.startsWith('blob:');
                    const inferredAssetType: 'image' | 'video' =
                      data.kind === 'video' || eventType === 'video' || inferAssetTypeFromUrl(mediaUrl) === 'video'
                        ? 'video'
                        : 'image';
                    const newItem: QueuedFile = {
                      id: createQueueId(),
                      assetType: inferredAssetType,
                      filename: data.filename || mediaUrl.split('/').pop() || (inferredAssetType === 'video' ? 'remote-video' : 'remote-image'),
                      remoteUrl: mediaUrl,
                      previewUrl: totalAssets <= PAGE_IMPORT_PREVIEW_LIMIT
                        ? (inferredAssetType === 'image' ? mediaUrl : (typeof data.posterUrl === 'string' ? data.posterUrl : undefined))
                        : undefined,
                      posterUrl: typeof data.posterUrl === 'string' ? data.posterUrl : undefined,
                      originalUrl: mediaUrl,
                      isBlobSource,
                      selected: true
                    };
                    pendingQueueItems.push(newItem);
                    if (pendingQueueItems.length >= STREAM_QUEUE_FLUSH_BATCH_SIZE) {
                      flushPendingQueueItems();
                    }
                  }
                } else if (eventType === 'done') {
                  flushPendingQueueItems();
                  setPageImportProgress({
                    message: data.message || 'Complete',
                    scrollCount: data.scrollCount || scrollCount,
                    imageCount: data.imageCount || totalAssets
                  });
                } else if (eventType === 'error') {
                  throw new Error(data.error || 'Unknown error');
                }
              } catch (parseErr) {
                // Ignore parse errors for incomplete data
                if (eventType === 'error') {
                  throw parseErr;
                }
              }
              eventType = '';
            }
          }
        }
        flushPendingQueueItems();

        if (totalAssets === 0) {
          setPageImportError(`No media found after ${scrollCount} scroll${scrollCount !== 1 ? 's' : ''}. The page may require login, use complex lazy-loading, or block automated browsers.`);
        } else {
        }
        
        if (!sourceUrl.trim()) {
          setSourceUrl(pageImportUrl.trim());
        }
        setPageImportUrl('');
        
        // Clear progress after a brief delay
        setTimeout(() => setPageImportProgress(null), 3000);
        return;
      }
      
      // Non-scroll mode: use original endpoint
      const response = await fetch('/api/import/page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: pageImportUrl.trim(),
          minBytes: 8 * 1024,
          allowInsecure: pageImportAllowInsecure,
          ...(cookieHeaderValue ? { cookieHeader: cookieHeaderValue } : {}),
        })
      });
      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const data = isJson ? await response.json() : await response.text();
      if (!response.ok) {
        if (isJson && typeof data === 'object' && data && 'error' in data) {
          const payload = data as {
            error?: string;
            details?: {
              upstreamStatus?: number;
              upstreamStatusText?: string;
              finalUrl?: string;
              code?: string;
            };
          };
          const baseError = payload.error || 'Failed to inspect page';
          const detailParts: string[] = [];
          if (typeof payload.details?.upstreamStatus === 'number') {
            detailParts.push(`Upstream: ${payload.details.upstreamStatus}${payload.details.upstreamStatusText ? ` ${payload.details.upstreamStatusText}` : ''}`);
          }
          if (payload.details?.code) {
            detailParts.push(`Code: ${payload.details.code}`);
          }
          if (payload.details?.finalUrl) {
            detailParts.push(`Final URL: ${payload.details.finalUrl}`);
          }
          throw new Error(detailParts.length ? `${baseError} (${detailParts.join(' | ')})` : baseError);
        }
        throw new Error('Failed to inspect page');
      }
      if (!isJson || typeof data !== 'object' || !data) {
        throw new Error('Failed to inspect page');
      }
      const media = Array.isArray(data?.media) ? data.media : [];
      const images = Array.isArray(data?.images) ? data.images : [];
      const videos = Array.isArray(data?.videos) ? data.videos : [];
      const mergedMedia = media.length > 0 ? media : [
        ...images.map((image: { url: string; filename?: string; contentLength?: number; contentType?: string }) => ({ ...image, kind: 'image' as const })),
        ...videos.map((video: { url: string; filename?: string; contentType?: string; isBlob?: boolean; posterUrl?: string }) => ({ ...video, kind: 'video' as const })),
      ];
      const includePreviews = mergedMedia.length <= PAGE_IMPORT_PREVIEW_LIMIT;
      
      if (mergedMedia.length === 0) {
        setPageImportError('No media found on that page. The assets may be loaded via JavaScript—try enabling "Scroll mode" to load infinite scroll content.');
        return;
      }
      

      const newItems: QueuedFile[] = mergedMedia.map((entry: { kind?: 'image' | 'video'; url: string; filename?: string; contentLength?: number; contentType?: string; isBlob?: boolean; posterUrl?: string }) => ({
        id: createQueueId(),
        assetType: entry.kind === 'video' || inferAssetTypeFromUrl(entry.url) === 'video' ? 'video' : 'image',
        filename: entry.filename || entry.url.split('/').pop() || (entry.kind === 'video' ? 'remote-video' : 'remote-image'),
        remoteUrl: entry.url,
        previewUrl: includePreviews ? (entry.kind === 'video' ? entry.posterUrl : entry.url) : undefined,
        posterUrl: entry.posterUrl,
        isBlobSource: Boolean(entry.isBlob) || entry.url.startsWith('blob:'),
        sizeBytes: typeof entry.contentLength === 'number' ? entry.contentLength : undefined,
        contentType: typeof entry.contentType === 'string' ? entry.contentType : undefined,
        originalUrl: entry.url,
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

  const handlePasteCookiesAndScan = async () => {
    if (pageImportLoading) return;
    if (!pageImportUrl.trim()) {
      setPageImportError('Enter a page URL first, then paste cookies and scan.');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      setPageImportError('Clipboard read is unavailable. Paste the Cookie header manually.');
      return;
    }

    try {
      const clipboardText = await navigator.clipboard.readText();
      const parsedCookieHeader = parseCookieHeaderFromClipboard(clipboardText);
      if (!parsedCookieHeader) {
        setPageImportError('Clipboard does not contain a Cookie header.');
        return;
      }
      setPageImportCookieHeader(parsedCookieHeader);
      await handleImportFromPage(parsedCookieHeader);
    } catch (error) {
      console.error('Paste cookies + scan failed', error);
      setPageImportError('Could not read clipboard. Allow clipboard permission, then try again.');
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
      <h2 className="text-xs font-mono  text-gray-900 mb-4">Upload Media</h2>

      {/* Activity Indicator - prominent progress during bulk operations */}
      {(isActivityActive || activityStats.total > 0) && (
        <ActivityIndicator stats={activityStats} isActive={isActivityActive} />
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
          <label className="mb-2 flex items-center gap-2 text-[11px] text-gray-600">
            <input
              type="checkbox"
              checked={omitOriginalUrl}
              onChange={(e) => {
                setOmitOriginalUrl(e.target.checked);
                if (e.target.checked) {
                  setOriginalUrl('');
                }
              }}
              className="h-3 w-3"
            />
            Do not store original URL
          </label>
          <input
            id="original-url-input"
            type="url"
            placeholder="https://example.com/original-image.jpg"
            value={originalUrl}
            onChange={(e) => setOriginalUrl(e.target.value)}
            disabled={omitOriginalUrl}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          />
          {/* <p className="text-xs text-gray-500 mt-1">Asset URL</p> */}
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
          "border-2 border-dashed rounded-lg p-2 text-center transition-all cursor-pointer relative overflow-hidden",
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
            disabled={pageImportLoading}
          />
          <button
            type="button"
            onClick={() => {
              void handleImportFromPage();
            }}
            disabled={pageImportLoading || !pageImportUrl.trim()}
            className="px-4 py-2 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {pageImportLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            {pageImportLoading ? (pageImportScrollMode ? 'Scrolling…' : 'Scanning…') : 'Scan page'}
          </button>
          <button
            type="button"
            onClick={handlePasteCookiesAndScan}
            disabled={pageImportLoading || !pageImportUrl.trim()}
            className="px-4 py-2 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            title="Reads clipboard, extracts Cookie header, and starts scan"
          >
            Paste cookies + scan
          </button>
        </div>
        
        {/* Progress indicator for scroll mode */}
        {pageImportLoading && pageImportScrollMode && pageImportProgress && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0">
                <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-blue-900">{pageImportProgress.message}</p>
                <div className="flex items-center gap-4 mt-1">
                  {pageImportProgress.pageNum && Number(pageImportMaxPages) > 1 && (
                    <span className="text-[11px] text-blue-700">
                      📄 Page {pageImportProgress.pageNum}
                    </span>
                  )}
                  <span className="text-[11px] text-blue-700">
                    {pageImportProgress.scrollCount} scroll{pageImportProgress.scrollCount !== 1 ? 's' : ''}
                  </span>
                  <span className="text-[11px] text-blue-700">
                    {pageImportProgress.imageCount} asset{pageImportProgress.imageCount !== 1 ? 's' : ''} found
                  </span>
                </div>
              </div>
            </div>
            {pageImportProgress.imageCount > 0 && (
              <p className="text-[10px] text-blue-600 mt-2">
                Images are being added to your queue as they&apos;re discovered…
              </p>
            )}
          </div>
        )}
        
        {/* Done indicator (brief) */}
        {!pageImportLoading && pageImportProgress && (
          <div className="mt-3 p-2 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span className="text-xs text-green-800">
              {pageImportProgress.message} — {pageImportProgress.imageCount} asset{pageImportProgress.imageCount !== 1 ? 's' : ''} added
            </span>
          </div>
        )}
        
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[11px] text-gray-600">
            <input
              type="checkbox"
              checked={pageImportScrollMode}
              onChange={(e) => setPageImportScrollMode(e.target.checked)}
              className="h-3 w-3"
              disabled={pageImportLoading}
            />
            Scroll mode (for infinite scroll pages)
          </label>
          {pageImportScrollMode && (
            <>
              <label className="flex items-center gap-2 text-[11px] text-gray-600">
                <input
                  type="checkbox"
                  checked={pageImportAutoScroll}
                  onChange={(e) => setPageImportAutoScroll(e.target.checked)}
                  className="h-3 w-3"
                  disabled={pageImportLoading}
                />
                Auto-scroll until no new assets
              </label>
              {!pageImportAutoScroll && (
                <label className="flex items-center gap-2 text-[11px] text-gray-600">
                  Max scrolls
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={pageImportMaxScrolls}
                    onChange={(e) => setPageImportMaxScrolls(e.target.value)}
                    className="w-16 border border-gray-300 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                    disabled={pageImportLoading}
                  />
                </label>
              )}
              <label className="flex items-center gap-2 text-[11px] text-gray-600">
                Scroll delay (ms)
                <input
                  type="number"
                  min="500"
                  max="5000"
                  step="100"
                  value={pageImportScrollDelayMs}
                  onChange={(e) => setPageImportScrollDelayMs(e.target.value)}
                  className="w-20 border border-gray-300 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                  disabled={pageImportLoading}
                />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-gray-600">
                Max pages
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={pageImportMaxPages}
                  onChange={(e) => setPageImportMaxPages(e.target.value)}
                  className="w-16 border border-gray-300 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                  disabled={pageImportLoading}
                />
              </label>
            </>
          )}
        </div>
        <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-600">
          <input
            type="checkbox"
            checked={pageImportAllowInsecure}
            onChange={(e) => setPageImportAllowInsecure(e.target.checked)}
            className="h-3 w-3"
            disabled={pageImportLoading}
          />
          Allow insecure TLS (expired/self-signed certs). Requires IMPORT_ALLOW_INSECURE_TLS=true on the server.
        </label>
        <label className="mt-2 block text-[11px] text-gray-600">
          Optional Cookie header (for authenticated scraping on sites that block anonymous automation)
          <textarea
            value={pageImportCookieHeader}
            onChange={(e) => setPageImportCookieHeader(e.target.value)}
            placeholder="sessionid=...; other_cookie=..."
            className="mt-1 w-full border border-gray-300 rounded-md px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
            rows={2}
            disabled={pageImportLoading}
          />
        </label>
        <details className="mt-2 text-[11px] text-gray-600">
          <summary className="cursor-pointer select-none text-gray-700">
            How to get the request Cookie header
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>Open the target page in your regular browser where you are already logged in.</li>
            <li>Open DevTools, then go to the Network tab.</li>
            <li>Refresh the page and click the main page request (usually type Document).</li>
            <li>In Request Headers, copy the full <span className="font-mono">Cookie</span> header value.</li>
            <li>Paste it into this field, or use <span className="font-mono">Paste cookies + scan</span>.</li>
          </ol>
          <p className="mt-2 text-[11px] text-gray-500">
            If this still fails on protected sites, use CLI browser ingest (<span className="font-mono">npm run page:browser-ingest -- --namespace your-ns --url https://target-page</span>) to extract from a live logged-in browser session.
          </p>
        </details>
        {pageImportError && <p className="text-xs text-red-600 mt-1">{pageImportError}</p>}
        <p className="text-[11px] text-gray-500 mt-1">
          {pageImportScrollMode 
            ? 'Uses a headless browser to trigger lazy/infinite loading and follow pagination links. Auto-scroll stops when no new assets are found (with a safety cap). Requires puppeteer.'
            : 'Scans the page HTML for image/video URLs. Fast but may miss JavaScript-loaded content.'}
        </p>
      </div>

      {/* Queued Files Section */}
      {queuedFiles.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-mono font-medium text-gray-900">Queued Files ({queuedFiles.length})</p>
            <div className="flex space-x-2">
              {queuedFiles.some(f => needsSanitization(f.filename)) && (
                <button
                  onClick={() => {
                    setQueuedFiles(prev => prev.map(f => 
                      needsSanitization(f.filename) 
                        ? { ...f, filename: sanitizeFilename(f.filename) }
                        : f
                    ));
                  }}
                  className="px-3 py-1 text-xs text-amber-700 hover:text-amber-800 border border-amber-300 bg-amber-50 rounded-md hover:bg-amber-100"
                  disabled={isUploading}
                  title="Sanitize all long or problematic filenames"
                >
                  Sanitize All Names
                </button>
              )}
              <button
                onClick={handleAiRefineSelectedNames}
                className="px-3 py-1 text-xs text-fuchsia-700 hover:text-fuchsia-800 border border-fuchsia-300 bg-fuchsia-50 rounded-md hover:bg-fuchsia-100 disabled:opacity-50"
                disabled={isUploading || aiRefiningNames || selectedQueuedCount === 0}
                title="Use AI vision to generate CamelCase shortnames for selected queue items"
              >
                {aiRefiningNames ? 'Refining…' : 'AI Refine Selected Names'}
              </button>
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
          {queuedFiles.length > QUEUE_RENDER_LIMIT && !showAllQueuedItems && (
            <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              Rendering first {QUEUE_RENDER_LIMIT} queue items for performance.
              <button
                type="button"
                onClick={() => setShowAllQueuedItems(true)}
                className="ml-2 underline hover:text-amber-900"
              >
                Show all
              </button>
            </div>
          )}
          {queuedFiles.length > QUEUE_RENDER_LIMIT && showAllQueuedItems && (
            <div className="mb-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-700">
              Showing all {queuedFiles.length} queue items.
              <button
                type="button"
                onClick={() => setShowAllQueuedItems(false)}
                className="ml-2 underline hover:text-gray-900"
              >
                Show first {QUEUE_RENDER_LIMIT}
              </button>
            </div>
          )}
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
            {visibleQueuedFiles.map((item) => {
              const hasCustomFolder = item.folder !== undefined;
              const hasCustomTags = item.tags !== undefined;
              const hasCustomDescription = item.description !== undefined;
              const hasCustomOriginalUrl = item.originalUrl !== undefined;
              const hasCustomSourceUrl = item.sourceUrl !== undefined;
              const previewUrl = item.previewUrl || item.remoteUrl;
              const effectiveAssetType = item.assetType ?? (item.file ? inferAssetTypeFromFile(item.file) : inferAssetTypeFromUrl(item.remoteUrl));
              const previewFailed = Boolean(previewFailures[item.id]);
              const displaySizeBytes = item.file?.size ?? item.sizeBytes;
              const overMaxBytes = typeof displaySizeBytes === 'number' && displaySizeBytes > MAX_BYTES;
              const previewFolder = selectedFolder.trim()
                ? selectedFolder.trim()
                : newFolder.trim()
                  ? newFolder.trim().toLowerCase().replace(/\s+/g, "-")
                  : "";
              const effectiveFolder = hasCustomFolder ? item.folder || "" : previewFolder;
              const effectiveTags = resolveTagInput(tags, hasCustomTags ? item.tags : undefined);
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
                    effectiveAssetType === 'video' ? (
                      <div className="relative h-28 w-28 rounded border border-blue-200 bg-black overflow-hidden">
                        {(item.posterUrl || (!item.file ? previewUrl : undefined)) ? (
                          <img
                            src={item.posterUrl || previewUrl}
                            alt={item.filename}
                            className="h-full w-full object-cover"
                            onError={() => { void handlePreviewLoadError(item); }}
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-300">
                            VIDEO
                          </div>
                        )}
                        <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                          VIDEO
                        </div>
                      </div>
                    ) : (
                      <img
                        src={previewUrl}
                        alt={item.filename}
                        className="h-28 w-28 rounded border border-blue-200 object-cover bg-white"
                        onError={() => { void handlePreviewLoadError(item); }}
                        referrerPolicy="no-referrer"
                      />
                    )
                  ) : (
                    <div className="h-28 w-28 rounded border border-blue-200 bg-white flex items-center justify-center text-[10px] text-gray-400">
                      {item.file ? "Local file" : "No preview (source blocked?)"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={item.filename}
                        onChange={(e) => updateQueuedFile(item.id, { filename: e.target.value })}
                        className="flex-1 min-w-0 text-xs font-mono font-medium text-gray-900 bg-transparent border-b border-transparent hover:border-blue-300 focus:border-blue-500 focus:outline-none truncate"
                        title="Click to edit filename"
                        disabled={isUploading}
                      />
                      {needsSanitization(item.filename) && (
                        <button
                          type="button"
                          onClick={() => updateQueuedFile(item.id, { filename: sanitizeFilename(item.filename) })}
                          className="px-1.5 py-0.5 text-[10px] bg-amber-100 hover:bg-amber-200 text-amber-700 rounded border border-amber-300 whitespace-nowrap"
                          title="Clean up and truncate filename"
                          disabled={isUploading}
                        >
                          Sanitize
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {formatBytesMB(displaySizeBytes)}
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-600">
                        {effectiveAssetType}
                      </span>
                      {item.filename.length > MAX_FILENAME_LENGTH && (
                        <span className="ml-2 text-amber-600">⚠ Long filename ({item.filename.length} chars)</span>
                      )}
                    </p>
                    {effectiveAssetType === 'video' && item.isBlobSource && (
                      <p className="text-[11px] text-amber-700">
                        Blob source detected. Upload will attempt browser capture first.
                      </p>
                    )}
                    {(item.tags || item.description) && (
                      <div className="text-[11px] text-gray-600 space-y-0.5">
                        {item.tags && (
                          <p className="truncate" title={item.tags}>
                            Tags (prefill): {item.tags}
                          </p>
                        )}
                        {item.description && (
                          <p className="truncate" title={item.description}>
                            Description (prefill): {item.description}
                          </p>
                        )}
                      </div>
                    )}
                    {item.processingNote && (
                      <p className="text-[11px] text-emerald-700">{item.processingNote}</p>
                    )}
                    {overMaxBytes && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <p className="text-[11px] text-amber-700">
                          File exceeds 10MB. Suggest converting to JPEG/WebP, then reducing dimensions.
                        </p>
                        <button
                          type="button"
                          onClick={() => reduceQueuedFileSize(item.id)}
                          disabled={Boolean(reducingQueueItems[item.id]) || isUploading}
                          className="px-2 py-1 text-[11px] bg-amber-100 hover:bg-amber-200 text-amber-800 rounded border border-amber-300 disabled:opacity-50"
                        >
                          {reducingQueueItems[item.id] ? 'Reducing…' : 'Reduce size'}
                        </button>
                      </div>
                    )}
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
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">Uploaded Images ({uploadedImages.length})</h3>
            <button
              onClick={() => setUploadedImages([])}
              className="text-sm text-gray-500 hover:text-red-600 transition-colors flex items-center gap-1"
            >
              <X className="h-4 w-4" />
              Clear All
            </button>
          </div>
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
                    {image.embeddingRequested && (
                      <div className="flex items-center gap-2 text-[11px] text-purple-700">
                        {(image.embeddingStatus === "queued" || image.embeddingStatus === "embedding") && (
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75"></span>
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-600"></span>
                          </span>
                        )}
                        {image.embeddingStatus === "success" && (
                          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                        )}
                        {image.embeddingStatus === "error" && (
                          <span className="inline-flex h-2 w-2 rounded-full bg-red-500"></span>
                        )}
                        <span>
                          Embedding {image.embeddingStatus ?? "queued"}
                          {image.embeddingRequested.clip && image.embeddingRequested.color
                            ? " (clip + color)"
                            : image.embeddingRequested.clip
                              ? " (clip)"
                              : image.embeddingRequested.color
                                ? " (color)"
                                : ""}
                        </span>
                      </div>
                    )}
                    {image.embeddingStatus === "error" && image.embeddingError && (
                      <p className="text-[11px] text-red-600">{image.embeddingError}</p>
                    )}
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
 
