'use client';

import React, { useMemo, useState } from 'react';
import { Crop, Loader2, X } from 'lucide-react';
import type { CloudflareImage } from '@/components/image-detail/types';
import {
  createCropVariant,
  type CropVariantAnchor,
  type CropVariantResponse,
} from '@/services/cropVariantService';

type RatioOption = {
  label: string;
  value: string;
};

type CropVariantModalProps = {
  image: CloudflareImage;
  previewUrl?: string;
  onClose: () => void;
  onCreated: (result: CropVariantResponse) => void | Promise<void>;
};

const RATIO_OPTIONS: RatioOption[] = [
  { label: '1:1', value: '1:1' },
  { label: '3:2', value: '3:2' },
  { label: '4:5', value: '4:5' },
  { label: '5:4', value: '5:4' },
  { label: '9:16', value: '9:16' },
  { label: '16:9', value: '16:9' },
  { label: 'Custom', value: 'custom' },
];

const ANCHORS: Array<{ label: string; value: CropVariantAnchor }> = [
  { label: 'Top', value: 'top' },
  { label: 'Center', value: 'center' },
  { label: 'Bottom', value: 'bottom' },
];

function parseRatio(value: string) {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height, label: value.trim() };
}

function buildDefaultFilename(image: CloudflareImage) {
  const base = (image.displayName || image.filename || image.id).replace(/\.[^.]+$/, '');
  return `${base}-crop`;
}

function splitTags(value: string) {
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.length ? Array.from(new Set(tags)) : undefined;
}

export function CropVariantModal({
  image,
  previewUrl,
  onClose,
  onCreated,
}: CropVariantModalProps) {
  const [ratioPreset, setRatioPreset] = useState('1:1');
  const [customRatio, setCustomRatio] = useState('4:5');
  const [anchor, setAnchor] = useState<CropVariantAnchor>('center');
  const [quality, setQuality] = useState(90);
  const [filename, setFilename] = useState(buildDefaultFilename(image));
  const [description, setDescription] = useState(image.description || '');
  const [tagsInput, setTagsInput] = useState((image.tags || []).join(', '));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedRatio = ratioPreset === 'custom' ? customRatio : ratioPreset;
  const ratio = useMemo(() => parseRatio(resolvedRatio), [resolvedRatio]);
  const sourceWidth = image.dimensions?.width;
  const sourceHeight = image.dimensions?.height;
  const previewGeometry = useMemo(() => {
    if (!ratio || !sourceWidth || !sourceHeight) {
      return null;
    }
    const targetHeight = Math.round(sourceWidth * ratio.height / ratio.width);
    if (targetHeight > sourceHeight) {
      return {
        fits: false as const,
        targetHeight,
        topPercent: 0,
        heightPercent: 100,
      };
    }
    const y = anchor === 'top'
      ? 0
      : anchor === 'center'
        ? Math.round((sourceHeight - targetHeight) / 2)
        : sourceHeight - targetHeight;
    return {
      fits: true as const,
      targetHeight,
      topPercent: (y / sourceHeight) * 100,
      heightPercent: (targetHeight / sourceHeight) * 100,
    };
  }, [anchor, ratio, sourceHeight, sourceWidth]);

  const canSubmit = Boolean(ratio && (!previewGeometry || previewGeometry.fits));
  const outputLabel = sourceWidth && previewGeometry?.targetHeight
    ? `${sourceWidth} x ${previewGeometry.targetHeight}`
    : 'resolved on upload';

  const handleSubmit = async () => {
    if (!ratio || !canSubmit || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createCropVariant(image.id, {
        aspectRatio: ratio.label,
        anchor,
        quality,
        filename: filename.trim() ? filename.trim() : undefined,
        description: description.trim() ? description.trim() : undefined,
        tags: splitTags(tagsInput),
      });
      await onCreated(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create crop variant');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Crop className="h-4 w-4 text-gray-700" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Crop variant</h2>
              <p className="text-[11px] text-gray-500">{image.displayName || image.filename}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label="Close crop variant modal"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-h-[420px] bg-neutral-950 p-4">
            <div
              className="relative mx-auto max-h-[68vh] max-w-full overflow-hidden bg-neutral-900"
              style={{
                aspectRatio: sourceWidth && sourceHeight ? `${sourceWidth} / ${sourceHeight}` : '4 / 3',
              }}
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt=""
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                  Preview unavailable
                </div>
              )}
              {previewGeometry?.fits && (
                <div
                  className="pointer-events-none absolute left-0 w-full border-2 border-white"
                  style={{
                    top: `${previewGeometry.topPercent}%`,
                    height: `${previewGeometry.heightPercent}%`,
                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.52)',
                  }}
                />
              )}
            </div>
          </div>

          <div className="flex flex-col border-l border-gray-200">
            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Ratio
                  </label>
                  <span className="text-[11px] text-gray-500">{outputLabel}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {RATIO_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setRatioPreset(option.value)}
                      className={`rounded-md border px-2 py-1.5 text-[11px] ${
                        ratioPreset === option.value
                          ? 'border-gray-900 bg-gray-900 text-white'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {ratioPreset === 'custom' && (
                  <input
                    value={customRatio}
                    onChange={(event) => setCustomRatio(event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    placeholder="width:height"
                  />
                )}
              </section>

              <section className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Anchor
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {ANCHORS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setAnchor(option.value)}
                      className={`rounded-md border px-2 py-1.5 text-[11px] ${
                        anchor === option.value
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="crop-quality" className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Quality
                  </label>
                  <span className="text-[11px] text-gray-500">{quality}</span>
                </div>
                <input
                  id="crop-quality"
                  type="range"
                  min={1}
                  max={100}
                  value={quality}
                  onChange={(event) => setQuality(Number(event.target.value))}
                  className="w-full"
                />
              </section>

              <section className="space-y-3">
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Filename
                  </span>
                  <input
                    value={filename}
                    onChange={(event) => setFilename(event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Description
                  </span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="min-h-20 w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Tags
                  </span>
                  <input
                    value={tagsInput}
                    onChange={(event) => setTagsInput(event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </section>

              {!ratio && (
                <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                  Use width:height format.
                </p>
              )}
              {previewGeometry && !previewGeometry.fits && (
                <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                  This crop needs {previewGeometry.targetHeight}px height, but the source is {sourceHeight}px tall.
                </p>
              )}
              {error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-200 p-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit || submitting}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Crop className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Create variant
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
