import React from 'react';

export function OriginalUrlSection(props: {
  originalUrlInput: string;
  setOriginalUrlInput: (value: string) => void;
  originalUrlTooLong: boolean;
  originalUrlByteLength: number;
  originalDeliveryUrl: string;
  originalUrlNormalized?: string;
  contentHash?: string;
  onCopyToClipboard: (text: string, label?: string) => Promise<void>;
}) {
  const {
    originalUrlInput,
    setOriginalUrlInput,
    originalUrlTooLong,
    originalUrlByteLength,
    originalDeliveryUrl,
    originalUrlNormalized,
    contentHash,
    onCopyToClipboard
  } = props;

  return (
    <div id="original-url-section">
      <div className="flex items-center gap-2">
        <p className="text-xs font-mono font-medum text-gray-700">Original URL</p>
        {originalUrlTooLong && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-mono text-amber-800">
            ⚠ {originalUrlByteLength} bytes
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 mt-2">
        <input
          value={originalUrlInput}
          onChange={(e) => setOriginalUrlInput(e.target.value)}
          className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-xs"
          placeholder="Original source URL"
        />
        <button
          type="button"
          onClick={() => setOriginalUrlInput('')}
          className="px-3 py-1 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-50"
          disabled={!originalUrlInput}
        >
          Clear
        </button>
        <button
          onClick={async () => {
            await onCopyToClipboard(originalUrlInput || originalDeliveryUrl, 'Original');
          }}
          className="px-3 py-1 bg-blue-600 text-white rounded text-xs cursor-pointer transition transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
        >
          Copy
        </button>
      </div>

      <div className="mt-3 space-y-1 text-[11px] font-mono text-gray-600">
        <div className="flex items-center gap-2">
          <span className="text-gray-700">Normalized:</span>
          <span className="truncate" title={originalUrlNormalized || '—'}>
            {originalUrlNormalized || '—'}
          </span>
          {originalUrlNormalized && (
            <button
              onClick={async () => {
                await onCopyToClipboard(originalUrlNormalized, 'Normalized URL');
              }}
              className="px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-100 text-[10px]"
            >
              Copy
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-700">Hash:</span>
          <span className="truncate" title={contentHash || '—'}>
            {contentHash || '—'}
          </span>
          {contentHash && (
            <button
              onClick={async () => {
                await onCopyToClipboard(contentHash, 'Content hash');
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
