import { useCallback, useEffect, useMemo, useState } from 'react';
import { copyTextToClipboard } from '@/services/clipboardService';
import { buildShareUrl, formatCopyPayload, generateQrDataUrl } from '@/services/shareLinkService';

type Toast = { push: (message: string) => void };

type UseShareLinksParams = {
  imageId?: string;
  shareBaseUrl: string;
  shareVariant?: string;
  toast: Toast;
};

export function useShareLinks({ imageId, shareBaseUrl, shareVariant, toast }: UseShareLinksParams) {
  const [shareQrDataUrl, setShareQrDataUrl] = useState('');

  const shareUrl = useMemo(
    () => buildShareUrl({ imageId, shareBaseUrl, shareVariant }),
    [imageId, shareBaseUrl, shareVariant]
  );

  useEffect(() => {
    if (!shareUrl) {
      setShareQrDataUrl('');
      return;
    }
    let cancelled = false;
    generateQrDataUrl(shareUrl)
      .then((dataUrl) => {
        if (!cancelled) {
          setShareQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShareQrDataUrl('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shareUrl]);

  const handleCopyUrl = useCallback(
    async (
      event: React.MouseEvent<HTMLButtonElement>,
      url: string,
      label?: string,
      altText?: string,
      successMessage?: string
    ) => {
      const payload = formatCopyPayload(url, altText, event.shiftKey);
      const copied = await copyTextToClipboard(payload);
      if (copied) {
        toast.push(successMessage || (label ? `${label} URL copied` : 'Text copied to clipboard'));
        return;
      }
      try {
        prompt('Copy this text manually:', payload);
      } catch {
        // ignore
      }
    },
    [toast]
  );

  const handleCopyText = useCallback(
    async (text: string, successMessage?: string) => {
      const copied = await copyTextToClipboard(text);
      if (copied) {
        toast.push(successMessage || 'Text copied to clipboard');
        return;
      }
      try {
        prompt('Copy this text manually:', text);
      } catch {
        // ignore
      }
    },
    [toast]
  );

  return {
    shareUrl,
    shareQrDataUrl,
    handleCopyUrl,
    handleCopyText
  };
}
