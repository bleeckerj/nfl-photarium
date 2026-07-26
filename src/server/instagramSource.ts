import { cleanString } from '@/utils/cloudflareMetadata';

export type InstagramSourceRecord = {
  username?: string;
  userId?: string;
  mediaId?: string;
  shortcode?: string;
  permalink?: string;
  takenAtUnix?: number;
  takenAtIso?: string;
  likeCount?: number;
  commentCount?: number;
  viewCount?: number;
  capturedAt?: string;
};

const MAX_INSTAGRAM_SOURCE_BYTES = 100_000;

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? cleanString(value) : undefined;

const optionalCount = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.trunc(value);
};

export function normalizeInstagramSourceRecord(value: unknown): InstagramSourceRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const source: InstagramSourceRecord = {
    username: optionalString(raw.username),
    userId: optionalString(raw.userId),
    mediaId: optionalString(raw.mediaId),
    shortcode: optionalString(raw.shortcode),
    permalink: optionalString(raw.permalink),
    takenAtUnix: optionalCount(raw.takenAtUnix),
    takenAtIso: optionalString(raw.takenAtIso),
    likeCount: optionalCount(raw.likeCount),
    commentCount: optionalCount(raw.commentCount),
    viewCount: optionalCount(raw.viewCount),
    capturedAt: optionalString(raw.capturedAt),
  };

  return Object.values(source).some((value) => value !== undefined) ? source : undefined;
}

export function parseOptionalInstagramSource(
  value: FormDataEntryValue | null
): { ok: true; instagramSource?: InstagramSourceRecord } | { ok: false; error: string } {
  if (value === null) return { ok: true };
  if (typeof value !== 'string') {
    return { ok: false, error: 'Invalid instagramSource: expected a JSON string' };
  }

  const trimmed = value.trim();
  if (!trimmed) return { ok: true };
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_INSTAGRAM_SOURCE_BYTES) {
    return { ok: false, error: 'Invalid instagramSource: payload too large' };
  }

  try {
    const instagramSource = normalizeInstagramSourceRecord(JSON.parse(trimmed));
    if (!instagramSource) return { ok: false, error: 'Invalid instagramSource: expected an object' };
    return { ok: true, instagramSource };
  } catch {
    return { ok: false, error: 'Invalid instagramSource: malformed JSON' };
  }
}
