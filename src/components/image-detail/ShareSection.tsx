import React from 'react';
import MonoSelect from '@/components/MonoSelect';

export type ShareVariantOption = { value: string; label: string };

export function ShareSection(props: {
  shareBaseUrl: string;
  setShareBaseUrl: (value: string) => void;
  shareVariant: string;
  setShareVariant: (value: string) => void;
  shareVariantOptions: ShareVariantOption[];
  shareUrl: string;
  shareQrDataUrl: string;
  onCopyToClipboard: (text: string, label?: string) => Promise<void>;
}) {
  const {
    shareBaseUrl,
    setShareBaseUrl,
    shareVariant,
    setShareVariant,
    shareVariantOptions,
    shareUrl,
    shareQrDataUrl,
    onCopyToClipboard
  } = props;

  return (
    <div id="share-section" className="space-y-3">
      <p className="text-xs font-mono font-medum text-gray-700">Share (QR)</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 space-y-2">
          <label className="block text-[11px] text-gray-600">
            Share base URL
            <input
              value={shareBaseUrl}
              onChange={(e) => setShareBaseUrl(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
              placeholder="http://192.168.x.x:3000"
            />
          </label>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-gray-600">Share size</label>
            <MonoSelect
              id="share-variant"
              value={shareVariant}
              onChange={setShareVariant}
              options={shareVariantOptions}
              className="w-40 text-[11px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              value={shareUrl}
              readOnly
              className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-xs bg-gray-50 text-gray-600"
              placeholder="Share URL"
            />
            <button
              onClick={async () => {
                if (shareUrl) await onCopyToClipboard(shareUrl, 'Share');
              }}
              className="px-3 py-1 bg-blue-600 text-white rounded text-xs cursor-pointer transition transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
              disabled={!shareUrl}
            >
              Copy
            </button>
          </div>
          <p className="text-[10px] text-gray-500">Use your network URL (from `next dev`) so your phone can reach it.</p>
        </div>
        <div className="flex items-center justify-center w-full sm:w-auto">
          {shareQrDataUrl ? (
            <img
              src={shareQrDataUrl}
              alt="Share QR code"
              className="w-[140px] h-[140px] border border-gray-200 rounded-md bg-white"
            />
          ) : (
            <div className="w-[140px] h-[140px] border border-dashed border-gray-200 rounded-md flex items-center justify-center text-[10px] text-gray-400">
              QR unavailable
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
