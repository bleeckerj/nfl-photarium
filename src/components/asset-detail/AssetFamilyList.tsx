import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { formatBytes } from '@/utils/formatBytes';
import { getAssetCopyUrl, getAssetDetailPath, getAssetPreviewUrl } from '@/utils/assetUrls';
import { AssetTypeBadge } from '@/components/asset-detail/AssetTypeBadge';

export type FamilyAssetItem = {
  id: string;
  assetType?: 'image' | 'video';
  filename: string;
  displayName?: string;
  uploaded: string;
  size?: number;
  parentId?: string;
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
  variants?: string[];
};

export function AssetFamilyList({
  title,
  assets,
  detachingId,
  deletingId,
  onDetach,
  onDelete,
  onCopyId,
  onCopyUrl,
}: {
  title: string;
  assets: FamilyAssetItem[];
  detachingId: string | null;
  deletingId: string | null;
  onDetach: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onCopyId: (id: string) => void | Promise<void>;
  onCopyUrl: (id: string, url: string) => void | Promise<void>;
}) {
  return (
    <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="text-xs font-mono text-gray-500">count={assets.length}</p>
      </div>
      {assets.length === 0 ? (
        <p className="text-xs text-gray-500">No other variants found in this family.</p>
      ) : (
        <div className="space-y-2">
          {assets.map((asset) => {
            const preview = getAssetPreviewUrl(asset, { imageVariant: 'w=300' });
            const copyUrl = getAssetCopyUrl(asset, { imageVariant: 'original' });
            const displayName = asset.displayName?.trim() || asset.filename || asset.id;
            return (
              <div key={asset.id} className="flex items-center gap-3 rounded border border-gray-200 p-2">
                <Link
                  href={getAssetDetailPath(asset)}
                  className="relative block h-16 w-20 shrink-0 overflow-hidden rounded bg-gray-100"
                >
                  {preview ? (
                    <Image
                      src={preview}
                      alt={displayName}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-500">No preview</div>
                  )}
                </Link>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <AssetTypeBadge assetType={asset.assetType} />
                    <p className="truncate text-xs font-medium text-gray-900">{displayName}</p>
                  </div>
                  <p className="text-[11px] text-gray-500 truncate">{asset.filename}</p>
                  <p className="text-[11px] text-gray-500">
                    Uploaded {new Date(asset.uploaded).toLocaleDateString()} • {formatBytes(asset.size)}
                  </p>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      onClick={() => void onCopyId(asset.id)}
                      className="text-blue-600 hover:underline"
                    >
                      Copy ID
                    </button>
                    <button
                      onClick={() => copyUrl && void onCopyUrl(asset.id, copyUrl)}
                      disabled={!copyUrl}
                      className="text-blue-600 hover:underline disabled:opacity-40"
                    >
                      Copy URL
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => void onDetach(asset.id)}
                    disabled={detachingId === asset.id}
                    className="rounded border border-amber-300 px-2 py-1 text-[11px] text-amber-800 disabled:opacity-50"
                  >
                    {detachingId === asset.id ? 'Detaching…' : 'Detach'}
                  </button>
                  <button
                    onClick={() => void onDelete(asset.id)}
                    disabled={deletingId === asset.id}
                    className="rounded border border-red-300 px-2 py-1 text-[11px] text-red-700 disabled:opacity-50"
                  >
                    {deletingId === asset.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
