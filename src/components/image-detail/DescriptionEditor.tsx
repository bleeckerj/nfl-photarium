import React from 'react';
import { Sparkles } from 'lucide-react';

export function DescriptionEditor(props: {
  descriptionInput: string;
  setDescriptionInput: (value: string) => void;
  descriptionGenerating: boolean;
  onGenerateDescription: () => void;
  hasVariations: boolean;
  bulkDescriptionApplying: boolean;
  onApplyToVariations: () => void;
}) {
  const {
    descriptionInput,
    setDescriptionInput,
    descriptionGenerating,
    onGenerateDescription,
    hasVariations,
    bulkDescriptionApplying,
    onApplyToVariations
  } = props;

  return (
    <div id="description-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-mono font-medum text-gray-700">Description</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onGenerateDescription}
            disabled={descriptionGenerating}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {descriptionGenerating ? 'Generating…' : 'Generate description'}
          </button>
          {hasVariations && (
            <button
              onClick={onApplyToVariations}
              disabled={bulkDescriptionApplying || !descriptionInput.trim()}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
            >
              {bulkDescriptionApplying ? 'Applying…' : 'Apply to variations'}
            </button>
          )}
        </div>
      </div>
      <textarea
        value={descriptionInput}
        onChange={(e) => setDescriptionInput(e.target.value)}
        className="w-full font-mono text-xs border border-gray-300 rounded-md px-3 py-2 mt-2"
        rows={3}
        placeholder="Add a short description"
      />
    </div>
  );
}
