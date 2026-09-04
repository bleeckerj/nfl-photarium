export const FAVORITE_TAG = '_favorite_';

const normalizeTag = (tag: string) => tag.trim().toLowerCase();

export const isSystemTag = (tag: string): boolean => {
  const normalized = normalizeTag(tag);
  return normalized.startsWith('_') && normalized.endsWith('_');
};

export const getUserVisibleTags = (tags: string[] | undefined): string[] => {
  if (!Array.isArray(tags)) return [];
  return tags.map(tag => tag.trim()).filter(tag => tag && !isSystemTag(tag));
};

export const hasFavoriteTag = (tags: string[] | undefined): boolean => {
  if (!Array.isArray(tags)) return false;
  return tags.some(tag => normalizeTag(tag) === FAVORITE_TAG);
};

const dedupeTags = (tags: string[]) => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  tags.forEach((tag) => {
    const trimmed = tag.trim();
    const normalized = normalizeTag(trimmed);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    deduped.push(trimmed);
  });
  return deduped;
};

export const setFavoriteTag = (
  tags: string[] | undefined,
  favorite: boolean
): string[] => {
  const existing = dedupeTags(Array.isArray(tags) ? tags : []);
  const withoutFavorite = existing.filter(tag => normalizeTag(tag) !== FAVORITE_TAG);
  return favorite ? [...withoutFavorite, FAVORITE_TAG] : withoutFavorite;
};

export const mergeUserTagsPreservingSystemTags = (
  existingTags: string[] | undefined,
  nextUserTags: string[] | undefined
): string[] => {
  const systemTags = dedupeTags(Array.isArray(existingTags) ? existingTags.filter(isSystemTag) : []);
  const userTags = dedupeTags(Array.isArray(nextUserTags) ? nextUserTags.filter(tag => !isSystemTag(tag)) : []);
  return [...userTags, ...systemTags];
};

// -- Browsable-tag policy ---------------------------------------------------
// The tag facet is a single array serving two consumers with opposite needs:
// the image-detail tag editor needs the COMPLETE vocabulary (autocomplete and
// typo-correction degrade if it is truncated), while the gallery tag dropdown
// only wants tags you could plausibly browse by. These helpers express the
// second policy so the facet itself can stay untouched.
//
// Nothing here removes a tag from an image. A tag that fails `isBrowsableTag`
// stays stored, stays searchable, and stays visible on the detail page — it is
// simply not offered as a filter.

export const CONTROL_TAGS = ['x-clip', 'x-color', 'x-search'] as const;
const CONTROL_TAG_SET = new Set<string>(CONTROL_TAGS);

const OPERATIONAL_TAG_PATTERN =
  /^(?:provider|model|workflow|source|namespace|filename|filepath|file|path|folder|upload|ingest)(?:[:=/_-]|$)/i;

export const isControlTag = (value: string): boolean =>
  CONTROL_TAG_SET.has(value.trim().toLocaleLowerCase());

export const isOperationalProvenanceTag = (value: string): boolean =>
  OPERATIONAL_TAG_PATTERN.test(value.trim());

// Machine-generated values that leaked into the user tag space. Each entry is
// anchored so it cannot match a longer, legitimate tag that merely starts the
// same way. Deliberately absent: bare `manual` / `auto` — almost certainly the
// exposure mode alongside `aperture priority`, but also perfectly good content
// tags, so they stay in the vocabulary rather than be swept on a guess.
const MACHINE_TAG_PATTERNS: readonly RegExp[] = [
  // Namespaced system keys: digest:…, signal:…, lat:…, uploaded:by=…
  /^(?:digest|signal|lat|lon|lng|alt|uploaded|seed|batch|run|job|src|sha|md5|hash|ref)[:=]/i,
  // EXIF key:value pairs: meteringmode:pattern, ev:0 ev
  /^(?:meteringmode|exposure|whitebalance|wb|ev)[:=]/i,
  // ISO speed: "iso 160"
  /^iso\s*\d+$/i,
  // Aperture: "f/2.8", "f2.8"
  /^f\/?\d+(?:\.\d+)?$/i,
  // Focal length / subject distance, optionally with aperture: "35 mm", "24 mm f/1.4", "1.33 m"
  /^\d+(?:\.\d+)?\s*(?:mm|cm|m)(?:\s+f\/?\d+(?:\.\d+)?)?$/i,
  // Shutter speed, incl. vulgar/superscript fractions: "¹⁄₇₅₀ sec", "¹⁄₄₀₀ sec at f/5.6"
  /^[\d\s./¼-¾⁄¹²³⁰-₟]+\s*sec\b/i,
  // Exposure compensation: "½ ev", "0 ev"
  /^[-+]?[\d\s./¼-¾⁄¹²³⁰-₟]+\s*ev$/i,
  // Bare numbers: GPS coordinates and opaque numeric ids
  /^[-+]?\d+(?:\.\d+)?$/,
  // Degrees-minutes-seconds coordinates: "33°59'13.61 n 118°28'31.53 w"
  /^\d+\s*°/,
  // Camera bodies and lenses
  /^(?:canon|nikon|sony|leica|fuji(?:film)?|panasonic|olympus|gopro|dji|pentax|ricoh|sigma|tamron|hasselblad|minolta|contax|mamiya)\b/i,
  // Flash state and exposure program
  /^(?:no flash|flash fired|unknown flash|aperture priority|shutter priority|center-weighted average)$/i,
  // Ingest provenance not already caught by OPERATIONAL_TAG_PATTERN
  /^(?:win-ingest|content-image|slack-file|zip|original-jpeg|licensed-source|pdf-extracted|color-context-corrected)$/i,
  // URLs and filenames
  /^(?:https?:\/\/|www\.)/i,
  /\.(?:jpe?g|png|gif|webp|heic|mp4|mov|dng|tiff?)$/i,
  // Leading punctuation: "!flickr", "#sketching14"
  /^[#!@~*+.]/,
  // Symbols only
  /^[^\p{L}\p{N}]+$/u,
];

/**
 * True when a tag is worth offering as a gallery filter. False for system
 * tags, control tags, ingest provenance, and machine-generated EXIF values.
 */
export const isBrowsableTag = (tag: string): boolean => {
  const raw = tag.trim();
  if (raw.length <= 1) return false;
  if (isSystemTag(raw) || isControlTag(raw) || isOperationalProvenanceTag(raw)) return false;
  return !MACHINE_TAG_PATTERNS.some((pattern) => pattern.test(raw));
};

/**
 * Collapses surface variants of the same concept onto one key so that
 * `Technology`/`technology`, `off-road`/`offroad` and `sport`/`sports` are
 * treated as a single tag. Used for both facet grouping and filter matching,
 * which must agree or the dropdown offers a label the server cannot match.
 */
export const normalizeTagKey = (tag: string): string => {
  const key = tag.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (key.length > 4 && key.endsWith('ies')) return `${key.slice(0, -3)}y`;
  if (key.length > 3 && key.endsWith('s') && !key.endsWith('ss')) return key.slice(0, -1);
  return key;
};
