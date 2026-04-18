/**
 * ImageCard Component
 * 
 * Displays a single image in the gallery grid view.
 * Handles selection, hover preview, and action buttons.
 */

'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Trash2, Copy, ExternalLink, Sparkles, Layers, AlertTriangle } from 'lucide-react';
import { getCloudflareImageUrl, getCloudflareDownloadUrl } from '@/utils/imageUtils';
import { formatBytes } from '@/utils/formatBytes';
import { ColorSwatches } from '@/components/ColorSwatches';
import { EmbeddingStatusDot } from '@/components/EmbeddingStatusIcon';
import { SearchExclusionIcon } from './icons';
import { AspectRatioDisplay } from './AspectRatioDisplay';
import { hasSearchExclusionTag, getExclusionTooltip, isSvgImage } from './utils';
import type { CloudflareImage, ColorMetadata } from './types';
import type { EmbeddingPendingEntry } from '@/utils/embeddingPending';

interface ImageCardProps {
  image: CloudflareImage;
  selectedVariant: string;
  respectAspectRatio: boolean;
  isSelected: boolean;
  bulkSelectionMode: boolean;
  isDuplicate: boolean;
  variationChildren?: CloudflareImage[];
  colorMetadata?: ColorMetadata;
  embeddingPending?: EmbeddingPendingEntry;
  altLoading: boolean;
  displayNameLoading: boolean;
  // Actions
  onToggleSelection: (imageId: string) => void;
  onStartEdit: (image: CloudflareImage) => void;
  onDelete: (imageId: string) => void;
  onGenerateAlt: (imageId: string) => void;
  onGenerateDisplayName: (imageId: string) => void;
  onCopyUrl: (imageId: string) => void;
  onCopyNamespace: (namespace: string) => void;
  onSelectColor?: (hex: string) => void;
  onBeforeNavigate?: (imageId: string) => void;
  galleryReturnHrefSuffix?: string;
  // Hover preview
  onMouseEnter: (imageId: string, event: React.MouseEvent) => void;
  onMouseMove: (imageId: string, event: React.MouseEvent) => void;
  onMouseLeave: () => void;
}

const handleImageDragStart = (e: React.DragEvent, image: CloudflareImage) => {
  e.stopPropagation();
  const filename = (image.filename || `image-${image.id}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const cdnUrl = getCloudflareImageUrl(image.id, 'original');
  const { mime } = getCloudflareDownloadUrl(image.id, filename);

  e.dataTransfer.clearData();
  e.dataTransfer.setData('DownloadURL', `${mime}:${filename}:${cdnUrl}`);
  e.dataTransfer.setData('text/plain', cdnUrl);
  e.dataTransfer.setData('text/uri-list', cdnUrl);
  e.dataTransfer.effectAllowed = 'copy';
};

export const ImageCard: React.FC<ImageCardProps> = ({
  image,
  selectedVariant,
  respectAspectRatio,
  isSelected,
  bulkSelectionMode,
  isDuplicate,
  variationChildren,
  colorMetadata,
  embeddingPending,
  altLoading,
  displayNameLoading,
  onToggleSelection,
  onStartEdit,
  onDelete,
  onGenerateAlt,
  onGenerateDisplayName,
  onCopyUrl,
  onCopyNamespace,
  onSelectColor,
  onBeforeNavigate,
  galleryReturnHrefSuffix,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
}) => {
  const isVideoAsset = image.assetType === 'video';
  const svgImage = isSvgImage(image);
  const isComfyOutput = image.generatedBy === 'comfyui' || image.comfyMetadataDetected === true;
  const imageUrl = isVideoAsset
    ? image.videoThumbnailUrl || image.videoPreviewUrl || image.videoPlaybackUrl || image.videoHlsUrl || ''
    : getCloudflareImageUrl(image.id, selectedVariant === 'public' ? 'original' : selectedVariant);
  const displayUrl = isVideoAsset
    ? imageUrl
    : (svgImage ? getCloudflareImageUrl(image.id, 'original') : imageUrl);
  const fileSizeLabel = formatBytes(image.size);
  const swatchAverageColor = colorMetadata?.averageColor ?? image.averageColor;
  const swatchDominantColors = colorMetadata?.dominantColors ?? image.dominantColors;
  const detailHref = isVideoAsset
    ? `/videos/${image.id}${galleryReturnHrefSuffix ?? ''}`
    : `/images/${image.id}${galleryReturnHrefSuffix ?? ''}`;

  return (
    <div
      className={`z-0 group bg-gray-100 rounded-lg overflow-hidden flex flex-col h-full border ${
        isSelected ? 'border-blue-500 ring-2 ring-blue-400' : 'border-transparent'
      } ${bulkSelectionMode ? 'cursor-pointer' : ''}`}
    >
      <Link
        href={detailHref}
        className={`relative block w-full ${respectAspectRatio ? '' : 'aspect-square'}`}
        style={
          respectAspectRatio && image.dimensions
            ? { paddingBottom: `${(image.dimensions.height / image.dimensions.width) * 100}%` }
            : respectAspectRatio
              ? { paddingBottom: '75%' }
              : undefined
        }
        onClick={(e) => {
          if (bulkSelectionMode) {
            e.preventDefault();
            onToggleSelection(image.id);
            return;
          }
          if (isVideoAsset) {
            onBeforeNavigate?.(image.id);
            return;
          }
          onBeforeNavigate?.(image.id);
        }}
        onMouseEnter={(e) => {
          if (!isVideoAsset) onMouseEnter(image.id, e);
        }}
        onMouseMove={(e) => {
          if (!isVideoAsset) onMouseMove(image.id, e);
        }}
        onMouseLeave={() => {
          if (!isVideoAsset) onMouseLeave();
        }}
        prefetch={false}
      >
        {isVideoAsset ? (
          <>
            {displayUrl ? (
              <img
                src={displayUrl}
                alt={image.displayName || image.filename}
                className={`absolute inset-0 w-full h-full ${respectAspectRatio ? 'object-contain bg-white' : 'object-cover'}`}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-200 text-[0.65rem] text-gray-600">
                Video
              </div>
            )}
            <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[0.6rem] font-semibold text-white">
              VIDEO
            </div>
          </>
        ) : svgImage ? (
          <img
            draggable
            onDragStart={(e) => handleImageDragStart(e, image)}
            src={displayUrl}
            alt={image.displayName || image.filename}
            className={`absolute inset-0 w-full h-full ${respectAspectRatio ? 'object-contain bg-white' : 'object-cover'}`}
          />
        ) : (
          <Image
            draggable
            onDragStart={(e) => handleImageDragStart(e, image)}
            src={displayUrl}
            alt={image.displayName || image.filename}
            fill
            className={respectAspectRatio ? 'object-contain bg-gray-50' : 'object-cover'}
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        )}
        {bulkSelectionMode && (
          <label className="absolute top-2 left-2 flex items-center gap-1 text-[0.65rem] font-mono bg-white/90 px-2 py-1 rounded-md shadow cursor-pointer">
            <input
              type="checkbox"
              checked={isSelected}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation();
                onToggleSelection(image.id);
              }}
              className="h-3 w-3"
            />
            Select
          </label>
        )}
        {!bulkSelectionMode && hasSearchExclusionTag(image.tags) && (
          <div
            className="absolute top-2 left-2 p-1 bg-black/70 rounded-md shadow"
            title={getExclusionTooltip(image.tags)}
          >
            <SearchExclusionIcon className="h-4 w-4 text-white" title={getExclusionTooltip(image.tags)} />
          </div>
        )}
        {isComfyOutput && (
          <div
            id={`image-card-comfy-indicator-${image.id}`}
            className="absolute top-2 right-2 inline-flex items-center justify-center rounded-md border border-gray-200 bg-white/95 p-1 shadow"
            title="ComfyUI output detected"
            aria-label="ComfyUI output detected"
          >
            <Image
              src="/icons/comfyui.svg"
              alt="ComfyUI"
              width={12}
              height={12}
              className="h-3 w-3"
            />
          </div>
        )}
      </Link>

      {/* Metadata footer */}
      <div id="metadata-footer" className="px-3 py-2 bg-white border-t border-gray-100 flex-1 flex flex-col">
        <div className="flex-1 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <p
              className="text-[0.6rem] font-mono font-semibold text-gray-900 truncate"
              title={image.displayName || image.filename}
              style={{ lineHeight: '1.2' }}
            >
              {image.displayName || image.filename}
            </p>
            <EmbeddingStatusDot
              hasClipEmbedding={image.hasClipEmbedding}
              hasColorEmbedding={image.hasColorEmbedding}
              pendingStatus={embeddingPending?.status}
              size={8}
            />
            {isDuplicate && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-amber-800">
                <AlertTriangle className="h-3 w-3" />
                Duplicate
              </span>
            )}
          </div>
          <div className="text-gray-500 text-[0.6rem] mt-1 space-y-0.5">
            <p>{new Date(image.uploaded).toLocaleDateString()}</p>
            <p className="font-mono text-[0.55rem] text-gray-400">
              {new Date(image.uploaded).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </p>
            {isVideoAsset && (
              <p>🎬 {image.videoStatus || 'pending'}</p>
            )}
            <p>📦 {fileSizeLabel}</p>
            <p>📁 {image.folder ? image.folder : '[none]'}</p>
            <p className="flex items-center gap-1">
              <span>🧭 {image.namespace ? image.namespace : '[none]'}</span>
              {image.namespace && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCopyNamespace(image.namespace!);
                  }}
                  className="inline-flex items-center text-gray-400 hover:text-gray-600"
                  title="Copy namespace"
                  aria-label="Copy namespace"
                >
                  <Copy className="h-3 w-3" />
                </button>
              )}
            </p>
            <AspectRatioDisplay imageId={image.id} aspectRatio={image.aspectRatio} />
            {image.tags && image.tags.length > 0 ? (
              <p>
                🏷️ {image.tags.slice(0, 2).join(', ')}
                {image.tags.length > 2 ? '...' : ''}
              </p>
            ) : (
              <p className="text-gray-400">🏷️ [no tags]</p>
            )}
            {variationChildren && variationChildren.length > 0 && (
              <p className="text-[0.6rem] text-blue-600 flex items-center gap-1" title="Has variations">
                <Layers className="h-3.5 w-3.5" />
                {variationChildren.length} variation{variationChildren.length > 1 ? 's' : ''}
              </p>
            )}
            {/* Color metadata display */}
            <ColorSwatches
              dominantColors={swatchDominantColors}
              averageColor={swatchAverageColor}
              size="compact"
              showLabels={true}
              className="mt-1"
              onSelectColor={onSelectColor}
            />
          </div>
        </div>
        <div className="pt-2">
          {!isVideoAsset && (
            <div className="inline-flex w-full rounded-md overflow-hidden border border-gray-900">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onGenerateAlt(image.id);
                }}
                disabled={altLoading}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-gray-900 text-white px-2 py-1.5 text-[0.6rem] transition hover:bg-black disabled:opacity-50"
                title="Generate ALT text"
                aria-label="Generate ALT text"
              >
                <Sparkles className="text-[0.8rem] h-3.5 w-3.5" />
                {altLoading ? 'Generating ALT...' : image.altTag ? 'Refresh ALT' : 'Gen ALT text'}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onGenerateDisplayName(image.id);
                }}
                disabled={displayNameLoading}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-gray-800 text-white px-2 py-1.5 text-[0.6rem] transition hover:bg-gray-900 disabled:opacity-50 border-l border-gray-700"
                title="Generate display name"
                aria-label="Generate display name"
              >
                <Sparkles className="text-[0.8rem] h-3.5 w-3.5" />
                {displayNameLoading ? 'Generating…' : 'Gen DSP name'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="grid grid-cols-5 gap-1 p-1.5 bg-white border-b border-gray-200 z-30 mt-auto">
        <button
          onClick={async (e) => {
            e.stopPropagation();
            try {
              await navigator.clipboard.writeText(image.id);
            } catch (error) {
              console.error('Failed to copy image ID', error);
            }
          }}
          className="h-8 w-full inline-flex items-center justify-center rounded-md bg-black text-white text-[0.55rem] font-semibold tracking-wide shadow-sm transition-colors hover:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-black/40"
          title="Copy image ID"
          aria-label="Copy image ID"
        >
          ID
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopyUrl(image.id);
          }}
          className="h-8 w-full inline-flex items-center justify-center rounded-md bg-black text-white shadow-sm transition-colors hover:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-black/40"
          title="Copy URL"
          aria-label="Copy URL"
        >
          <Copy className="h-[12px] w-[12px]" />
        </button>
        <button
          onClick={() => window.open(isVideoAsset ? `/videos/${image.id}` : `/images/${image.id}`, '_blank')}
          className="h-8 w-full inline-flex items-center justify-center rounded-md bg-black text-white shadow-sm transition-colors hover:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-black/40"
          title={isVideoAsset ? "Open video detail" : "Open in new tab"}
          aria-label={isVideoAsset ? "Open video detail" : "Open in new tab"}
        >
          <ExternalLink className="h-[12px] w-[12px]" />
        </button>
        <button
          onClick={() => onStartEdit(image)}
          className="h-8 w-full inline-flex items-center justify-center rounded-md bg-black text-white shadow-sm transition-colors hover:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-black/40"
          title="Edit folder/tags"
          aria-label="Edit folder/tags"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 20 20">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
        </button>
        <button
          onClick={() => onDelete(image.id)}
          className="h-8 w-full inline-flex items-center justify-center rounded-md border border-red-300 bg-white text-red-600 shadow-sm transition-colors hover:bg-red-50 focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-red-300"
          title={isVideoAsset ? "Delete video" : "Delete image"}
          aria-label={isVideoAsset ? "Delete video" : "Delete image"}
        >
          <Trash2 className="h-[12px] w-[12px]" />
        </button>
      </div>
    </div>
  );
};
