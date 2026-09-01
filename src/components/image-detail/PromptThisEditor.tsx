import React from 'react';
import { Sparkles } from 'lucide-react';
import type { PromptThisDetailLevel } from '@/server/promptThisOptions';

export function PromptThisEditor(props: {
  promptThisInput: string;
  setPromptThisInput: (value: string) => void;
  promptThisLoading: boolean;
  promptThisGenerating: boolean;
  promptThisSaving?: boolean;
  promptThisMeta: {
    saved?: boolean;
    updatedAt?: string;
    model?: string;
    detailLevel?: PromptThisDetailLevel;
    promptNuance?: string;
  } | null;
  promptDetailLevel: PromptThisDetailLevel;
  setPromptDetailLevel: (value: PromptThisDetailLevel) => void;
  promptNuance: string;
  setPromptNuance: (value: string) => void;
  onGenerate: (force?: boolean) => void;
  onCopy: () => void;
}) {
  const {
    promptThisInput,
    setPromptThisInput,
    promptThisLoading,
    promptThisGenerating,
    promptThisSaving,
    promptThisMeta,
    promptDetailLevel,
    setPromptDetailLevel,
    promptNuance,
    setPromptNuance,
    onGenerate,
    onCopy
  } = props;

  return (
    <div id="prompt-this-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-mono font-medum text-gray-700">Prompt This</p>
          <p className="text-[10px] text-gray-500">Generate a text-to-image prompt from the image.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-md border border-gray-200 p-0.5" role="group" aria-label="Prompt detail level">
            {(['standard', 'high'] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setPromptDetailLevel(level)}
                disabled={promptThisGenerating}
                aria-pressed={promptDetailLevel === level}
                className={`px-2.5 py-1 text-xs rounded ${promptDetailLevel === level
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-600 hover:bg-gray-100'} disabled:opacity-50`}
              >
                {level === 'standard' ? 'Standard' : 'High'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onGenerate(Boolean(promptThisInput.trim()))}
            disabled={promptThisGenerating}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {promptThisGenerating ? 'Generating…' : promptThisInput ? 'Refresh Prompt' : 'Generate Prompt'}
          </button>
          <button
            type="button"
            onClick={onCopy}
            disabled={!promptThisInput}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
          >
            Copy
          </button>
          {promptThisSaving && (
            <span className="inline-flex items-center px-2 py-1.5 text-[10px] font-mono text-gray-500">
              Saving…
            </span>
          )}
        </div>
      </div>

      {promptDetailLevel === 'high' && (
        <div className="mt-2">
          <label htmlFor="prompt-this-nuance" className="block text-[10px] font-mono text-gray-600">
            High-detail guidance <span className="text-gray-400">(optional)</span>
          </label>
          <textarea
            id="prompt-this-nuance"
            value={promptNuance}
            onChange={(e) => setPromptNuance(e.target.value)}
            disabled={promptThisGenerating}
            maxLength={2000}
            placeholder="What should the prompt pay particular attention to?"
            className="w-full font-mono text-xs border border-gray-300 rounded-md px-3 py-2 mt-1 bg-white text-gray-800 min-h-[72px] disabled:bg-gray-50"
            rows={3}
          />
          <p className="mt-1 text-[10px] text-gray-400">{promptNuance.length}/2000</p>
        </div>
      )}

      <textarea
        value={promptThisInput}
        onChange={(e) => setPromptThisInput(e.target.value)}
        placeholder={promptThisLoading ? 'Loading…' : 'No prompt yet'}
        className="w-full font-mono text-xs border border-gray-300 rounded-md px-3 py-2 mt-2 bg-white text-gray-800 min-h-[96px]"
        rows={4}
      />

      {promptThisMeta?.updatedAt && (
        <div className="mt-1 text-[10px] text-gray-500">
          Updated: {new Date(promptThisMeta.updatedAt).toLocaleString()}{' '}
          {promptThisMeta?.model ? `• ${promptThisMeta.model}` : ''}
          {promptThisMeta?.detailLevel ? ` • ${promptThisMeta.detailLevel === 'high' ? 'High' : 'Standard'} detail` : ''}
          {promptThisMeta?.saved === false ? '• not saved' : ''}
        </div>
      )}
    </div>
  );
}
