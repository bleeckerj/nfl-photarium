import { AlertCircle, CheckCircle, RefreshCw, X } from 'lucide-react';
import clsx from 'clsx';

import type { UploadedImage } from '@/components/image-uploader/types';

interface UploadedImagesListProps {
  uploadedImages: UploadedImage[];
  isUploading: boolean;
  onClearAll: () => void;
  onCopyUrl: (url: string) => void;
  onRemove: (id: string) => void;
  onRetryUpload: (image: UploadedImage, options?: { overrideDuplicate?: boolean }) => void;
}

export default function UploadedImagesList({
  uploadedImages,
  isUploading,
  onClearAll,
  onCopyUrl,
  onRemove,
  onRetryUpload,
}: UploadedImagesListProps) {
  if (uploadedImages.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">Uploaded Images ({uploadedImages.length})</h3>
        <button
          type="button"
          onClick={onClearAll}
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
                {image.status === 'uploading' && <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500" />}
                {image.status === 'success' && <CheckCircle className="h-5 w-5 text-green-500" />}
                {image.status === 'error' && <AlertCircle className="h-5 w-5 text-red-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono font-medium text-gray-900 truncate">{image.filename}</p>
                {image.folder && <p className="text-xs text-gray-500">📁 {image.folder}</p>}
                {image.description && <p className="text-xs text-gray-500">📝 {image.description}</p>}
                {image.originalUrl && (
                  <p className="text-xs text-gray-500">
                    🔗 <a href={image.originalUrl} target="_blank" rel="noreferrer" className="underline">Original</a>
                  </p>
                )}
                {image.sourceUrl && (
                  <p className="text-xs text-gray-500">
                    🔗 <a href={image.sourceUrl} target="_blank" rel="noreferrer" className="underline">Source</a>
                  </p>
                )}
                {image.tags && image.tags.length > 0 && <p className="text-xs text-gray-500">🏷️ {image.tags.join(', ')}</p>}
                {image.embeddingRequested && (
                  <div className="flex items-center gap-2 text-[11px] text-purple-700">
                    {(image.embeddingStatus === 'queued' || image.embeddingStatus === 'embedding') && (
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-600" />
                      </span>
                    )}
                    {image.embeddingStatus === 'success' && (
                      <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    )}
                    {image.embeddingStatus === 'error' && (
                      <span className="inline-flex h-2 w-2 rounded-full bg-red-500" />
                    )}
                    <span>
                      Embedding {image.embeddingStatus ?? 'queued'}
                      {image.embeddingRequested.clip && image.embeddingRequested.color
                        ? ' (clip + color)'
                        : image.embeddingRequested.clip
                          ? ' (clip)'
                          : image.embeddingRequested.color
                            ? ' (color)'
                            : ''}
                    </span>
                  </div>
                )}
                {image.embeddingStatus === 'error' && image.embeddingError && (
                  <p className="text-[11px] text-red-600">{image.embeddingError}</p>
                )}
                {image.status === 'success' && image.url && (
                  <button
                    type="button"
                    onClick={() => onCopyUrl(image.url)}
                    className="text-xs text-blue-600 hover:text-blue-800 truncate block max-w-xs"
                  >
                    {image.url}
                  </button>
                )}
                {image.status === 'error' && (
                  <div className="space-y-1">
                    <p className="text-xs text-red-600">{image.error}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onRetryUpload(image)}
                        disabled={(!image.file && !image.remoteUrl) || isUploading}
                        className={clsx(
                          'inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800',
                          ((!image.file && !image.remoteUrl) || isUploading) && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        <RefreshCw className="h-3 w-3" />
                        Retry upload
                      </button>
                      {image.duplicateUploadBlocked && (
                        <button
                          type="button"
                          onClick={() => onRetryUpload(image, { overrideDuplicate: true })}
                          disabled={(!image.file && !image.remoteUrl) || isUploading}
                          className={clsx(
                            'inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:text-amber-900',
                            ((!image.file && !image.remoteUrl) || isUploading) && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          <RefreshCw className="h-3 w-3" />
                          Retry and Override
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <button type="button" onClick={() => onRemove(image.id)} className="flex-shrink-0 text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
