import QRCode from 'qrcode';

export const buildShareUrl = (params: {
  imageId?: string;
  shareBaseUrl: string;
  shareVariant?: string;
}) => {
  const { imageId, shareBaseUrl, shareVariant } = params;
  if (!imageId) return '';
  if (!shareBaseUrl.trim()) return '';
  try {
    const url = new URL(`/api/images/${imageId}/share`, shareBaseUrl.trim());
    if (shareVariant) {
      url.searchParams.set('variant', shareVariant);
    }
    return url.toString();
  } catch {
    return '';
  }
};

export const formatCopyPayload = (url: string, altText?: string, includeAlt?: boolean) => {
  if (!includeAlt) {
    return url;
  }
  return `url: ${JSON.stringify(url)},\naltText: ${JSON.stringify(altText ?? '')}`;
};

export const generateQrDataUrl = async (url: string) => {
  return QRCode.toDataURL(url, { margin: 1, width: 220 });
};
