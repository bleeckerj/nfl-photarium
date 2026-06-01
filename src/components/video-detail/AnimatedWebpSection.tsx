import Link from 'next/link';
import { Plus, Trash2, WandSparkles } from 'lucide-react';

import {
  PRESET_MAP,
  formatBytes,
  type GenerationSummary,
  type VariationDraft,
  type VideoRecord,
} from '@/components/video-detail/videoTransforms';

type PresetKey = keyof typeof PRESET_MAP;

interface AnimatedWebpSectionProps {
  videoStatus: VideoRecord['videoStatus'];
  variationDrafts: VariationDraft[];
  generatingAnimatedWebp: boolean;
  generationSummary: GenerationSummary | null;
  onAddVariationDraft: () => void;
  onApplyPreset: (id: string, preset: PresetKey) => void;
  onRemoveVariationDraft: (id: string) => void;
  onUpdateVariationDraft: (id: string, patch: Partial<VariationDraft>) => void;
  onGenerateAnimatedWebp: () => void;
}

export default function AnimatedWebpSection({
  videoStatus,
  variationDrafts,
  generatingAnimatedWebp,
  generationSummary,
  onAddVariationDraft,
  onApplyPreset,
  onRemoveVariationDraft,
  onUpdateVariationDraft,
  onGenerateAnimatedWebp,
}: AnimatedWebpSectionProps) {
  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Animated WebP Variations</h2>
        <button
          type="button"
          onClick={onAddVariationDraft}
          className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-mono text-gray-700 hover:bg-gray-100"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Variation
        </button>
      </div>
      <p className="text-xs font-mono text-gray-600">
        Each row creates one animated WebP output from this video. Start with the balanced values, then lower width/FPS if size is too large.
      </p>
      {videoStatus !== 'ready' && (
        <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs font-mono text-amber-800">
          Video must be ready before conversion. Click Refresh until status is ready.
        </p>
      )}

      <div className="space-y-2">
        {variationDrafts.map((draft, index) => (
          <div key={draft.id} className="space-y-2 rounded border border-gray-200 bg-gray-50 p-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-mono font-semibold text-gray-700">Variation {index + 1}</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onApplyPreset(draft.id, 'preview')}
                  className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-mono text-gray-700 hover:bg-gray-100"
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => onApplyPreset(draft.id, 'balanced')}
                  className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-mono text-gray-700 hover:bg-gray-100"
                >
                  Balanced
                </button>
                <button
                  type="button"
                  onClick={() => onApplyPreset(draft.id, 'quality')}
                  className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-mono text-gray-700 hover:bg-gray-100"
                >
                  Quality
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveVariationDraft(draft.id)}
                  disabled={variationDrafts.length <= 1}
                  className="inline-flex items-center justify-center rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-12">
              <label className="flex flex-col gap-1 text-[11px] font-mono text-gray-700 md:col-span-4">
                Output Filename (optional)
                <input
                  type="text"
                  value={draft.filename}
                  onChange={(event) => onUpdateVariationDraft(draft.id, { filename: event.target.value })}
                  placeholder={`video-${index + 1}.webp`}
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-800"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-mono text-gray-700 md:col-span-2">
                Max Width (px)
                <input
                  type="text"
                  value={draft.maxWidth}
                  onChange={(event) => onUpdateVariationDraft(draft.id, { maxWidth: event.target.value })}
                  placeholder="960"
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-800"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-mono text-gray-700 md:col-span-2">
                Max Size (MB)
                <input
                  type="text"
                  value={draft.maxOutputMb}
                  onChange={(event) => onUpdateVariationDraft(draft.id, { maxOutputMb: event.target.value })}
                  placeholder="6"
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-800"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-mono text-gray-700 md:col-span-2">
                FPS
                <input
                  type="text"
                  value={draft.fps}
                  onChange={(event) => onUpdateVariationDraft(draft.id, { fps: event.target.value })}
                  placeholder="12"
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-800"
                />
              </label>
              <label className="flex items-center gap-2 text-xs font-mono text-gray-700 md:col-span-2">
                <input
                  type="checkbox"
                  checked={draft.loop}
                  onChange={(event) => onUpdateVariationDraft(draft.id, { loop: event.target.checked })}
                />
                Loop
              </label>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onGenerateAnimatedWebp}
        disabled={generatingAnimatedWebp || videoStatus !== 'ready'}
        className="inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-60"
      >
        <WandSparkles className="h-3.5 w-3.5" />
        {generatingAnimatedWebp
          ? `Generating ${variationDrafts.length} Variation${variationDrafts.length === 1 ? '' : 's'}...`
          : `Generate ${variationDrafts.length} Variation${variationDrafts.length === 1 ? '' : 's'}`}
      </button>

      {generationSummary && (
        <div className="space-y-1 rounded border border-gray-200 bg-gray-50 p-2 text-xs font-mono text-gray-700">
          <p>
            generated={generationSummary.createdCount} failed={generationSummary.failedCount} partial={generationSummary.partial ? 'yes' : 'no'}
          </p>
          {generationSummary.variations.map((entry) => (
            <p key={entry.imageId}>
              created={entry.filename} id={entry.imageId} size={formatBytes(entry.bytes)} fps={entry.fps} loop={entry.loop ? 'yes' : 'no'} encoder={entry.encoder || '--'}{' '}
              <Link href={`/images/${entry.imageId}`} className="text-blue-700 underline">open</Link>
            </p>
          ))}
          {generationSummary.errors.map((entry) => (
            <p key={`${entry.index}-${entry.filename}`} className="text-red-700">
              failed={entry.filename} reason={entry.error}
            </p>
          ))}
          {generationSummary.hints.map((hint) => (
            <p key={hint} className="text-amber-800">hint={hint}</p>
          ))}
        </div>
      )}
    </section>
  );
}
