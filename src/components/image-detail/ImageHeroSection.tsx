import type { CSSProperties, DragEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ExternalLink, RotateCcw, RotateCw } from 'lucide-react';
import type { CloudflareImage } from './types';

export const ImageHeroSection = ({
  image,
  originalDeliveryUrl,
  heroRotationStyle,
  normalizedRotation,
  rotationLoading,
  rotationError,
  rotatedAsset,
  onDragStart,
  onAdjustRotation,
  onConfirmRotation,
  onCopyText,
}: {
  image: CloudflareImage;
  originalDeliveryUrl: string;
  heroRotationStyle: CSSProperties;
  normalizedRotation: number;
  rotationLoading: boolean;
  rotationError: string | null;
  rotatedAsset: { id: string; url: string; info?: string } | null;
  onDragStart: (event: DragEvent<HTMLImageElement>, image: CloudflareImage) => void;
  onAdjustRotation: (delta: number) => void;
  onConfirmRotation: () => void;
  onCopyText: (text: string, message: string) => Promise<void>;
}) => (
  <div id="image-hero-section" className="w-full mb-4">
    <div className="relative w-full aspect-[3/2] bg-gray-100 rounded overflow-hidden group">
      <Image
        draggable
        onDragStart={(event) => onDragStart(event, image)}
        src={originalDeliveryUrl}
        alt={image.filename || 'image'}
        fill
        className="object-contain"
        unoptimized
        priority
        style={heroRotationStyle}
      />
      <button
        type="button"
        onClick={() => {
          const width = Math.min(900, window.screen.width * 0.6);
          const height = Math.min(700, window.screen.height * 0.6);
          const left = (window.screen.width - width) / 2;
          const top = (window.screen.height - height) / 2;
          window.open(
            originalDeliveryUrl,
            `drag_${image.id}`,
            `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`
          );
        }}
        title="Open image in a popup window for easy drag-and-drop to other apps"
        className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-black/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <ExternalLink className="h-4 w-4" />
      </button>
    </div>
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-gray-600">Rotation preview</span>
        <span className="text-gray-500">{normalizedRotation} deg</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onAdjustRotation(-90)}
          disabled={rotationLoading}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCcw className="h-4 w-4" />
          Left
        </button>
        <button
          type="button"
          onClick={() => onAdjustRotation(90)}
          disabled={rotationLoading}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCw className="h-4 w-4" />
          Right
        </button>
        <button
          type="button"
          onClick={onConfirmRotation}
          disabled={rotationLoading || normalizedRotation === 0}
          className="inline-flex items-center gap-1 px-4 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {rotationLoading ? 'Rotating...' : 'Confirm rotation'}
        </button>
      </div>
      {rotationError && <p className="text-[11px] text-red-600">{rotationError}</p>}
      {rotatedAsset && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-[11px] text-blue-900 space-y-1">
          <p className="font-semibold text-blue-800">Rotated asset created</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onCopyText(rotatedAsset.url, 'Rotated URL copied')}
              className="px-2 py-1 border border-blue-200 rounded text-[11px] text-blue-700 hover:border-blue-300"
            >
              Copy new CDN URL
            </button>
            <Link href={`/images/${rotatedAsset.id}`} className="text-[11px] text-blue-700 underline" prefetch={false}>
              View rotated asset
            </Link>
          </div>
          <p className="text-[10px] text-blue-700 leading-snug break-all">{rotatedAsset.url}</p>
          <p className="text-[10px] text-blue-700">
            Update any existing references because the Cloudflare delivery URL changed.
          </p>
          {rotatedAsset.info && <p className="text-[10px] text-blue-600 italic">{rotatedAsset.info}</p>}
        </div>
      )}
    </div>
  </div>
);
