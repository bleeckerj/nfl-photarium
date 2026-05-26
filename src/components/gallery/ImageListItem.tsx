/**
 * ImageListItem Component
 * 
 * Displays a single image in the gallery list view.
 */

'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Trash2, Copy, ExternalLink, Sparkles, Layers, AlertTriangle, Star } from 'lucide-react';
import { ColorSwatches } from '@/components/ColorSwatches';
import { getCloudflareImageUrl, getCloudflareDownloadUrl } from '@/utils/imageUtils';
import { formatBytes } from '@/utils/formatBytes';
import { AspectRatioDisplay } from './AspectRatioDisplay';
import { formatShortAssetId, isSvgImage } from './utils';
import type { CloudflareImage, ColorMetadata, GalleryFamilySummary } from './types';
import { getUserVisibleTags, hasFavoriteTag } from '@/utils/systemTags';

interface ImageListItemProps {
  image: CloudflareImage;
  selectedVariant: string;
  isSelected: boolean;
  bulkSelectionMode: boolean;
  isDuplicate: boolean;
  hrefSuffix?: string;
  variationChildren?: CloudflareImage[];
  familySummary?: GalleryFamilySummary;
  colorMetadata?: ColorMetadata;
  altLoading: boolean;
  displayNameLoading: boolean;
  favoriteLoading?: boolean;
  // Actions
  onToggleSelection: (imageId: string) => void;
  onStartEdit: (image: CloudflareImage) => void;
  onDelete: (imageId: string) => void;
  onGenerateAlt: (imageId: string) => void;
  onGenerateDisplayName: (imageId: string) => void;
  onToggleFavorite?: (imageId: string) => void;
  onCopyUrl: (imageId: string) => void;
  onCopyNamespace: (namespace: string) => void;
  onSelectColor?: (hex: string) => void;
  onBeforeNavigate?: (imageId: string) => void;
  onDragStart?: (event: React.DragEvent, image: CloudflareImage) => void;
  isFocusedInGallery?: boolean;
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

export const ImageListItem: React.FC<ImageListItemProps> = ({
  image,
  selectedVariant,
  isSelected,
  bulkSelectionMode,
  isDuplicate,
  hrefSuffix,
  variationChildren,
  familySummary,
  colorMetadata,
  altLoading,
  displayNameLoading,
  favoriteLoading = false,
  onToggleSelection,
  onStartEdit,
  onDelete,
  onGenerateAlt,
  onGenerateDisplayName,
  onToggleFavorite,
  onCopyUrl,
  onCopyNamespace,
  onSelectColor,
  onBeforeNavigate,
  onDragStart,
  isFocusedInGallery = false,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
}) => {
  const isVideoAsset = image.assetType === 'video';
  const svgImage = isSvgImage(image);
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
    ? `/videos/${image.id}${hrefSuffix ?? ''}`
    : `/images/${image.id}${hrefSuffix ?? ''}`;
  const visibleTags = getUserVisibleTags(image.tags);
  const favorite = hasFavoriteTag(image.tags);
  const isVariant = familySummary?.isVariant ?? Boolean(image.parentId);
  const variationCount = familySummary?.variantCount ?? variationChildren?.length ?? 0;
  const parentId = familySummary?.parentId ?? image.parentId;
  const parentDetailHref = parentId && familySummary?.parentAssetType
    ? `${familySummary.parentAssetType === 'video' ? '/videos' : '/images'}/${parentId}${hrefSuffix ?? ''}`
    : undefined;
  const handleDragStart = (event: React.DragEvent) => {
    if (onDragStart) {
      onDragStart(event, image);
      return;
    }
    handleImageDragStart(event, image);
  };

  return (
    <div
      id={`gallery-asset-${image.id}`}
      data-gallery-asset-id={image.id}
      style={isFocusedInGallery ? { scrollMarginTop: '6rem' } : undefined}
      className={`relative flex items-center space-x-4 p-4 border rounded-lg hover:bg-gray-50 ${
        isSelected ? 'border-blue-500 ring-2 ring-blue-400' : 'border-gray-200'
      } ${isFocusedInGallery ? 'border-amber-400 ring-2 ring-amber-300 ring-offset-2' : ''}`}
    >
      {isFocusedInGallery && (
        <div
          className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1 rounded bg-amber-400/95 px-1.5 py-0.5 text-[10px] font-mono text-white shadow-sm pointer-events-none select-none"
          aria-hidden="true"
        >
          <span>↳</span>
          <span>focused</span>
        </div>
      )}
      <Link
        href={detailHref}
        className="w-32 h-32 relative bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 cursor-pointer"
        onMouseEnter={(e) => {
          if (!isVideoAsset) onMouseEnter(image.id, e);
        }}
        onMouseMove={(e) => {
          if (!isVideoAsset) onMouseMove(image.id, e);
        }}
        onMouseLeave={() => {
          if (!isVideoAsset) onMouseLeave();
        }}
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
        prefetch={false}
      >
        {isVideoAsset ? (
          <>
            {displayUrl ? (
              <img
                src={displayUrl}
                alt={image.filename}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[0.65rem] text-gray-600">
                Video
              </div>
            )}
            <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
              VIDEO
            </div>
          </>
        ) : svgImage ? (
          <img
            draggable
            onDragStart={handleDragStart}
            src={displayUrl}
            alt={image.filename}
            className="absolute inset-0 w-full h-full object-contain bg-white"
          />
        ) : (
          <Image
            draggable
            onDragStart={handleDragStart}
            src={displayUrl}
            alt={image.filename}
            fill
            className="object-cover"
            sizes="64px"
          />
        )}
      </Link>
      
      {bulkSelectionMode && (
        <label className="flex items-center gap-2 text-[0.7em] font-mono">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelection(image.id)}
            onClick={(e) => e.stopPropagation()}
            className="h-3 w-3"
          />
          Select
        </label>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p
            className="text-[0.7em] font-mono font-medium text-gray-900 truncate"
            title={image.displayName || image.filename}
          >
            {image.displayName || image.filename}
          </p>
          {isDuplicate && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-amber-800">
              <AlertTriangle className="h-3 w-3" />
              Duplicate
            </span>
          )}
        </div>
        <p className="text-[0.7em] font-mono text-gray-500">
          {new Date(image.uploaded).toLocaleDateString()}
        </p>
        <p className="text-[0.65em] font-mono text-gray-400">
          {new Date(image.uploaded).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </p>
        {isVideoAsset && (
          <p className="text-[0.7em] font-mono text-gray-500">🎬 {image.videoStatus || 'pending'}</p>
        )}
        <p className="text-[0.7em] font-mono text-gray-500">📦 {fileSizeLabel}</p>
        <p className="text-[0.7em] font-mono text-gray-500">📁 {image.folder ? image.folder : '[none]'}</p>
        <p className="text-[0.7em] font-mono text-gray-500 flex items-center gap-1">
          <span>🧭 {image.namespace ? image.namespace : 'Missing namespace'}</span>
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
        <div className="text-[0.7em] font-mono text-gray-500">
          <AspectRatioDisplay imageId={image.id} aspectRatio={image.aspectRatio} />
        </div>
        {visibleTags.length > 0 ? (
          <p className="text-[0.7em] font-mono text-gray-500">🏷️ {visibleTags.join(', ')}</p>
        ) : (
          <p className="text-[0.7em] font-mono text-gray-400">🏷️ [no tags]</p>
        )}
        <p
          className={`text-[0.7em] font-mono mt-1 ${
            image.altTag ? 'text-gray-600' : 'text-gray-400 italic'
          }`}
          title={image.altTag || undefined}
        >
          {image.altTag ? `📝 ${image.altTag}` : 'No ALT text yet'}
        </p>
        {!isVariant && variationCount > 0 && (
          <p className="text-[0.7em] font-mono text-blue-600 flex items-center gap-1 mt-1" title="Has variations">
            <Layers className="h-3.5 w-3.5" />
            {variationCount} variation{variationCount > 1 ? 's' : ''}
          </p>
        )}
        {parentId && (
          <p
            className="text-[0.7em] font-mono text-indigo-600 flex items-center gap-1 mt-1"
            title={`Variant of parent ${parentId}`}
          >
            <Layers className="h-3.5 w-3.5" />
            {parentDetailHref ? (
              <Link href={parentDetailHref} className="hover:underline" prefetch={false}>
                Variant of {formatShortAssetId(parentId)}
              </Link>
            ) : (
              <span>Variant of {formatShortAssetId(parentId)}</span>
            )}
          </p>
        )}
        <ColorSwatches
          dominantColors={swatchDominantColors}
          averageColor={swatchAverageColor}
          showLabels={true}
          className="mt-1.5"
          onSelectColor={onSelectColor}
        />
        {!isVideoAsset && (
          <div className="mt-2 inline-flex overflow-hidden rounded-md border border-gray-200">
            <button
              onClick={() => onGenerateAlt(image.id)}
              disabled={altLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-[0.7em] font-mono text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              title="Generate ALT text"
              aria-label="Generate ALT text"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {altLoading ? 'Generating ALT...' : image.altTag ? 'Refresh ALT' : 'Generate ALT'}
            </button>
            <button
              onClick={() => onGenerateDisplayName(image.id)}
              disabled={displayNameLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-[0.7em] font-mono text-gray-700 hover:bg-gray-50 disabled:opacity-50 border-l border-gray-200"
              title="Generate display name"
              aria-label="Generate display name"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {displayNameLoading ? 'Generating…' : 'Gen DSP name'}
            </button>
          </div>
        )}
      </div>

      <div className="flex space-x-2">
        {!isVideoAsset && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite?.(image.id);
            }}
            disabled={favoriteLoading}
            className={`p-2 transition-colors cursor-pointer transition-transform transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 ${
              favorite
                ? 'text-amber-600 hover:text-amber-700 focus:ring-amber-300'
                : 'text-gray-400 hover:text-amber-600 focus:ring-amber-300'
            }`}
            title={favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={`h-[12px] w-[12px] ${favorite ? 'fill-current' : ''}`} />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopyUrl(image.id);
          }}
          className="p-2 text-gray-400 hover:text-blue-600 transition-colors cursor-pointer transition-transform transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
          title="Copy URL"
        >
          <Copy className="h-[12px] w-[12px]" />
        </button>
        <button
          onClick={() => window.open(isVideoAsset ? `/videos/${image.id}` : `/images/${image.id}`, '_blank')}
          className="p-2 text-gray-400 hover:text-green-600 transition-colors cursor-pointer transition-transform transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-300"
          title={isVideoAsset ? "Open video detail" : "Open in new tab"}
        >
          <ExternalLink className="h-[12px] w-[12px]" />
        </button>
        <button
          onClick={() => onStartEdit(image)}
          className="p-2 text-gray-400 hover:text-yellow-600 transition-colors cursor-pointer transition-transform transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-300"
          title="Edit folder/tags"
        >
          <svg className="h-[12px] w-[12px]" fill="none" stroke="currentColor" viewBox="0 0 20 20">
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
          className="p-2 text-gray-400 hover:text-red-600 transition-colors cursor-pointer transition-transform transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-300"
          title={isVideoAsset ? "Delete video" : "Delete image"}
        >
          <Trash2 className="h-[12px] w-[12px]" />
        </button>
      </div>
    </div>
  );
};
