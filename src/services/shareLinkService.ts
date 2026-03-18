import QRCode from 'qrcode';

const HAS_PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const IPV4_HOST_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

const isIpv4Host = (hostname: string) => {
  if (!IPV4_HOST_RE.test(hostname)) return false;
  return hostname.split('.').every((segment) => {
    const value = Number(segment);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
};

const isPrivateIpv4Host = (hostname: string) => {
  if (!isIpv4Host(hostname)) return false;
  const parts = hostname.split('.').map((segment) => Number(segment));
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
};

const isLocalhostHost = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

export const normalizeShareBaseUrl = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const withoutIpv4Www = trimmed.replace(
    /^(https?:\/\/)?www\.((?:\d{1,3}\.){3}\d{1,3})(:\d+)?(?=\/|$)/i,
    (_full, protocol: string | undefined, ip: string, port: string | undefined) =>
      `${protocol || ''}${ip}${port || ''}`
  );
  const withProtocol = HAS_PROTOCOL_RE.test(withoutIpv4Www)
    ? withoutIpv4Www
    : `http://${withoutIpv4Www}`;
  try {
    const url = new URL(withProtocol);
    const hostnameWithoutWww = url.hostname.replace(/^www\./i, '');
    if (isIpv4Host(hostnameWithoutWww)) {
      url.hostname = hostnameWithoutWww;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
};

export const isLocalhostOrigin = (input: string) => {
  const normalized = normalizeShareBaseUrl(input);
  if (!normalized) return false;
  try {
    return isLocalhostHost(new URL(normalized).hostname);
  } catch {
    return false;
  }
};

export const deriveInitialShareBaseUrl = (params: {
  currentOrigin: string;
  storedShareBaseUrl?: string | null;
}) => {
  const { currentOrigin, storedShareBaseUrl } = params;
  const normalizedCurrent = normalizeShareBaseUrl(currentOrigin || '');
  const normalizedStored = normalizeShareBaseUrl(storedShareBaseUrl || '');

  if (!normalizedStored) {
    return normalizedCurrent;
  }
  if (!normalizedCurrent) {
    return normalizedStored;
  }

  try {
    const currentHost = new URL(normalizedCurrent).hostname;
    const storedHost = new URL(normalizedStored).hostname;
    if (isPrivateIpv4Host(currentHost) && currentHost !== storedHost) {
      return normalizedCurrent;
    }
  } catch {
    // fall through to stored value
  }

  return normalizedStored;
};

export const buildShareUrl = (params: {
  imageId?: string;
  shareBaseUrl: string;
  shareVariant?: string;
}) => {
  const { imageId, shareBaseUrl, shareVariant } = params;
  if (!imageId) return '';
  const normalizedBase = normalizeShareBaseUrl(shareBaseUrl);
  if (!normalizedBase) return '';
  try {
    const url = new URL(`/api/images/${imageId}/share`, normalizedBase);
    if (shareVariant) {
      url.searchParams.set('variant', shareVariant);
    }
    return url.toString();
  } catch {
    return '';
  }
};

export const buildVideoDetailShareUrl = (params: {
  videoId?: string;
  shareBaseUrl: string;
}) => {
  const { videoId, shareBaseUrl } = params;
  if (!videoId) return '';
  const normalizedBase = normalizeShareBaseUrl(shareBaseUrl);
  if (!normalizedBase) return '';
  try {
    const url = new URL(`/videos/${videoId}`, normalizedBase);
    return url.toString();
  } catch {
    return '';
  }
};

export const buildVideoDownloadShareUrl = (params: {
  videoId?: string;
  shareBaseUrl: string;
}) => {
  const { videoId, shareBaseUrl } = params;
  if (!videoId) return '';
  const normalizedBase = normalizeShareBaseUrl(shareBaseUrl);
  if (!normalizedBase) return '';
  try {
    const url = new URL(`/api/videos/${videoId}/download`, normalizedBase);
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
