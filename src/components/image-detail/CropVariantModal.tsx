'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Crop, Loader2, Sparkles, X } from 'lucide-react';
import type { CloudflareImage } from '@/components/image-detail/types';
import {
  createCropVariant,
  type CropVariantAnchor,
  type CropVariantMode,
  type CropVariantPlacement,
  type CropVariantResponse,
} from '@/services/cropVariantService';
import {
  acceptImageToolPreview,
  createImageToolPreview,
  getAspectRatioExpansionProviders,
  getImageToolPreview,
  type AspectRatioExpansionProviderStatus,
  type ImageToolPreview,
} from '@/services/imageToolsService';

type RatioOption = {
  label: string;
  value: string;
};

type CropVariantModalProps = {
  image: CloudflareImage;
  previewUrl?: string;
  onClose: () => void;
  onCreated: (result: CropVariantResponse) => void | Promise<void>;
  onAccepted?: () => void | Promise<void>;
};

type ExpansionProvider = 'auto' | 'openai' | 'comfyui';

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

const HORIZONTAL_PLACEMENTS: Array<{ label: string; value: CropVariantPlacement }> = [
  { label: 'Left', value: 'left' },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'right' },
];

const VERTICAL_PLACEMENTS: Array<{ label: string; value: CropVariantPlacement }> = [
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

function alignUp(value: number, multiple: number) {
  return Math.ceil(value / multiple) * multiple;
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
  onAccepted,
}: CropVariantModalProps) {
  const [mode, setMode] = useState<CropVariantMode>('crop');
  const [ratioPreset, setRatioPreset] = useState('1:1');
  const [customRatio, setCustomRatio] = useState('4:5');
  const [anchor, setAnchor] = useState<CropVariantAnchor>('center');
  const [placement, setPlacement] = useState<CropVariantPlacement>('center');
  const [quality, setQuality] = useState(90);
  const [provider, setProvider] = useState<ExpansionProvider>('auto');
  const [instructions, setInstructions] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [seedInput, setSeedInput] = useState('');
  const [filename, setFilename] = useState(buildDefaultFilename(image));
  const [description, setDescription] = useState(image.description || '');
  const [tagsInput, setTagsInput] = useState((image.tags || []).join(', '));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImageToolPreview | null>(null);
  const [providerStatuses, setProviderStatuses] = useState<AspectRatioExpansionProviderStatus[]>([]);
  const [providerStatusError, setProviderStatusError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAspectRatioExpansionProviders()
      .then((statuses) => {
        if (!cancelled) setProviderStatuses(statuses);
      })
      .catch((err) => {
        if (!cancelled) setProviderStatusError(err instanceof Error ? err.message : 'Provider availability could not be loaded');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!preview || preview.status === 'completed' || preview.status === 'failed') return;
    const timer = window.setInterval(() => {
      getImageToolPreview(preview.id)
        .then((nextPreview) => {
          setPreview(nextPreview);
          if (nextPreview.status === 'failed') {
            setError(nextPreview.error || nextPreview.message);
          }
        })
        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to refresh expansion preview'));
    }, 900);
    return () => window.clearInterval(timer);
  }, [preview]);

  const clearGeneratedPreview = () => {
    setPreview(null);
    setError(null);
  };

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

  const expandGeometry = useMemo(() => {
    if (!ratio || !sourceWidth || !sourceHeight) {
      return null;
    }
    const targetRatio = ratio.width / ratio.height;
    const sourceRatio = sourceWidth / sourceHeight;
    let targetWidth = sourceWidth;
    let targetHeight = sourceHeight;
    if (sourceRatio < targetRatio) {
      targetWidth = Math.ceil(sourceHeight * targetRatio);
    } else if (sourceRatio > targetRatio) {
      targetHeight = Math.ceil(sourceWidth / targetRatio);
    }
    targetWidth = alignUp(targetWidth, 16);
    targetHeight = alignUp(targetHeight, 16);
    const extraX = Math.max(0, targetWidth - sourceWidth);
    const extraY = Math.max(0, targetHeight - sourceHeight);
    const x = placement === 'left' ? 0 : placement === 'right' ? extraX : Math.round(extraX / 2);
    const y = placement === 'top' ? 0 : placement === 'bottom' ? extraY : Math.round(extraY / 2);
    return {
      targetWidth,
      targetHeight,
      sourceLeftPercent: (x / targetWidth) * 100,
      sourceTopPercent: (y / targetHeight) * 100,
      sourceWidthPercent: (sourceWidth / targetWidth) * 100,
      sourceHeightPercent: (sourceHeight / targetHeight) * 100,
      expandsHorizontal: extraX > 0,
      expandsVertical: extraY > 0,
    };
  }, [placement, ratio, sourceHeight, sourceWidth]);

  const canSubmit = Boolean(ratio && (mode === 'outpaint' || !previewGeometry || previewGeometry.fits));
  const outputLabel = mode === 'outpaint' && expandGeometry
    ? `${expandGeometry.targetWidth} x ${expandGeometry.targetHeight}`
    : sourceWidth && previewGeometry?.targetHeight
    ? `${sourceWidth} x ${previewGeometry.targetHeight}`
    : 'resolved on upload';
  const placementOptions = expandGeometry?.expandsHorizontal && !expandGeometry.expandsVertical
    ? HORIZONTAL_PLACEMENTS
    : VERTICAL_PLACEMENTS;
  const previewAspectRatio = mode === 'outpaint' && expandGeometry
    ? `${expandGeometry.targetWidth} / ${expandGeometry.targetHeight}`
    : sourceWidth && sourceHeight
      ? `${sourceWidth} / ${sourceHeight}`
      : '4 / 3';

  const selectedProviderStatus = provider === 'auto'
    ? undefined
    : providerStatuses.find((status) => status.id === provider);
  const expansionPreviewReady = mode === 'outpaint' && preview?.status === 'completed' && Boolean(preview.artifactUrl);

  const handleSubmit = async () => {
    if (!ratio || !canSubmit || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'outpaint') {
        if (expansionPreviewReady && preview) {
          await acceptImageToolPreview(preview.id);
          await onAccepted?.();
          onClose();
          return;
        }

        const seed = seedInput.trim() ? Number(seedInput) : undefined;
        if (seedInput.trim() && !Number.isFinite(seed as number)) {
          throw new Error('Seed must be a number');
        }
        const nextPreview = await createImageToolPreview({
          toolId: 'aspect-ratio-expand',
          imageId: image.id,
          request: {
            effectId: 'expand',
            params: {
              provider,
              aspectRatio: ratio.label,
              placement,
              instructions: instructions.trim(),
              negativePrompt: negativePrompt.trim(),
              ...(seed === undefined ? {} : { seed }),
              filename: filename.trim(),
              description: description.trim(),
              tags: splitTags(tagsInput) || [],
            },
            output: { mode: 'still', format: 'webp' },
          },
        });
        setPreview(nextPreview);
        if (nextPreview.status === 'failed') {
          setError(nextPreview.error || nextPreview.message);
        }
        return;
      }

      const result = await createCropVariant(image.id, {
        aspectRatio: ratio.label,
        anchor,
        mode,
        placement,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
      <div className="flex max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl sm:max-h-[calc(100dvh-2rem)]">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Crop className="h-4 w-4 text-gray-700" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-gray-900">{mode === 'outpaint' ? 'Expand variant' : 'Crop variant'}</h2>
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

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden md:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-h-[260px] bg-neutral-950 p-3 md:min-h-0 md:p-4">
            <div
              className="relative mx-auto h-full max-h-full max-w-full overflow-hidden bg-neutral-900"
              style={{
                aspectRatio: previewAspectRatio,
              }}
            >
              {expansionPreviewReady && preview?.artifactUrl ? (
                <div className="relative h-full w-full">
                  <img
                    src={preview.artifactUrl}
                    alt="Generated aspect-ratio expansion preview"
                    className="h-full w-full object-contain"
                    draggable={false}
                  />
                  <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px] text-white">
                    Generated preview
                  </span>
                </div>
              ) : mode === 'outpaint' && expandGeometry ? (
                <div
                  className="absolute border-2 border-dashed border-white/80 bg-black"
                  style={{
                    left: `${expandGeometry.sourceLeftPercent}%`,
                    top: `${expandGeometry.sourceTopPercent}%`,
                    width: `${expandGeometry.sourceWidthPercent}%`,
                    height: `${expandGeometry.sourceHeightPercent}%`,
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
                </div>
              ) : previewUrl ? (
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
              {mode === 'crop' && previewGeometry?.fits && (
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

          <div className="flex min-h-0 flex-col border-l border-gray-200">
            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              <section className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Mode
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    { label: 'Crop', value: 'crop' },
                    { label: 'Expand', value: 'outpaint' },
                  ] as Array<{ label: string; value: CropVariantMode }>).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setMode(option.value);
                        clearGeneratedPreview();
                      }}
                      className={`rounded-md border px-2 py-1.5 text-[11px] ${
                        mode === option.value
                          ? 'border-gray-900 bg-gray-900 text-white'
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
                      onClick={() => {
                        setRatioPreset(option.value);
                        clearGeneratedPreview();
                      }}
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
                    onChange={(event) => {
                      setCustomRatio(event.target.value);
                      clearGeneratedPreview();
                    }}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    placeholder="width:height"
                  />
                )}
              </section>

              <section className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  {mode === 'outpaint' ? 'Placement' : 'Anchor'}
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(mode === 'outpaint' ? placementOptions : ANCHORS).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        if (mode === 'outpaint') {
                          setPlacement(option.value as CropVariantPlacement);
                          clearGeneratedPreview();
                        } else {
                          setAnchor(option.value as CropVariantAnchor);
                        }
                      }}
                      className={`rounded-md border px-2 py-1.5 text-[11px] ${
                        (mode === 'outpaint' ? placement : anchor) === option.value
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>

              {mode === 'outpaint' && (
                <section className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Generator
                  </label>
                  <select
                    value={provider}
                    onChange={(event) => {
                      setProvider(event.target.value as ExpansionProvider);
                      clearGeneratedPreview();
                    }}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="auto">Automatic</option>
                    <option value="openai">OpenAI image edit</option>
                    <option value="comfyui">ComfyUI workflow</option>
                  </select>
                  {provider === 'auto' && providerStatuses.length > 0 && (
                    <p className="text-[10px] text-gray-500">
                      Automatic uses the configured provider and prefers OpenAI when available.
                    </p>
                  )}
                  {provider === 'auto' && providerStatuses.length > 0 && !providerStatuses.some((status) => status.available) && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800">
                      No configured expansion provider is currently available.
                    </p>
                  )}
                  {selectedProviderStatus && !selectedProviderStatus.available && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800">
                      {selectedProviderStatus.reason}
                    </p>
                  )}
                  {providerStatusError && (
                    <p className="text-[10px] text-amber-700">{providerStatusError}</p>
                  )}
                </section>
              )}

              {mode === 'outpaint' && (
                <section className="space-y-3">
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      Expansion instructions
                    </span>
                    <textarea
                      value={instructions}
                      onChange={(event) => {
                        setInstructions(event.target.value);
                        clearGeneratedPreview();
                      }}
                      className="min-h-16 w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      placeholder="Optional guidance for the generated area"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      Negative prompt
                    </span>
                    <textarea
                      value={negativePrompt}
                      onChange={(event) => {
                        setNegativePrompt(event.target.value);
                        clearGeneratedPreview();
                      }}
                      className="min-h-14 w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      placeholder="Optional ComfyUI guidance"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      Seed <span className="font-normal normal-case text-gray-400">(optional)</span>
                    </span>
                    <input
                      value={seedInput}
                      onChange={(event) => {
                        setSeedInput(event.target.value);
                        clearGeneratedPreview();
                      }}
                      inputMode="numeric"
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      placeholder="ComfyUI only"
                    />
                  </label>
                </section>
              )}

              {mode === 'crop' && <section className="space-y-2">
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
              </section>}

              <section className="space-y-3">
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Filename
                  </span>
                  <input
                    value={filename}
                    onChange={(event) => {
                      setFilename(event.target.value);
                      clearGeneratedPreview();
                    }}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Description
                  </span>
                  <textarea
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      clearGeneratedPreview();
                    }}
                    className="min-h-20 w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Tags
                  </span>
                  <input
                    value={tagsInput}
                    onChange={(event) => {
                      setTagsInput(event.target.value);
                      clearGeneratedPreview();
                    }}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </section>

              {!ratio && (
                <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                  Use width:height format.
                </p>
              )}
              {mode === 'crop' && previewGeometry && !previewGeometry.fits && (
                <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                  This crop needs {previewGeometry.targetHeight}px height, but the source is {sourceHeight}px tall.
                </p>
              )}
              {mode === 'outpaint' && (
                <p className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-700">
                  Expand keeps the full source image and generates only the added canvas area. Review the preview before accepting it as a variant.
                </p>
              )}
              {preview && preview.status !== 'completed' && preview.status !== 'failed' && (
                <p className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
                  {preview.message || 'Generating preview…'}
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
                  mode === 'outpaint' ? <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> : <Crop className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {mode === 'outpaint'
                  ? expansionPreviewReady ? 'Accept expanded variant' : 'Generate expansion preview'
                  : 'Create variant'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
