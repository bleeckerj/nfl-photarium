import React from 'react';

export function AssetTypeBadge({ assetType }: { assetType?: 'image' | 'video' }) {
  const isVideo = assetType === 'video';
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono ${
        isVideo
          ? 'border-sky-200 bg-sky-50 text-sky-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      }`}
    >
      {isVideo ? 'Video' : 'Image'}
    </span>
  );
}
