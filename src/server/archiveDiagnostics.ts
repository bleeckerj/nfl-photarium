const ARCHIVE_HOST_PATTERN = /^archive\.[a-z0-9-]+$/i;

const ARCHIVE_SIGNAL_PATTERNS: Array<{ signal: string; pattern: RegExp }> = [
  { signal: 'one-more-step', pattern: /one more step/i },
  { signal: 'security-check', pattern: /security check/i },
  { signal: 'captcha', pattern: /captcha/i },
  { signal: 'g-recaptcha', pattern: /g-recaptcha/i },
  { signal: 'verify-human', pattern: /verify you are human|prove you are a human/i },
  { signal: 'temporary-access', pattern: /temporary access to the web property/i },
  { signal: 'too-many-requests', pattern: /too many requests|rate limit/i },
];

export type ArchiveDiagnostics = {
  host: string;
  sourceUrl: string;
  finalUrl?: string;
  status?: number;
  contentType?: string | null;
  title?: string | null;
  snippet?: string;
  challengeDetected: boolean;
  signals: string[];
};

const normalizeHost = (value: string) => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
};

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const stripHtml = (html: string) =>
  normalizeWhitespace(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );

const extractTitle = (html: string) => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? normalizeWhitespace(match[1]) : null;
};

const detectSignals = (content: string, title?: string | null) => {
  const haystack = `${title || ''}\n${content}`;
  return ARCHIVE_SIGNAL_PATTERNS
    .filter(({ pattern }) => pattern.test(haystack))
    .map(({ signal }) => signal);
};

export const isArchiveHost = (value: string) => ARCHIVE_HOST_PATTERN.test(normalizeHost(value));

export const inspectArchiveText = ({
  sourceUrl,
  text,
  title,
  status,
  finalUrl,
  contentType,
}: {
  sourceUrl: string;
  text: string;
  title?: string | null;
  status?: number;
  finalUrl?: string;
  contentType?: string | null;
}): ArchiveDiagnostics | null => {
  if (!isArchiveHost(sourceUrl) && !(finalUrl && isArchiveHost(finalUrl))) {
    return null;
  }

  const normalizedText = normalizeWhitespace(text).slice(0, 240);
  const normalizedTitle = title ? normalizeWhitespace(title).slice(0, 120) : null;
  const signals = detectSignals(text, normalizedTitle);

  return {
    host: normalizeHost(finalUrl || sourceUrl),
    sourceUrl,
    finalUrl,
    status,
    contentType: contentType || null,
    title: normalizedTitle,
    snippet: normalizedText || undefined,
    challengeDetected: signals.length > 0,
    signals,
  };
};

export const inspectArchiveHtml = ({
  sourceUrl,
  html,
  status,
  finalUrl,
  contentType,
}: {
  sourceUrl: string;
  html: string;
  status?: number;
  finalUrl?: string;
  contentType?: string | null;
}) =>
  inspectArchiveText({
    sourceUrl,
    text: stripHtml(html),
    title: extractTitle(html),
    status,
    finalUrl,
    contentType,
  });

export const readArchiveResponseDiagnostics = async (sourceUrl: string, response: Response) => {
  if (!isArchiveHost(sourceUrl) && !isArchiveHost(response.url || sourceUrl)) {
    return null;
  }

  const contentType = response.headers.get('content-type');
  const normalizedType = (contentType || '').toLowerCase();
  if (response.ok && (normalizedType.startsWith('image/') || normalizedType.startsWith('video/'))) {
    return inspectArchiveText({
      sourceUrl,
      text: '',
      status: response.status,
      finalUrl: response.url,
      contentType,
    });
  }

  let bodyText = '';
  try {
    bodyText = await response.clone().text();
  } catch {
    bodyText = '';
  }

  if (normalizedType.includes('html')) {
    return inspectArchiveHtml({
      sourceUrl,
      html: bodyText,
      status: response.status,
      finalUrl: response.url,
      contentType,
    });
  }

  return inspectArchiveText({
    sourceUrl,
    text: bodyText,
    status: response.status,
    finalUrl: response.url,
    contentType,
  });
};

export const logArchiveDiagnostics = (
  scope: string,
  diagnostics: ArchiveDiagnostics | null,
  extra?: Record<string, unknown>
) => {
  if (!diagnostics) return;
  console.warn(`[${scope}] archive diagnostics`, {
    host: diagnostics.host,
    sourceUrl: diagnostics.sourceUrl,
    finalUrl: diagnostics.finalUrl,
    status: diagnostics.status,
    contentType: diagnostics.contentType,
    title: diagnostics.title,
    snippet: diagnostics.snippet,
    challengeDetected: diagnostics.challengeDetected,
    signals: diagnostics.signals,
    ...extra,
  });
};

export const buildArchiveChallengeMessage = (host: string) =>
  `${host} returned a CAPTCHA/security-check page to automation. Use browser ingest after clearing the challenge in a real browser, or paste a solved Cookie header.`;
