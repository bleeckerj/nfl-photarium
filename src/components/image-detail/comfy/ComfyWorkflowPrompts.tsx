import React, { useState } from 'react';
import type { ComfyPromptTexts } from '@/components/image-detail/comfy/types';

export function ComfyWorkflowPrompts(props: {
  promptTexts: ComfyPromptTexts;
  workflowIntentText: string | null;
  onCopyText?: (text: string, successMessage?: string) => void;
}) {
  const { promptTexts, workflowIntentText, onCopyText } = props;
  const [showAllOthers, setShowAllOthers] = useState(false);
  const visibleOthers = showAllOthers ? promptTexts.others : promptTexts.others.slice(0, 2);
  const hiddenOtherCount = Math.max(0, promptTexts.others.length - visibleOthers.length);
  const hasPromptText = Boolean(promptTexts.primary || promptTexts.negative || promptTexts.others.length);

  if (!hasPromptText && !workflowIntentText) return null;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-mono text-gray-500">Comfy Prompt Text</p>
        {promptTexts.primary && onCopyText && (
          <button
            type="button"
            onClick={() => onCopyText(promptTexts.primary || '', 'Comfy prompt copied')}
            className="text-[10px] px-2 py-1 rounded border border-gray-200 text-gray-600 hover:border-gray-300"
          >
            Copy primary
          </button>
        )}
      </div>
      {hasPromptText && (
        <p className="mt-1 text-[10px] text-gray-500">
          {promptTexts.totalPromptLikeCount} prompt-like text entr{promptTexts.totalPromptLikeCount === 1 ? 'y' : 'ies'}
          {promptTexts.source === 'cliptextencode' ? ' (from CLIPTextEncode path)' : ' (filtered from extracted text)'}
          {promptTexts.rawExtractedCount > promptTexts.totalPromptLikeCount
            ? ` • ${promptTexts.rawExtractedCount - promptTexts.totalPromptLikeCount} non-prompt entries hidden`
            : ''}
        </p>
      )}

      {hasPromptText && (
        <div className="mt-1 space-y-2">
          {promptTexts.primary && (
            <div className="rounded border border-gray-200 bg-white px-2 py-2">
              <div className="text-[10px] text-gray-500 mb-1">Primary prompt</div>
              <div className="text-[11px] font-mono text-gray-800 whitespace-pre-wrap break-words">{promptTexts.primary}</div>
            </div>
          )}
          {promptTexts.negative && (
            <div className="rounded border border-gray-200 bg-white px-2 py-2">
              <div className="text-[10px] text-gray-500 mb-1">Negative prompt</div>
              <div className="text-[11px] font-mono text-gray-800 whitespace-pre-wrap break-words">{promptTexts.negative}</div>
            </div>
          )}
          {visibleOthers.map((prompt, index) => (
            <div key={`${index}-${prompt.slice(0, 24)}`} className="rounded border border-gray-200 bg-gray-50 px-2 py-2">
              <div className="text-[10px] text-gray-500 mb-1">Other prompt-like text {index + 1}</div>
              <div className="text-[11px] font-mono text-gray-800 whitespace-pre-wrap break-words">{prompt}</div>
            </div>
          ))}
          {hiddenOtherCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllOthers((v) => !v)}
              className="text-[10px] px-2 py-1 rounded border border-gray-200 text-gray-600 hover:border-gray-300"
            >
              {showAllOthers ? 'Show fewer' : `Show ${hiddenOtherCount} more`}
            </button>
          )}
        </div>
      )}

      {workflowIntentText && (
        <details className="mt-2 rounded border border-gray-200 bg-gray-50 px-2 py-1">
          <summary className="cursor-pointer text-[10px] text-gray-600">Workflow intent summary</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words text-[10px] font-mono text-gray-700">{workflowIntentText}</pre>
        </details>
      )}
    </div>
  );
}
