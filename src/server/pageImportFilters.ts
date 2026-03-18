const BLOCKED_MEDIA_DOMAINS = [
  'adroll.com',
  'd.adroll.com',
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'facebook.com',
  'facebook.net',
  'fbcdn.net',
  'analytics.',
  'pixel.',
  'tracking.',
  'ads.',
  'ad.',
  'beacon.',
  'criteo.com',
  'taboola.com',
  'outbrain.com',
];

const UI_CHROME_PATH_PATTERNS = [
  /\/favicon(?:\.|$)/i,
  /\/init\/gfx\/home\//i,
  /\/browsecatalogcategoryimages\//i,
  /\/masthead/i,
  /\/sprites?\//i,
  /\/sprite[-_]/i,
  /\/icons?\//i,
];

const UI_CHROME_NAME_PATTERN =
  /(^|[\/_.-])(logo|logos|sprite|sprites|favicon|masthead|menu|header|footer|searchicon|close|cancel|button|badge|circlex|closex|clearx|donate)([\/_.-]|$)/i;

const TRACKING_OR_UTILITY_PATH_PATTERNS = [
  /\/(?:webreports?|webreport|analytics?|tracking|tracker|metrics?|telemetry|beacon|pixel|collect|impression)(?:[\/_.-]|$)/i,
  /\/204(?:$|[/?#.])/i,
  /\/ecm\d*(?:$|[/?#.])/i,
  /\/x\.(?:png|gif|svg|webp|bmp|ico)(?:$|[?#])/i,
  /(?:^|[/?&])(?:pixel|beacon|tracking|analytics|webreport|event|impression)=/i,
  /(?:^|[/?&])(?:gdpr|gdpr_consent|cmp|consent_string)=/i,
];

const TRACKING_OR_UTILITY_NAME_PATTERN =
  /(^|[\/_.-])(webreports?|webreport|pixel|beacon|tracker|tracking|telemetry|analytics|impression|spinner|loading|placeholder|blank|transparent|circlex|closex|clearx|1x1|onebyone)([\/_.-]|$)/i;

const TRACKING_OR_UTILITY_HOST_PATTERNS = [
  /(^|\.)amazon-adsystem\.com$/i,
  /(^|\.)experiment\.routing\.cloudfront\.aws\.a2z\.com$/i,
];

const TINY_PIXEL_SIZE_HINT_PATTERN =
  /(^|[\/_.-])(1x1|1x2|2x1|2x2|0x0|onebyone|spacer|blank|transparent|trackingpixel)([\/_.-]|$)/i;

const TINY_PIXEL_QUERY_HINT_PATTERN =
  /(?:^|[?&])(?:w|width|h|height|imgw|imgh|sz|size)=(?:0|1|2|3|4)(?:[&#]|$)/i;

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

export const isBlockedMediaDomain = (url: string): boolean => {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const hostname = parsed.hostname.toLowerCase();
  return BLOCKED_MEDIA_DOMAINS.some(
    (blocked) =>
      hostname === blocked ||
      hostname.endsWith(`.${blocked}`) ||
      hostname.includes(blocked)
  );
};

export const looksLikeImageAssetUrl = (url: string): boolean => {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const path = parsed.pathname.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|ico)(\?|$)/i.test(path)) {
    return true;
  }
  if (url.includes('/cdn/') || url.includes('/images/') || url.includes('/media/')) {
    return true;
  }
  return false;
};

export const looksLikeUiChromeAsset = (url: string, filenameHint?: string): boolean => {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const path = parsed.pathname.toLowerCase();
  if (UI_CHROME_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    return true;
  }
  const signal = `${path}/${(filenameHint || '').toLowerCase()}`;
  return UI_CHROME_NAME_PATTERN.test(signal);
};

export const looksLikeTrackingOrUtilityAsset = (url: string, filenameHint?: string): boolean => {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const hostname = parsed.hostname.toLowerCase();
  if (TRACKING_OR_UTILITY_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    return true;
  }
  const pathAndQuery = `${parsed.pathname.toLowerCase()}${parsed.search.toLowerCase()}`;
  if (TRACKING_OR_UTILITY_PATH_PATTERNS.some((pattern) => pattern.test(pathAndQuery))) {
    return true;
  }
  const signal = `${pathAndQuery}/${(filenameHint || '').toLowerCase()}`;
  return TRACKING_OR_UTILITY_NAME_PATTERN.test(signal);
};

type TinyPixelSignal = {
  url: string;
  filenameHint?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  contentLength?: number;
};

export const looksLikeTinyTrackingPixel = ({
  url,
  filenameHint,
  naturalWidth,
  naturalHeight,
  contentLength,
}: TinyPixelSignal): boolean => {
  const parsed = parseUrl(url);
  if (!parsed) return false;

  const hasTinyDimensions =
    typeof naturalWidth === 'number' &&
    typeof naturalHeight === 'number' &&
    naturalWidth > 0 &&
    naturalHeight > 0 &&
    naturalWidth <= 4 &&
    naturalHeight <= 4;
  if (hasTinyDimensions) return true;

  const pathAndQuery = `${parsed.pathname.toLowerCase()}${parsed.search.toLowerCase()}`;
  const signal = `${pathAndQuery}/${(filenameHint || '').toLowerCase()}`;
  const hasTinySizeHints =
    TINY_PIXEL_SIZE_HINT_PATTERN.test(signal) ||
    TINY_PIXEL_QUERY_HINT_PATTERN.test(pathAndQuery);
  const hasTinyByteSize =
    typeof contentLength === 'number' &&
    Number.isFinite(contentLength) &&
    contentLength > 0 &&
    contentLength <= 1024;

  if (hasTinyByteSize && looksLikeTrackingOrUtilityAsset(url, filenameHint)) {
    return true;
  }
  if (hasTinySizeHints && (hasTinyByteSize || looksLikeTrackingOrUtilityAsset(url, filenameHint))) {
    return true;
  }
  return false;
};
