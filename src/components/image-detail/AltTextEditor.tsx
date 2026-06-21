import React from 'react';
import { Sparkles } from 'lucide-react';

export function AltTextEditor(props: {
  imageId: string;
  imageHasAlt: boolean;
  altTextInput: string;
  setAltTextInput: (value: string) => void;
  altLoading: boolean;
  onGenerateAlt: (imageId: string) => void;
  onCopy: () => void;
  hasVariations: boolean;
  bulkAltApplying: boolean;
  onApplyToVariations: () => void;
}) {
  const {
    imageId,
    imageHasAlt,
    altTextInput,
    setAltTextInput,
    altLoading,
    onGenerateAlt,
    onCopy,
    hasVariations,
    bulkAltApplying,
    onApplyToVariations
  } = props;

  return (
    <div id="alt-text-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-mono font-medum text-gray-700">Alt text</p>
          <p className="text-[10px] text-gray-500">Used by screen readers and assistive tech.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onGenerateAlt(imageId)}
            disabled={altLoading}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {altLoading ? 'Generating…' : imageHasAlt ? 'Refresh ALT text' : 'Generate ALT text'}
          </button>
          <button
            onClick={onCopy}
            disabled={!altTextInput.trim()}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
          >
            Copy
          </button>
          {hasVariations && (
            <button
              onClick={onApplyToVariations}
              disabled={bulkAltApplying || !altTextInput.trim()}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
            >
              {bulkAltApplying ? 'Applying…' : 'Apply to variations'}
            </button>
          )}
        </div>
      </div>
      <textarea
        value={altTextInput}
        onChange={(e) => setAltTextInput(e.target.value)}
        placeholder="No ALT text yet"
        className="w-full font-mono text-xs border border-gray-300 rounded-md px-3 py-2 mt-2 bg-white text-gray-800 min-h-[80px]"
      />
    </div>
  );
}
