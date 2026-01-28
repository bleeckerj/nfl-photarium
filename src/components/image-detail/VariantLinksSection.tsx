import React from 'react';

export function VariantLinksSection(props: {
  variants: Record<string, string>;
  getVariantWidthLabel: (variant: string) => string | null;
  onHandleCopyUrl: (
    event: React.MouseEvent<HTMLButtonElement>,
    url: string,
    label?: string,
    altText?: string
  ) => Promise<void>;
  imageAltTag?: string;
}) {
  const { variants, getVariantWidthLabel, onHandleCopyUrl, imageAltTag } = props;

  return (
    <div id="variant-links-section">
      <p className="text-xs font-mono font-medum text-gray-700">Available variants</p>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Object.entries(variants).map(([variant, url]) => {
          const widthLabel = getVariantWidthLabel(String(variant));
          return (
            <div
              key={variant}
              className="flex flex-col gap-2 p-2 border rounded sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="text-xs font-mono font-semibold text-gray-900 capitalize flex items-center gap-2">
                  <span>{variant}</span>
                  {widthLabel && <span className="text-gray-400 normal-case">{widthLabel}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                <a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-600">
                  Open
                </a>
                <button
                  onClick={async (event) => {
                    await onHandleCopyUrl(event, url, String(variant), imageAltTag);
                  }}
                  className="px-2 py-1 bg-blue-100 hover:bg-blue-200 active:bg-blue-300 rounded text-xs font-medium cursor-pointer transition transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
                >
                  Copy
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-500 mt-2">Tip: Shift+Copy adds ALT text.</p>
    </div>
  );
}
