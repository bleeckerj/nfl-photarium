'use client';

import type { ChangeEvent } from 'react';
import type { CropVariantAnchor, CropVariantMode, CropVariantPlacement } from '@/services/cropVariantService';
import type { AspectRatioExpansionProviderStatus, ImageToolPreview } from '@/services/imageToolsService';
import { ANCHORS, RATIO_OPTIONS } from './cropVariantModel';
import type { ExpansionProvider } from './cropVariantModel';

type Geometry = {
  targetHeight: number;
  fits?: boolean;
};

export interface CropVariantFieldsProps {
  mode: CropVariantMode;
  onModeChange: (mode: CropVariantMode) => void;
  ratioPreset: string;
  onRatioPresetChange: (value: string) => void;
  customRatio: string;
  onCustomRatioChange: (value: string) => void;
  outputLabel: string;
  placementOptions: Array<{ label: string; value: CropVariantPlacement }>;
  placement: CropVariantPlacement;
  onPlacementChange: (value: CropVariantPlacement) => void;
  anchor: CropVariantAnchor;
  onAnchorChange: (value: CropVariantAnchor) => void;
  provider: ExpansionProvider;
  onProviderChange: (value: ExpansionProvider) => void;
  providerStatuses: AspectRatioExpansionProviderStatus[];
  selectedProviderStatus?: AspectRatioExpansionProviderStatus;
  providerStatusError: string | null;
  instructions: string;
  onInstructionsChange: (value: string) => void;
  negativePrompt: string;
  onNegativePromptChange: (value: string) => void;
  seedInput: string;
  onSeedInputChange: (value: string) => void;
  quality: number;
  onQualityChange: (value: number) => void;
  filename: string;
  onFilenameChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  tagsInput: string;
  onTagsInputChange: (value: string) => void;
  ratio: { width: number; height: number; label: string } | null;
  previewGeometry: Geometry | null;
  sourceHeight?: number;
  preview: ImageToolPreview | null;
  error: string | null;
  onClearGeneratedPreview: () => void;
}

export function CropVariantFields({
  mode,
  onModeChange,
  ratioPreset,
  onRatioPresetChange,
  customRatio,
  onCustomRatioChange,
  outputLabel,
  placementOptions,
  placement,
  onPlacementChange,
  anchor,
  onAnchorChange,
  provider,
  onProviderChange,
  providerStatuses,
  selectedProviderStatus,
  providerStatusError,
  instructions,
  onInstructionsChange,
  negativePrompt,
  onNegativePromptChange,
  seedInput,
  onSeedInputChange,
  quality,
  onQualityChange,
  filename,
  onFilenameChange,
  description,
  onDescriptionChange,
  tagsInput,
  onTagsInputChange,
  ratio,
  previewGeometry,
  sourceHeight,
  preview,
  error,
  onClearGeneratedPreview,
}: CropVariantFieldsProps) {
  const clearOnChange = (callback: (value: string) => void) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    callback(event.target.value);
    onClearGeneratedPreview();
  };

  return (
    <>
      <section className="space-y-2">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Mode</label>
        <div className="grid grid-cols-2 gap-1.5">
          {([{ label: 'Crop', value: 'crop' }, { label: 'Expand', value: 'outpaint' }] as Array<{ label: string; value: CropVariantMode }>).map((option) => (
            <button key={option.value} type="button" onClick={() => { onModeChange(option.value); onClearGeneratedPreview(); }} className={`rounded-md border px-2 py-1.5 text-[11px] ${mode === option.value ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Ratio</label>
          <span className="text-[11px] text-gray-500">{outputLabel}</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {RATIO_OPTIONS.map((option) => (
            <button key={option.value} type="button" onClick={() => { onRatioPresetChange(option.value); onClearGeneratedPreview(); }} className={`rounded-md border px-2 py-1.5 text-[11px] ${ratioPreset === option.value ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
              {option.label}
            </button>
          ))}
        </div>
        {ratioPreset === 'custom' && <input value={customRatio} onChange={clearOnChange(onCustomRatioChange)} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" placeholder="width:height" />}
      </section>

      <section className="space-y-2">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{mode === 'outpaint' ? 'Placement' : 'Anchor'}</label>
        <div className="grid grid-cols-3 gap-1.5">
          {(mode === 'outpaint' ? placementOptions : ANCHORS).map((option) => (
            <button key={option.value} type="button" onClick={() => { if (mode === 'outpaint') { onPlacementChange(option.value); onClearGeneratedPreview(); } else onAnchorChange(option.value as CropVariantAnchor); }} className={`rounded-md border px-2 py-1.5 text-[11px] ${(mode === 'outpaint' ? placement : anchor) === option.value ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {mode === 'outpaint' && <>
        <section className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Generator</label>
          <select value={provider} onChange={(event) => { onProviderChange(event.target.value as ExpansionProvider); onClearGeneratedPreview(); }} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            <option value="auto">Automatic</option>
            <option value="openai">OpenAI image edit</option>
            <option value="comfyui">ComfyUI workflow</option>
          </select>
          {provider === 'auto' && providerStatuses.length > 0 && <p className="text-[10px] text-gray-500">Automatic uses the configured provider and prefers OpenAI when available.</p>}
          {provider === 'auto' && providerStatuses.length > 0 && !providerStatuses.some((status) => status.available) && <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800">No configured expansion provider is currently available.</p>}
          {selectedProviderStatus && !selectedProviderStatus.available && <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800">{selectedProviderStatus.reason}</p>}
          {providerStatusError && <p className="text-[10px] text-amber-700">{providerStatusError}</p>}
        </section>

        <section className="space-y-3">
          <label className="block space-y-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Expansion instructions</span><textarea value={instructions} onChange={clearOnChange(onInstructionsChange)} className="min-h-16 w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm" placeholder="Optional guidance for the generated area" /></label>
          <label className="block space-y-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Negative prompt</span><textarea value={negativePrompt} onChange={clearOnChange(onNegativePromptChange)} className="min-h-14 w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm" placeholder="Optional ComfyUI guidance" /></label>
          <label className="block space-y-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Seed <span className="font-normal normal-case text-gray-400">(optional)</span></span><input value={seedInput} onChange={clearOnChange(onSeedInputChange)} inputMode="numeric" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" placeholder="ComfyUI only" /></label>
        </section>
      </>}

      {mode === 'crop' && <section className="space-y-2"><div className="flex items-center justify-between"><label htmlFor="crop-quality" className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Quality</label><span className="text-[11px] text-gray-500">{quality}</span></div><input id="crop-quality" type="range" min={1} max={100} value={quality} onChange={(event) => onQualityChange(Number(event.target.value))} className="w-full" /></section>}

      <section className="space-y-3">
        <label className="block space-y-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Filename</span><input value={filename} onChange={clearOnChange(onFilenameChange)} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
        <label className="block space-y-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Description</span><textarea value={description} onChange={clearOnChange(onDescriptionChange)} className="min-h-20 w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
        <label className="block space-y-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Tags</span><input value={tagsInput} onChange={clearOnChange(onTagsInputChange)} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" /></label>
      </section>

      {!ratio && <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">Use width:height format.</p>}
      {mode === 'crop' && previewGeometry && !previewGeometry.fits && <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">This crop needs {previewGeometry.targetHeight}px height, but the source is {sourceHeight}px tall.</p>}
      {mode === 'outpaint' && <p className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-700">Expand keeps the full source image and generates only the added canvas area. Review the preview before accepting it as a variant.</p>}
      {preview && preview.status !== 'completed' && preview.status !== 'failed' && <p className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-600">{preview.message || 'Generating preview…'}</p>}
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p>}
    </>
  );
}

export default CropVariantFields;
