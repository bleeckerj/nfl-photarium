import React from 'react';

export function SourceUrlSection(props: {
  sourceUrlInput: string;
  setSourceUrlInput: (value: string) => void;
  sourceUrlNormalized?: string;
  onCopyToClipboard: (text: string, label?: string) => Promise<void>;
}) {
  const { sourceUrlInput, setSourceUrlInput, sourceUrlNormalized, onCopyToClipboard } = props;

  return (
    <div id="source-url-section">
      <p className="text-xs font-mono font-medum text-gray-700">Source URL</p>
      <div className="flex items-center gap-3 mt-2">
        <input
          value={sourceUrlInput}
          onChange={(e) => setSourceUrlInput(e.target.value)}
          className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-xs"
          placeholder="Page or site URL"
        />
        <button
          onClick={async () => {
            await onCopyToClipboard(sourceUrlInput || '', 'Source');
          }}
          className="px-3 py-1 bg-blue-600 text-white rounded text-xs cursor-pointer transition transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
          disabled={!sourceUrlInput}
        >
          Copy
        </button>
      </div>
      <div className="mt-3 space-y-1 text-[11px] font-mono text-gray-600">
        <div className="flex items-center gap-2">
          <span className="text-gray-700">Normalized:</span>
          <span className="truncate" title={sourceUrlNormalized || '—'}>
            {sourceUrlNormalized || '—'}
          </span>
          {sourceUrlNormalized && (
            <button
              onClick={async () => {
                await onCopyToClipboard(sourceUrlNormalized, 'Normalized URL');
              }}
              className="px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-100 text-[10px]"
            >
              Copy
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
