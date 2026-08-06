'use client';

import { getCloudflareImageUrl } from '@/utils/imageUtils';
import MonoSelect from '@/components/MonoSelect';

export interface BulkAnimateSectionProps {
  selectedCount: number;
  animationPreviewImages: Array<{ id: string; filename: string }>;
  bulkAnimateOrderMode: 'gallery' | 'reverse-gallery';
  onBulkAnimateOrderModeChange: (value: 'gallery' | 'reverse-gallery') => void;
  bulkAnimateSelectionOrderDiffers: boolean;
  bulkAnimateFps: string;
  onBulkAnimateFpsChange: (value: string) => void;
  onBulkAnimateTouchedChange: (value: boolean) => void;
  bulkAnimateLoop: boolean;
  onBulkAnimateLoopChange: (value: boolean) => void;
  bulkAnimateNamespaceInput: string;
  onBulkAnimateNamespaceInputChange: (value: string) => void;
  animationNamespaceOptions: Array<{ value: string; label: string }>;
  bulkAnimateFilename: string;
  onBulkAnimateFilenameChange: (value: string) => void;
  bulkAnimateLoading: boolean;
  bulkAnimateError: string | null;
  onCreateAnimation: () => void;
}

export function BulkAnimateSection({
  selectedCount, animationPreviewImages, bulkAnimateOrderMode, onBulkAnimateOrderModeChange,
  bulkAnimateSelectionOrderDiffers, bulkAnimateFps, onBulkAnimateFpsChange, onBulkAnimateTouchedChange,
  bulkAnimateLoop, onBulkAnimateLoopChange, bulkAnimateNamespaceInput, onBulkAnimateNamespaceInputChange,
  animationNamespaceOptions, bulkAnimateFilename, onBulkAnimateFilenameChange, bulkAnimateLoading, bulkAnimateError, onCreateAnimation,
}: BulkAnimateSectionProps) {
  return <div className="space-y-2 border-t border-gray-200 pt-3">
    <p className="text-[0.65rem] text-gray-500 uppercase tracking-wide">Animate selection</p>
    <div className="space-y-2">
      <div className="inline-flex overflow-hidden rounded border border-gray-300 text-[0.65rem]">
        {(['gallery', 'reverse-gallery'] as const).map((value) => <button key={value} type="button" onClick={() => onBulkAnimateOrderModeChange(value)} className={`px-2 py-1 ${value === 'reverse-gallery' ? 'border-l border-gray-300 ' : ''}${bulkAnimateOrderMode === value ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{value === 'gallery' ? 'Gallery order' : 'Reverse gallery'}</button>)}
      </div>
      {bulkAnimateSelectionOrderDiffers && <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[0.65rem] text-amber-800">Manual click order differs from gallery order. This animation will follow the order shown below.</p>}
      {animationPreviewImages.length > 0 && <div className="flex gap-2 overflow-x-auto rounded border border-gray-200 bg-gray-50 p-2">{animationPreviewImages.map((image, index) => { let previewUrl = ''; try { previewUrl = getCloudflareImageUrl(image.id, 'w=150'); } catch { previewUrl = ''; } return <div key={image.id} className="w-24 shrink-0 space-y-1"><div className="relative aspect-square overflow-hidden rounded border border-gray-200 bg-white">{previewUrl ? <img src={previewUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-[0.6rem] text-gray-400">no preview</div>}<span className="absolute left-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[0.6rem] text-white">{index + 1}</span></div><p className="truncate text-[0.6rem] text-gray-700" title={image.filename}>{image.filename}</p>{(index === 0 || index === animationPreviewImages.length - 1) && <p className="text-[0.55rem] uppercase tracking-wide text-gray-500">{index === 0 ? 'first frame' : 'last frame'}</p>}</div>; })}</div>}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-[0.65rem] text-gray-600">FPS<input type="number" min="0.1" step="0.5" value={bulkAnimateFps} onChange={(event) => { onBulkAnimateTouchedChange(true); onBulkAnimateFpsChange(event.target.value); }} className="w-20 border border-gray-300 rounded px-2 py-1" /></label>
      <label className="flex items-center gap-2 text-[0.65rem] text-gray-600">Loop<input type="checkbox" checked={bulkAnimateLoop} onChange={(event) => onBulkAnimateLoopChange(event.target.checked)} className="h-3 w-3" /></label>
      <label className="flex items-center gap-2 text-[0.65rem] text-gray-600">Output namespace<MonoSelect value={bulkAnimateNamespaceInput} onChange={onBulkAnimateNamespaceInputChange} options={animationNamespaceOptions} className="w-48" size="sm" /></label>
      <label className="flex items-center gap-2 text-[0.65rem] text-gray-600">Output name<input type="text" value={bulkAnimateFilename} onChange={(event) => onBulkAnimateFilenameChange(event.target.value)} placeholder="animated-webp" className="w-40 border border-gray-300 rounded px-2 py-1" /></label>
    </div>
    <div className="flex items-center gap-3"><button type="button" onClick={onCreateAnimation} disabled={bulkAnimateLoading || selectedCount < 2} className="px-3 py-2 bg-emerald-600 text-white rounded-md disabled:opacity-50">{bulkAnimateLoading ? 'Building…' : 'Create animated WebP'}</button>{bulkAnimateError && <p className="text-[0.65rem] text-red-600">{bulkAnimateError}</p>}</div>
  </div>;
}
