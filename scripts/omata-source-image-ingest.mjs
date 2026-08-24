#!/usr/bin/env node

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

import {
  patchPhotariumExtras,
  updatePhotariumImage,
  uploadImageToPhotarium,
} from './flickr-ingest/photarium-client.mjs';

const execFileAsync = promisify(execFile);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif']);
const AVATAR_DIRECTORY_NAMES = new Set(['avatars', 'avatars_40x40']);
const RECYCLE_DIRECTORY_NAMES = new Set(['#recycle']);
const AVATAR_FILENAME_PATTERN = /(?:^|[._ -])(avatar|avatar[_ -]?small|profile[_ -]?pic|user[_ -]?image|slackbot)(?:[._ -]|$)/i;
const DEFAULT_ROOT = '/Volumes/omata/OMATA Process Diary';
const DEFAULT_NAMESPACE = 'omata-archive';
const DEFAULT_API_BASE = process.env.PHOTARIUM_BASE_URL || 'http://localhost:3000';
const DEFAULT_STAGING_DIR = path.join(os.tmpdir(), 'omata-source-image-ingest');
const DEFAULT_MANIFEST = path.resolve('data', 'omata-ingest', 'omata-archive-manifest.json');

function printUsage() {
  console.log(`Omata source-image reconciliation and Photarium ingest

Usage:
  node scripts/omata-source-image-ingest.mjs [options]

Options:
  --root <dir>              Omata Process Diary root (default: ${DEFAULT_ROOT})
  --namespace <name>        Photarium namespace (default: ${DEFAULT_NAMESPACE})
  --api-base <url>          Photarium API base (default: ${DEFAULT_API_BASE})
  --manifest <path>         Manifest/checkpoint path (default: ${DEFAULT_MANIFEST})
  --staging-dir <path>      Temporary PDF extraction directory (default: ${DEFAULT_STAGING_DIR})
  --concurrency <n>         Upload concurrency (default: 2)
  --limit <n>               Limit unique upload groups after reconciliation
  --dry-run                 Inventory and reconcile without uploading
  --upload                  Upload reconciled source images and fallbacks
  --verbose                 Print detailed progress
  --help                    Show this help
`);
}

function parseArgs(argv) {
  const options = {
    root: DEFAULT_ROOT,
    namespace: DEFAULT_NAMESPACE,
    apiBase: DEFAULT_API_BASE,
    manifest: DEFAULT_MANIFEST,
    stagingDir: DEFAULT_STAGING_DIR,
    concurrency: 2,
    limit: 0,
    dryRun: false,
    upload: false,
    verbose: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--upload') options.upload = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--root') { options.root = next; index += 1; }
    else if (arg === '--namespace') { options.namespace = next; index += 1; }
    else if (arg === '--api-base') { options.apiBase = next.replace(/\/+$/, ''); index += 1; }
    else if (arg === '--manifest') { options.manifest = path.resolve(next); index += 1; }
    else if (arg === '--staging-dir') { options.stagingDir = path.resolve(next); index += 1; }
    else if (arg === '--concurrency') { options.concurrency = Math.max(1, Number.parseInt(next, 10)); index += 1; }
    else if (arg === '--limit') { options.limit = Math.max(0, Number.parseInt(next, 10)); index += 1; }
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.dryRun && !options.upload) options.dryRun = true;
  if (options.dryRun && options.upload) throw new Error('Choose either --dry-run or --upload, not both.');
  return options;
}

const normalizePath = (value) => value.split(path.sep).join('/');
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function pathSegments(filePath) {
  return normalizePath(filePath).split('/').filter(Boolean).map((segment) => segment.toLowerCase());
}

function avatarExclusion(filePath) {
  const segments = pathSegments(filePath);
  const directory = segments.some((segment) => AVATAR_DIRECTORY_NAMES.has(segment));
  const filename = path.basename(filePath);
  const filenameMatch = AVATAR_FILENAME_PATTERN.test(filename);
  if (directory) return { excluded: true, reason: 'avatar-directory' };
  if (filenameMatch) return { excluded: true, reason: 'avatar-like-filename' };
  return { excluded: false };
}

function isImagePath(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function sourceClass(filePath, root) {
  const relative = normalizePath(path.relative(root, filePath)).toLowerCase();
  return relative.startsWith('omata-slackbooks/') ? 'book-production' : 'slack-file';
}

function assetRole(filePath) {
  const value = normalizePath(filePath).toLowerCase();
  if (/(^|[\/_ -])(cover|frontcover|backcover)([._/ -]|$)/.test(value)) return 'cover';
  if (/(^|[\/_ -])title(page)?([._/ -]|$)/.test(value)) return 'title-page';
  if (/(^|[\/_ -])spine([._/ -]|$)/.test(value)) return 'spine';
  if (/(^|[\/_ -])logo([._/ -]|$)/.test(value)) return 'logo';
  if (/(^|[\/_ -])(production|asset|art|indesign)([._/ -]|$)/.test(value)) return 'production-art';
  return 'content-image';
}

async function walkFiles(root, predicate, onProgress, { pruneAvatars = true } = {}) {
  const files = [];
  const queue = [root];
  let directories = 0;
  while (queue.length > 0) {
    const directory = queue.shift();
    if (!directory) continue;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      onProgress?.(`walk-skip ${directory}: ${error.message}`);
      continue;
    }
    directories += 1;
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name === '.git') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const directoryName = entry.name.toLowerCase();
        if (!entry.name.startsWith('.') && !RECYCLE_DIRECTORY_NAMES.has(directoryName) && (!pruneAvatars || !AVATAR_DIRECTORY_NAMES.has(directoryName))) queue.push(absolute);
        continue;
      }
      if (entry.isFile() && predicate(absolute)) files.push(absolute);
    }
    if (directories % 50 === 0) onProgress?.(`walk directories=${directories} files=${files.length}`);
  }
  return files;
}

async function hashImage(filePath) {
  const buffer = await fs.readFile(filePath);
  const image = sharp(buffer, { failOn: 'none' });
  const metadata = await image.metadata();
  const normalized = await image
    .rotate()
    .resize({ width: 32, height: 32, fit: 'fill' })
    .removeAlpha()
    .grayscale()
    .raw()
    .toBuffer();
  const average = normalized.reduce((sum, value) => sum + value, 0) / Math.max(1, normalized.length);
  let perceptualHash = '';
  for (const value of normalized) perceptualHash += value >= average ? '1' : '0';
  return {
    contentHash: sha256(buffer),
    normalizedHash: sha256(normalized),
    perceptualHash,
    width: metadata.width || 0,
    height: metadata.height || 0,
    format: metadata.format || path.extname(filePath).slice(1).toLowerCase(),
    bytes: buffer.length,
  };
}

function hammingDistance(left, right) {
  if (!left || !right || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) distance += 1;
  return distance;
}

async function discoverSourceFiles(root, options) {
  const sourceRoots = [
    path.join(root, 'SlackExporterForOmata'),
    path.join(root, 'OMATA-SlackBooks'),
  ];
  const candidates = [];
  for (const sourceRoot of sourceRoots) {
    try { await fs.access(sourceRoot); } catch { continue; }
    const files = await walkFiles(sourceRoot, isImagePath, (message) => options.verbose && console.log(`[source] ${message}`), { pruneAvatars: false });
    for (const filePath of files) {
      const exclusion = avatarExclusion(filePath);
      candidates.push({
        path: filePath,
        root: sourceRoot,
        sourceClass: sourceClass(filePath, root),
        assetRole: assetRole(filePath),
        excluded: exclusion.excluded,
        exclusionReason: exclusion.reason,
      });
    }
  }
  return candidates;
}

async function discoverBookPdfs(root) {
  const pdfs = [];
  const rootEntries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf') && entry.name.toLowerCase().startsWith('omata-notes')) {
      pdfs.push(path.join(root, entry.name));
    }
  }
  const twoFolder = path.join(root, 'THESE TWO I THINK');
  try {
    for (const entry of await fs.readdir(twoFolder, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) pdfs.push(path.join(twoFolder, entry.name));
    }
  } catch {
    // The folder is an optional historical pointer.
  }
  const slackBooks = path.join(root, 'OMATA-SlackBooks');
  try {
    const files = await walkFiles(slackBooks, (filePath) => /^SlackBook_.*\.pdf$/i.test(path.basename(filePath)));
    pdfs.push(...files);
  } catch {
    // A missing book workspace is reported by the empty inventory.
  }
  return Array.from(new Set(pdfs)).sort((left, right) => left.localeCompare(right));
}

function parsePdfImageList(stdout) {
  return stdout.split(/\r?\n/).flatMap((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 15 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return [];
    return [{
      page: Number(parts[0]),
      objectIndex: Number(parts[1]),
      type: parts[2],
      width: Number(parts[3]) || 0,
      height: Number(parts[4]) || 0,
      color: parts[5],
      bitsPerComponent: Number(parts[7]) || 0,
      objectId: `${parts[10]}:${parts[11]}`,
      xPpi: Number(parts[12]) || 0,
      yPpi: Number(parts[13]) || 0,
    }];
  });
}

async function extractPdfImages(pdfPath, pdfHash, stagingDir, verbose) {
  const pdfKey = `${path.basename(pdfPath).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${pdfHash.slice(0, 10)}`;
  const outputDir = path.join(stagingDir, pdfKey);
  await fs.mkdir(outputDir, { recursive: true });
  const prefix = path.join(outputDir, 'embedded');
  const listed = await execFileAsync('pdfimages', ['-list', pdfPath], { maxBuffer: 10 * 1024 * 1024 });
  const imageRecords = parsePdfImageList(listed.stdout);
  const outputPrefix = 'embedded-';
  const completionMarker = path.join(outputDir, 'extraction-complete.json');
  const readOutputs = async () => (await fs.readdir(outputDir))
    .filter((name) => name.startsWith(outputPrefix) && !/-mask\.|-smask\./i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  let outputs = await readOutputs();
  let complete = false;
  try {
    const checkpoint = JSON.parse(await fs.readFile(completionMarker, 'utf8'));
    complete = checkpoint.pdfHash === pdfHash && checkpoint.objectCount === imageRecords.length && outputs.length >= imageRecords.length;
  } catch {
    // A missing or stale marker causes a single resumable extraction retry.
  }
  if (!complete) {
    await execFileAsync('pdfimages', ['-all', pdfPath, prefix], { maxBuffer: 10 * 1024 * 1024 });
    outputs = await readOutputs();
    if (outputs.length >= imageRecords.length) {
      await fs.writeFile(completionMarker, JSON.stringify({ pdfHash, objectCount: imageRecords.length, extractedCount: outputs.length }) + '\n', 'utf8');
    }
  }
  if (verbose && outputs.length < imageRecords.length) {
    console.log(`[pdf] output-count-mismatch ${path.basename(pdfPath)} listed=${imageRecords.length} extracted=${outputs.length}`);
  }
  let outputIndex = 0;
  return imageRecords.flatMap((record) => {
    const extractedPath = outputIndex < outputs.length ? path.join(outputDir, outputs[outputIndex]) : undefined;
    outputIndex += 1;
    return record.type === 'image' ? [{ ...record, extractedPath }] : [];
  });
}

async function buildSourceIndex(sourceCandidates) {
  const active = sourceCandidates.filter((candidate) => !candidate.excluded);
  const indexed = [];
  for (let index = 0; index < active.length; index += 1) {
    const candidate = active[index];
    try {
      indexed.push({ ...candidate, image: await hashImage(candidate.path) });
    } catch (error) {
      candidate.excluded = true;
      candidate.exclusionReason = `source-read-failed:${error.message}`;
    }
    if ((index + 1) % 50 === 0 || index + 1 === active.length) {
      console.log(`[source] analyzed=${index + 1}/${active.length}`);
    }
  }
  const byContent = new Map();
  const byNormalized = new Map();
  for (const item of indexed) {
    if (!byContent.has(item.image.contentHash)) byContent.set(item.image.contentHash, []);
    if (!byNormalized.has(item.image.normalizedHash)) byNormalized.set(item.image.normalizedHash, []);
    byContent.get(item.image.contentHash).push(item);
    byNormalized.get(item.image.normalizedHash).push(item);
  }
  return { indexed, byContent, byNormalized };
}

function chooseSourceMatch(image, sourceIndex) {
  const exact = sourceIndex.byContent.get(image.contentHash) || [];
  if (exact.length === 1) return { match: exact[0], method: 'content-hash', score: 0 };
  const normalized = sourceIndex.byNormalized.get(image.normalizedHash) || [];
  if (normalized.length === 1) return { match: normalized[0], method: 'normalized-pixel-hash', score: 0 };
  const candidates = normalized.length > 1 ? normalized : sourceIndex.indexed;
  let best = null;
  for (const candidate of candidates) {
    const distance = hammingDistance(image.perceptualHash, candidate.image.perceptualHash);
    if (!best || distance < best.score) best = { match: candidate, method: 'perceptual-hash', score: distance };
  }
  if (best && best.score <= 24) return best;
  return { match: null, method: 'unresolved', score: null };
}

function possibleUnmatchedAvatar(record) {
  return record.width > 0 && record.height > 0 && Math.max(record.width, record.height) <= 128;
}

function bookSlug(pdfPath) {
  return path.basename(pdfPath, path.extname(pdfPath)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function classifyBook(pdfPath) {
  const name = path.basename(pdfPath).toLowerCase();
  if (name.includes('developers')) return 'omata-developers';
  if (name.includes('haltian')) return 'omata-haltian';
  if (name.includes('brand')) return 'omata-brand';
  if (name.includes('week') || name.includes('omata-notes')) return 'hardware-startup-diary';
  return 'omata-book';
}

function unique(values) { return Array.from(new Set(values.filter(Boolean))); }

async function buildManifest(options) {
  const root = path.resolve(options.root);
  const sourceCandidates = await discoverSourceFiles(root, options);
  const sourceIndex = await buildSourceIndex(sourceCandidates);
  const pdfPaths = await discoverBookPdfs(root);
  const books = [];
  const candidateRecords = [];
  for (const pdfPath of pdfPaths) {
    const pdfBytes = await fs.readFile(pdfPath);
    const pdfHash = sha256(pdfBytes);
    const extracted = await extractPdfImages(pdfPath, pdfHash, options.stagingDir, options.verbose);
    const book = { path: pdfPath, slug: bookSlug(pdfPath), category: classifyBook(pdfPath), pdfHash, imageObjects: extracted.length };
    books.push(book);
    for (let index = 0; index < extracted.length; index += 1) {
      const embedded = extracted[index];
      let image;
      try { image = await hashImage(embedded.extractedPath); } catch (error) {
        candidateRecords.push({ pdfPath, bookSlug: book.slug, page: embedded.page, objectIndex: embedded.objectIndex, status: 'unresolved', exclusionReason: `embedded-read-failed:${error.message}` });
        continue;
      }
      const match = chooseSourceMatch(image, sourceIndex);
      const source = match.match;
      const avatarPath = source ? avatarExclusion(source.path) : { excluded: false };
      const shouldExcludeAvatar = avatarPath.excluded || (!source && possibleUnmatchedAvatar(embedded));
      const record = {
        id: `${book.slug}:${embedded.page}:${embedded.objectIndex}`,
        pdfPath,
        bookSlug: book.slug,
        category: book.category,
        page: embedded.page,
        objectIndex: embedded.objectIndex,
        objectId: embedded.objectId,
        embeddedPath: embedded.extractedPath,
        extractionMode: source ? 'source-original' : 'pdf-embedded-fallback',
        sourcePath: source?.path,
        sourceClass: source?.sourceClass,
        assetRole: source?.assetRole || 'content-image',
        matchMethod: match.method,
        matchScore: match.score,
        image,
        status: shouldExcludeAvatar ? 'excluded' : source ? 'reconciled' : 'reconciled-fallback',
        exclusionReason: shouldExcludeAvatar ? (avatarPath.reason || 'unmatched-small-image-possible-avatar') : undefined,
      };
      record.uploadPath = shouldExcludeAvatar ? undefined : source?.path || embedded.extractedPath;
      record.uploadHash = shouldExcludeAvatar ? undefined : source?.image.contentHash || image.contentHash;
      record.dedupKey = shouldExcludeAvatar ? undefined : source?.image.normalizedHash || image.normalizedHash;
      candidateRecords.push(record);
    }
  }
  const groups = new Map();
  for (const record of candidateRecords) {
    if (!record.dedupKey) continue;
    if (!groups.has(record.dedupKey)) groups.set(record.dedupKey, { dedupKey: record.dedupKey, records: [], uploadPath: record.uploadPath, sourceOriginal: record.extractionMode === 'source-original' });
    const group = groups.get(record.dedupKey);
    group.records.push(record.id);
    if (record.extractionMode === 'source-original' && !group.sourceOriginal) {
      group.uploadPath = record.uploadPath;
      group.sourceOriginal = true;
    }
  }
  const manifest = {
    version: 1,
    namespace: options.namespace,
    root,
    generatedAt: new Date().toISOString(),
    sourceRoots: [path.join(root, 'SlackExporterForOmata'), path.join(root, 'OMATA-SlackBooks')],
    books,
    sourceSummary: {
      candidates: sourceCandidates.length,
      excludedAvatars: sourceCandidates.filter((candidate) => candidate.excluded && candidate.exclusionReason?.startsWith('avatar')).length,
      excludedRecycle: sourceCandidates.filter((candidate) => candidate.excluded && candidate.exclusionReason === 'recycle-directory').length,
      indexed: sourceIndex.indexed.length,
    },
    records: candidateRecords,
    uploadGroups: Array.from(groups.values()),
  };
  return manifest;
}

async function saveManifest(filePath, manifest) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await fs.rename(temporary, filePath);
}

function recordForGroup(manifest, group) {
  return manifest.records.filter((record) => group.records.includes(record.id));
}

function buildMetadata(manifest, group, records) {
  const first = records[0];
  const relativeSource = first.sourcePath ? normalizePath(path.relative(manifest.root, first.sourcePath)) : normalizePath(path.relative(manifest.root, first.embeddedPath));
  const books = unique(records.map((record) => record.bookSlug));
  const channels = unique(records.map((record) => record.category));
  const tags = unique(['omata', 'omata-archive', ...books.map((book) => `book-${book}`), ...channels, first.sourceClass || 'pdf-embedded-fallback', first.assetRole || 'content-image', first.extractionMode]);
  const appearances = records.map((record) => `${record.bookSlug} p.${record.page}`).join(', ');
  const description = `Omata archive source image. Source: ${relativeSource}. Appears in: ${appearances.slice(0, 1300)}.`;
  const displayName = path.basename(group.uploadPath, path.extname(group.uploadPath)).replace(/[_-]+/g, ' ').trim();
  const altTag = `Omata archive image from ${books.join(', ')}; source ${path.basename(group.uploadPath)}.`;
  return { tags, description, displayName, altTag, relativeSource };
}

function imageIdFromPayload(payload) {
  return payload?.id || payload?.imageId || payload?.data?.id || payload?.result?.id || payload?.image?.id;
}

function duplicateIdFromPayload(payload) {
  const duplicate = Array.isArray(payload?.duplicates) ? payload.duplicates.find((entry) => entry?.id) : null;
  return duplicate?.id;
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function readImage(apiBase, imageId) {
  const response = await fetch(`${apiBase}/api/images/${encodeURIComponent(imageId)}`);
  const payload = await readJson(response);
  if (!response.ok) throw new Error(payload?.error || `Metadata readback failed (${response.status})`);
  return payload;
}

async function uploadGroup(manifest, group, options) {
  const records = recordForGroup(manifest, group);
  const metadata = buildMetadata(manifest, group, records);
  const prefix = `[upload] ${path.basename(group.uploadPath)} from -> ${manifest.namespace}`;
  console.log(`${prefix} appearances=${records.length} reason=source-reconciliation`);
  const buffer = await fs.readFile(group.uploadPath);
  const result = await uploadImageToPhotarium({
    apiBase: options.apiBase,
    buffer,
    fileName: path.basename(group.uploadPath),
    contentType: undefined,
    metadata: {
      namespace: manifest.namespace,
      tags: metadata.tags,
      description: metadata.description,
      displayName: metadata.displayName,
      sourceUrl: `local://${metadata.relativeSource}`,
      duplicateAction: 'reject',
      generateSemanticTags: true,
      semanticTagCount: 6,
    },
  });
  let imageId = imageIdFromPayload(result.payload);
  const duplicate = result.status === 409;
  if (!result.ok && duplicate) imageId = duplicateIdFromPayload(result.payload);
  if (!imageId) throw new Error(`${result.status} ${JSON.stringify(result.payload).slice(0, 500)}`);
  await updatePhotariumImage({ apiBase: options.apiBase, imageId, metadata: { namespace: manifest.namespace, tags: metadata.tags, description: metadata.description, displayName: metadata.displayName, altTag: metadata.altTag, sourceUrl: `local://${metadata.relativeSource}` } });
  await patchPhotariumExtras({ apiBase: options.apiBase, imageId, patch: { description: metadata.description, altText: metadata.altTag } });
  const readback = await readImage(options.apiBase, imageId);
  group.status = duplicate ? 'duplicate-verified' : 'uploaded-verified';
  group.imageId = imageId;
  group.readback = { id: readback?.id || readback?.image?.id || imageId, namespace: readback?.namespace || readback?.image?.namespace, filename: readback?.filename || readback?.image?.filename, variants: readback?.variants || readback?.image?.variants };
  console.log(`[upload] ${duplicate ? 'already-target-verified' : 'verified-update'} ${imageId} file=${path.basename(group.uploadPath)} from -> ${manifest.namespace}`);
}

async function runUploads(manifest, options) {
  const groups = options.limit > 0 ? manifest.uploadGroups.slice(0, options.limit) : manifest.uploadGroups;
  let cursor = 0;
  const worker = async () => {
    while (cursor < groups.length) {
      const group = groups[cursor];
      cursor += 1;
      try {
        await uploadGroup(manifest, group, options);
      } catch (error) {
        group.status = 'failed';
        group.error = error instanceof Error ? error.message : String(error);
        console.error(`[upload] failed ${path.basename(group.uploadPath)} reason=${group.error}`);
      }
      await saveManifest(options.manifest, manifest);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, groups.length) }, () => worker()));
}

function printSummary(manifest, options) {
  const records = manifest.records;
  const groups = manifest.uploadGroups;
  const counts = {
    books: manifest.books.length,
    pdfImageObjects: records.length,
    sourceOriginal: records.filter((record) => record.extractionMode === 'source-original').length,
    embeddedFallback: records.filter((record) => record.extractionMode === 'pdf-embedded-fallback').length,
    excludedAvatars: records.filter((record) => record.status === 'excluded').length + manifest.sourceSummary.excludedAvatars,
    unresolved: records.filter((record) => record.status === 'unresolved').length,
    uniqueUploadGroups: groups.length,
    verified: groups.filter((group) => group.status?.endsWith('verified')).length,
    failed: groups.filter((group) => group.status === 'failed').length,
  };
  console.log(`[summary] mode=${options.upload ? 'upload' : 'dry-run'} namespace=${manifest.namespace}`);
  console.log(`[summary] books=${counts.books} pdf-image-objects=${counts.pdfImageObjects} unique-upload-groups=${counts.uniqueUploadGroups}`);
  console.log(`[summary] source-original=${counts.sourceOriginal} pdf-embedded-fallback=${counts.embeddedFallback} excluded-avatars=${counts.excludedAvatars} unresolved=${counts.unresolved}`);
  if (options.upload) console.log(`[summary] verified=${counts.verified} failed=${counts.failed}`);
  console.log(`[summary] manifest=${options.manifest}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { printUsage(); return; }
  console.log(`[start] Omata source-image ingest namespace=${options.namespace} mode=${options.upload ? 'upload' : 'dry-run'}`);
  console.log(`[start] root=${options.root} staging=${options.stagingDir}`);
  const manifest = await buildManifest(options);
  await saveManifest(options.manifest, manifest);
  if (options.upload) await runUploads(manifest, options);
  printSummary(manifest, options);
}

main().catch((error) => {
  console.error(`[fatal] ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
});
