import React from 'react';
import {
  Aperture,
  CalendarClock,
  Camera,
  CircleDot,
  Factory,
  Focus,
  Gauge,
  Info,
  MessageSquareText,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import type { ExifPushMode } from '@/hooks/useExifPropagation';
import { formatExifDisplayValue } from './exifPresentation';

const exifFields: Record<string, { label: string; icon: LucideIcon }> = {
  make: { label: 'Camera make', icon: Factory },
  model: { label: 'Camera model', icon: Camera },
  lens: { label: 'Lens', icon: CircleDot },
  dateTimeOriginal: { label: 'Captured', icon: CalendarClock },
  exposureTime: { label: 'Exposure time', icon: Timer },
  fNumber: { label: 'Aperture', icon: Aperture },
  iso: { label: 'ISO', icon: Gauge },
  focalLength: { label: 'Focal length', icon: Focus },
  userComment: { label: 'Comment', icon: MessageSquareText },
};

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

  const canPush = exifEntries.length > 0 && Boolean(onPushExif) && exifPushTargetCount > 0;

  return (
    <section id="exif-section" aria-labelledby="exif-heading" className="rounded-lg border border-gray-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 id="exif-heading" className="text-sm font-semibold text-gray-900">Camera &amp; capture</h2>
          <span className="text-xs text-gray-500">EXIF · {exifEntries.length} fields</span>
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
      {exifEntries.length > 0 ? (
        <dl className="mt-2 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {exifEntries.map(([key, value]) => {
            const field = exifFields[key];
            const Icon = field?.icon ?? Info;
            return (
              <div key={key} className={`min-w-0 border-b border-gray-100 py-2 ${key === 'userComment' ? 'sm:col-span-2' : ''}`}>
                <dt className="flex items-center gap-1.5 text-xs text-gray-600">
                  <Icon aria-hidden="true" className="h-3.5 w-3.5 flex-none text-gray-400" />
                  {field?.label ?? key}
                </dt>
                <dd className="mt-0.5 break-words pl-5 text-sm text-gray-900">{formatExifDisplayValue(key, value)}</dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-gray-600">No camera EXIF is stored for this image.</p>
      )}
      {canPush && (
        <p className="mt-2 text-xs text-gray-500">Shift+click Push to overwrite existing EXIF.</p>
      )}
    </section>
  );
}
