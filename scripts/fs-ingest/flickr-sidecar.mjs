// Sidecar support for Flickr's "Request my Flickr data" export.
//
// The export ships as multiple zip archives. Photo binaries live in
// `data-download-<n>.zip` and per-photo JSON sidecars (`photo_<id>.json`)
// live in a separate "account data" archive. Sidecars contain richer
// metadata than the Flickr API exposes in `extras`: human-readable
// license string, full description, album membership, privacy state,
// curated tags, original-quality URL, and more.
//
// This module assumes the user has merged sidecars into the photo
// directory (or any subdirectory of --root). It provides pure helpers
// that fs-ingest.mjs uses to enrich uploads with sidecar metadata.

import fs from 'node:fs/promises';
import path from 'node:path';

// Photo IDs in modern Flickr filenames are 8+ digits. Real Flickr photo IDs
// are typically 10-11 digits, but older accounts can have shorter IDs.
const DIGIT_RUN_PATTERN = /(\d{8,})/g;
const SIDECAR_FILE_PATTERN = /^photo_(\d{8,})\.json$/;

/**
 * Extract every plausible Flickr photo ID candidate from a filename.
 * Returns candidates in left-to-right order; callers should prefer the
 * rightmost candidate (Flickr's export places the photo ID at the end,
 * just before any optional `_<secret>` and `_<size>` segments) but fall
 * back to others when the rightmost has no matching sidecar.
 *
 * Filename patterns seen in Flickr exports:
 *   "title_42342142421_o.jpg"
 *   "42342142421_abcdef1234_o.jpg"
 *   "42342142421_o.jpg"
 *   "title_42342142421_b.jpg"   (non-original sizes)
 *   "42342142421.jpg"
 */
export function extractFlickrPhotoIdCandidates(filename) {
  const base = path.basename(String(filename || ''));
  return [...base.matchAll(DIGIT_RUN_PATTERN)].map((match) => match[1]);
}

/**
 * Look up a sidecar for a filename against an index. Tries each digit-run
 * candidate from the filename starting at the rightmost (the photo ID's
 * canonical position), returning the first match.
 *
 * Returns { photoId, sidecarPath } or null.
 */
export function lookupSidecarForFile(filename, sidecarIndex) {
  const candidates = extractFlickrPhotoIdCandidates(filename);
  for (const candidate of [...candidates].reverse()) {
    const sidecarPath = sidecarIndex.get(candidate);
    if (sidecarPath) {
      return { photoId: candidate, sidecarPath };
    }
  }
  return null;
}

/**
 * Walk a directory tree and return a Map<photoId, sidecarPath> for every
 * file named `photo_<digits>.json`. Skips dotfiles and dot-directories.
 */
export async function buildSidecarIndex(rootDir) {
  const index = new Map();
  const queue = [rootDir];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (!dir) continue;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const match = entry.name.match(SIDECAR_FILE_PATTERN);
      if (!match) continue;
      index.set(match[1], abs);
    }
  }
  return index;
}

/**
 * Map Flickr's privacy strings to the visibility vocabulary used by
 * FlickrSourceRecord (matches the API-based ingest's convention).
 */
export function normalizeFlickrPrivacy(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (!raw) return undefined;
  if (raw === 'public') return 'public';
  if (raw === 'private') return 'private';
  const hasFriend = raw.includes('friend');
  const hasFamily = raw.includes('family');
  if (hasFriend && hasFamily) return 'friends-family';
  if (hasFriend) return 'friends';
  if (hasFamily) return 'family';
  return raw;
}

/**
 * Parse and defensively normalize a Flickr sidecar JSON file.
 * Returns a sidecar object with consistent field types regardless of
 * minor schema variation across Flickr export vintages.
 */
export async function loadSidecar(sidecarPath) {
  const raw = await fs.readFile(sidecarPath, 'utf8');
  const parsed = JSON.parse(raw);
  return normalizeSidecar(parsed);
}

export function normalizeSidecar(json) {
  if (!json || typeof json !== 'object') return null;

  const tags = Array.isArray(json.tags)
    ? json.tags
        .map((entry) => {
          if (entry && typeof entry === 'object') {
            const raw = entry.tag ?? entry._content ?? '';
            return String(raw).trim();
          }
          return String(entry || '').trim();
        })
        .filter(Boolean)
    : [];

  const albums = Array.isArray(json.albums)
    ? json.albums
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const id = String(entry.id || '').trim();
          const title = String(entry.title || '').trim();
          return title ? { id, title } : null;
        })
        .filter(Boolean)
    : [];

  const stringField = (value) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  };

  return {
    id: String(json.id || '').trim(),
    name: stringField(json.name),
    description: stringField(json.description),
    dateTaken: stringField(json.date_taken),
    dateImported: stringField(json.date_imported),
    photopage: stringField(json.photopage),
    original: stringField(json.original),
    license: stringField(json.license),
    privacy: normalizeFlickrPrivacy(json.privacy),
    safety: stringField(json.safety),
    tags,
    albums,
  };
}

function uniqueLowercase(values, limit = 12) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (out.length >= limit) break;
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * Merge sidecar metadata over the base upload config. Sidecar values
 * (where present) take precedence; base values fill in where the
 * sidecar is empty.
 */
export function enrichUploadFromSidecar({
  baseTags = [],
  baseDescription,
  baseFolder,
  baseDisplayName,
  baseSourceUrl,
  baseOriginalUrl,
  descriptionPrefix,
  sidecar,
  folderFromAlbum = true,
  albumTags = false,
  tagLimit = 12,
}) {
  if (!sidecar) {
    return {
      tags: uniqueLowercase(baseTags, tagLimit),
      folder: baseFolder,
      description: baseDescription,
      displayName: baseDisplayName,
      sourceUrl: baseSourceUrl,
      originalUrl: baseOriginalUrl,
    };
  }

  const tagSources = [...baseTags, ...sidecar.tags];
  if (albumTags) {
    tagSources.push(...sidecar.albums.map((album) => album.title));
  }
  tagSources.push('flickr');
  const tags = uniqueLowercase(tagSources, tagLimit);

  const folder = folderFromAlbum && sidecar.albums.length > 0
    ? sidecar.albums[0].title
    : baseFolder;

  const prefix = String(descriptionPrefix || '').trim();
  const sidecarDescription = sidecar.description || '';
  const descriptionParts = [];
  if (prefix) descriptionParts.push(prefix);
  if (sidecarDescription) descriptionParts.push(sidecarDescription);
  const description = descriptionParts.length > 0
    ? descriptionParts.join(' | ')
    : baseDescription;

  return {
    tags,
    folder,
    description,
    displayName: sidecar.name || baseDisplayName,
    sourceUrl: sidecar.photopage || baseSourceUrl,
    originalUrl: sidecar.original || baseOriginalUrl,
  };
}

/**
 * Build a FlickrSourceRecord payload suitable for PATCH /api/images/[id]/extras.
 * Strips undefined fields so the patch round-trips cleanly.
 */
export function buildFlickrSourceRecord({ sidecar, contentHash }) {
  if (!sidecar) return null;
  const record = {
    photoId: sidecar.id,
    permalink: sidecar.photopage,
    visibility: sidecar.privacy,
    safety: sidecar.safety,
    license: sidecar.license,
    takenAt: sidecar.dateTaken,
    dateImported: sidecar.dateImported,
    albumTitles: sidecar.albums.map((album) => album.title),
    tagList: sidecar.tags,
    selectedSourceUrl: sidecar.original,
    downloadedContentHash: contentHash,
    importSource: 'flickr-export',
  };

  // Drop empty arrays and undefined so the persisted record stays compact.
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value === undefined || value === null) {
      delete record[key];
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      delete record[key];
    }
  }

  return record;
}
