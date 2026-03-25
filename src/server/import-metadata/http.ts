import { Agent } from 'undici';

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const insecureAgent = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

type FetchInitWithDispatcher = RequestInit & { dispatcher?: Agent };

export const isCertError = (error: unknown) => {
  const code =
    typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: string }).code)
      : '';
  return (
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  );
};

export const isValidRemoteUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

export const isPrivateHost = (hostname: string) => {
  const lowered = hostname.toLowerCase();
  if (lowered === 'localhost') return true;
  const ipv4Match = /^(\d{1,3}\.){3}\d{1,3}$/.test(lowered);
  if (!ipv4Match) return false;
  const octets = lowered.split('.').map((part) => Number(part));
  if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return true;
  }
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
};

export const fetchWithCertFallback = async (
  url: string,
  allowInsecure = false,
  init?: RequestInit
) => {
  const baseHeaders = { 'User-Agent': BROWSER_USER_AGENT, ...(init?.headers || {}) };
  const firstInit: FetchInitWithDispatcher = allowInsecure
    ? { ...init, headers: baseHeaders, dispatcher: insecureAgent }
    : { ...init, headers: baseHeaders };

  try {
    return await fetch(url, firstInit as RequestInit);
  } catch (error) {
    if (!allowInsecure) throw error;
    if (isCertError(error) && !firstInit.dispatcher) {
      const retryInit: FetchInitWithDispatcher = {
        ...init,
        headers: baseHeaders,
        dispatcher: insecureAgent,
      };
      return await fetch(url, retryInit as RequestInit);
    }
    throw error;
  }
};

export const getMimeFromImageUrl = (value: string) => {
  const IMAGE_EXTENSION_MIME_MAP: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    tif: 'image/tiff',
    tiff: 'image/tiff',
  };

  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('.');
    if (segments.length > 1) {
      const ext = segments.pop()?.toLowerCase();
      if (ext && IMAGE_EXTENSION_MIME_MAP[ext]) {
        return IMAGE_EXTENSION_MIME_MAP[ext];
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
};

export const getFilenameFromContentDisposition = (value: string | null) => {
  if (!value) return undefined;
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^\";]+)"?/i.exec(value);
  const encoded = match?.[1] || match?.[2];
  if (!encoded) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
};
