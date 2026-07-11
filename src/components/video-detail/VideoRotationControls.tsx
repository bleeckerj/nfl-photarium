'use client';

import Link from 'next/link';
import { RotateCcw, RotateCw } from 'lucide-react';
import type { RotatedVideoAsset } from '@/components/video-detail/useVideoRotation';

export function VideoRotationControls({
  normalizedRotation,
  loading,
  error,
  rotatedAsset,
  onAdjust,
  onConfirm,
}: {
  normalizedRotation: number;
  loading: boolean;
  error: string | null;
  rotatedAsset: RotatedVideoAsset | null;
  onAdjust: (delta: -90 | 90) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-gray-600">Rotation preview</span>
        <span className="text-gray-500">{normalizedRotation} deg</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onAdjust(-90)}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:border-gray-300 disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" /> Left
        </button>
        <button
          type="button"
          onClick={() => onAdjust(90)}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:border-gray-300 disabled:opacity-50"
        >
          <RotateCw className="h-4 w-4" /> Right
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading || normalizedRotation === 0}
          className="rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Rotating and uploading…' : 'Confirm rotation'}
        </button>
      </div>
      {loading && (
        <p className="text-[11px] text-gray-600">Downloading the Stream MP4, encoding the rotation, and uploading a new asset.</p>
      )}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {rotatedAsset && (
        <div className="rounded border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-900">
          <p className="font-semibold">Rotated video created</p>
          <Link href={`/videos/${rotatedAsset.id}`} className="text-blue-700 underline" prefetch={false}>
            View {rotatedAsset.filename}
          </Link>
        </div>
      )}
    </div>
  );
}
