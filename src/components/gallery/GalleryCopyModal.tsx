/**
 * GalleryCopyModal Component
 * 
 * Modal for copying and downloading image variants.
 */

'use client';

import React, { CSSProperties } from 'react';

interface CopyModalItem {
  variant: string;
  url: string;
  widthLabel?: string;
}

interface GalleryCopyModalProps {
  items: CopyModalItem[];
  altText?: string;
  filename?: string;
  onClose: () => void;
  onCopyUrl: (
    event: React.MouseEvent<HTMLButtonElement>,
    url: string,
    variant: string,
    altText?: string
  ) => Promise<void>;
  onDownload: (url: string, filename?: string) => Promise<void>;
}

export const GalleryCopyModal: React.FC<GalleryCopyModalProps> = ({
  items,
  altText,
  filename,
  onClose,
  onCopyUrl,
  onDownload,
}) => {
  const blurOverlayStyle: CSSProperties = {
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)'
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-md z-[100000]"
        style={blurOverlayStyle}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      />
      <div className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 bg-white rounded-lg shadow-xl z-[100001] text-[0.7em] font-mono text-gray-800 border">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="text-[0.7em] font-mono font-medum">Copy Image URL</div>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-[0.7em] font-mono"
            title="Close"
          >
            ×
          </button>
        </div>
        <div className="p-3 max-h-80 overflow-auto">
          {items.map(({ variant, url, widthLabel }) => (
            <div key={variant} className="flex items-center justify-between gap-2 py-2 border-b border-gray-100 last:border-b-0">
              <div className="flex-1 min-w-0 mr-3">
                <div className="text-[0.7em] font-mono font-semibold text-gray-900 capitalize flex items-center gap-2">
                  <span>{variant}</span>
                  {widthLabel && <span className="text-gray-400 normal-case">{widthLabel}</span>}
                </div>
                <div className="text-[0.7em] font-mono text-gray-500 truncate">{String(url)}</div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await onCopyUrl(e, String(url), variant, altText);
                    onClose();
                  }}
                  className="px-3 py-1 bg-blue-100 hover:bg-blue-200 active:bg-blue-300 rounded text-[0.7em] font-mono font-medium flex-shrink-0 cursor-pointer transition transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
                >
                  Copy
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await onDownload(String(url), filename);
                  }}
                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-[0.7em] font-mono font-medium flex-shrink-0 cursor-pointer"
                  title="Download"
                >
                  Download
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="px-3 pb-3 text-[0.7em] font-mono text-gray-500">Tip: Shift+Copy adds ALT text.</div>
      </div>
    </>
  );
};
