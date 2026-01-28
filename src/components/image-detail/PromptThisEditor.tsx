import React from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';

export function PromptThisEditor(props: {
  promptThisInput: string;
  setPromptThisInput: (value: string) => void;
  promptThisLoading: boolean;
  promptThisGenerating: boolean;
  promptThisMeta: { saved?: boolean; updatedAt?: string; model?: string } | null;
  onGenerate: (force?: boolean) => void;
  onCopy: () => void;
}) {
  const {
    promptThisInput,
    setPromptThisInput,
    promptThisLoading,
    promptThisGenerating,
    promptThisMeta,
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
          <button
            onClick={() => onGenerate(false)}
            disabled={promptThisGenerating}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {promptThisGenerating ? 'Generating…' : promptThisInput ? 'Refresh prompt' : 'Generate prompt'}
          </button>
          <button
            onClick={() => onGenerate(true)}
            disabled={promptThisGenerating}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
            title="Force regenerate"
          >
            <RotateCcw className="h-4 w-4" />
            Regenerate
          </button>
          <button
            onClick={onCopy}
            disabled={!promptThisInput}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
          >
            Copy
          </button>
        </div>
      </div>

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
          {promptThisMeta?.model ? `• ${promptThisMeta.model}` : ''} {promptThisMeta?.saved === false ? '• not saved' : ''}
        </div>
      )}
    </div>
  );
}
