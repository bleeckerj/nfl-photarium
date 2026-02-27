import React from 'react';

export function ComfyWorkflowJsonDrawer(props: {
  rawJsonPretty: string | null;
  onCopyText?: (text: string, successMessage?: string) => void;
}) {
  const { rawJsonPretty, onCopyText } = props;
  if (!rawJsonPretty) return null;

  return (
    <details className="mt-3 rounded border border-gray-200 bg-gray-50">
      <summary className="cursor-pointer px-3 py-2 text-[10px] font-mono text-gray-600">
        Raw Workflow JSON
      </summary>
      <div className="px-3 pb-3">
        <div className="flex justify-end">
          {onCopyText && (
            <button
              type="button"
              onClick={() => onCopyText(rawJsonPretty, 'Workflow JSON copied')}
              className="text-[10px] px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:border-gray-300"
            >
              Copy JSON
            </button>
          )}
        </div>
        <pre className="mt-2 max-h-64 overflow-auto rounded border border-gray-200 bg-white p-2 text-[10px] font-mono text-gray-700 whitespace-pre-wrap break-words">
          {rawJsonPretty}
        </pre>
      </div>
    </details>
  );
}
