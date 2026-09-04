import React from 'react';
import type { ExifPushMode } from '@/hooks/useExifPropagation';

export function ExifSection(props: {
  exifEntries: Array<[string, string | number]>;
  /** Human label for where a push lands, e.g. "variations" or "parent + siblings". */
  exifPushTargetLabel?: string;
  exifPushTargetCount?: number;
  exifPushing?: boolean;
  onPushExif?: (mode: ExifPushMode) => void;
}) {
  const {
    exifEntries,
    exifPushTargetLabel,
    exifPushTargetCount = 0,
    exifPushing = false,
    onPushExif,
  } = props;

  if (exifEntries.length === 0) {
    return null;
  }

  const canPush = Boolean(onPushExif) && exifPushTargetCount > 0;

  return (
    <div id="exif-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-xs font-mono font-medum text-gray-700">EXIF</p>
          <p className="text-[10px] text-gray-500">{exifEntries.length} fields</p>
        </div>
        {canPush && (
          <button
            type="button"
            onClick={(event) => onPushExif?.(event.shiftKey ? 'overwrite' : 'fill-missing')}
            disabled={exifPushing}
            title="Copies these EXIF fields to family members that have none. Shift+click to overwrite existing EXIF."
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
          >
            {exifPushing
              ? 'Pushing…'
              : `Push to ${exifPushTargetCount} ${exifPushTargetLabel ?? 'family member(s)'}`}
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {exifEntries.map(([key, value]) => (
          <div
            key={key}
            className="flex items-start justify-between gap-3 border rounded px-2 py-1 text-[11px]"
          >
            <span className="text-gray-600 font-mono">{key}</span>
            <span className="text-gray-900 font-mono break-all text-right">{value}</span>
          </div>
        ))}
      </div>
      {canPush && (
        <p className="mt-1 text-[10px] text-gray-500">Tip: Shift+click Push overwrites existing EXIF.</p>
      )}
    </div>
  );
}
