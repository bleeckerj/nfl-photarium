import type { CSSProperties, MouseEvent } from 'react';
import { getMultipleImageUrls } from '@/utils/imageUtils';
import { downloadImageToFile, formatDownloadFileName } from '@/utils/downloadUtils';
import { ensureWebpFormat, getVariantWidthLabel } from './detailTransforms';
import type { CloudflareImage } from './types';

export const VariantSizeModal = ({
  target,
  fallbackImage,
  onClose,
  onCopyUrl,
  onToast,
}: {
  target: CloudflareImage;
  fallbackImage: CloudflareImage;
  onClose: () => void;
  onCopyUrl: (event: MouseEvent<HTMLButtonElement>, url: string, label?: string, altText?: string) => Promise<void>;
  onToast: (message: string) => void;
}) => {
  const blurOverlayStyle: CSSProperties = {
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  };

  const variantEntries = Object.entries(
    getMultipleImageUrls(target.id, ['thumbnail', 'small', 'medium', 'large', 'xlarge', 'full'])
  ).map(([variantName, variantUrl]) => [variantName, ensureWebpFormat(variantUrl)] as [string, string]);

  const handleCopyVariantList = async (
    event: MouseEvent<HTMLButtonElement>,
    variant: string,
    url: string
  ) => {
    await onCopyUrl(event, ensureWebpFormat(url), `${variant} variant`, target.altTag);
    onClose();
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-md z-[100000]"
        style={blurOverlayStyle}
        onClick={onClose}
      />
      <div className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 bg-white rounded-lg shadow-xl z-[100001] text-xs text-gray-800 border">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="text-xs font-mono font-medum">Copy Image URL</div>
          <button onClick={onClose} className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs">
            x
          </button>
        </div>
        <div id="variant-size-modal" className="p-3 max-h-80 overflow-auto">
          {variantEntries.map(([variant, url]) => {
            const widthLabel = getVariantWidthLabel(variant);
            return (
              <div key={variant} className="flex items-center justify-between gap-2 py-2 border-b border-gray-100 last:border-b-0">
                <div className="flex-1 min-w-0 mr-3">
                  <div className="text-xs font-mono font-semibold text-gray-900 capitalize flex items-center gap-2">
                    <span>{variant}</span>
                    {widthLabel && <span className="text-gray-400 normal-case">{widthLabel}</span>}
                  </div>
                  <div className="text-xs text-gray-500 truncate">{String(url)}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={async (event) => {
                      await handleCopyVariantList(event, variant, String(url));
                    }}
                    className="px-3 py-1 bg-blue-100 hover:bg-blue-200 active:bg-blue-300 rounded text-xs font-medium flex-shrink-0 cursor-pointer transition transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
                  >
                    Copy
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const targetDownloadName =
                          target.displayName?.trim() ||
                          target.filename ||
                          fallbackImage.displayName?.trim() ||
                          fallbackImage.filename ||
                          'image';
                        const downloadName = formatDownloadFileName(targetDownloadName);
                        await downloadImageToFile(String(url), downloadName);
                        onToast('Download started');
                      } catch (error) {
                        console.error('Failed to download variant', error);
                        onToast('Failed to download image');
                      }
                    }}
                    className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs font-medium flex-shrink-0 cursor-pointer"
                  >
                    Download
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-3 pb-3 text-[10px] text-gray-500">Tip: Shift+Copy adds ALT text.</div>
      </div>
    </>
  );
};
