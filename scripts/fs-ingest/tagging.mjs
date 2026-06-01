export function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function uniqueStrings(items) {
  return Array.from(new Set(items.map((s) => s.trim()).filter(Boolean)));
}

export function mergeTagsWithOptionalTail(base, tail, limit = 12) {
  const merged = uniqueStrings(base).slice(0, Math.max(0, limit));
  const extra = String(tail || "").trim();
  if (!extra) return merged;
  if (merged.includes(extra)) return merged;
  if (merged.length < limit) return [...merged, extra];
  return [...merged.slice(0, Math.max(0, limit - 1)), extra];
}

export function normalizeTag(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^\w\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
