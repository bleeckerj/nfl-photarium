import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const METADATA_LIMIT_BYTES = 1024;
export const ASSIGNMENT_PLAN_KIND = 'missing-namespace-assignment';
export const ASSIGNMENT_PLAN_VERSION = 2;

export const parseMetadata = (meta) => {
  if (!meta) return {};
  if (typeof meta === 'string') {
    try {
      const parsed = JSON.parse(meta);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
};

export const isMissingNamespace = (metadata) => {
  const namespace = typeof metadata.namespace === 'string' ? metadata.namespace.trim() : '';
  return !namespace;
};

export const getMetadataNamespace = (metadata) =>
  typeof metadata.namespace === 'string' ? metadata.namespace.trim() : '';

export const metadataByteSize = (payload) =>
  Buffer.byteLength(JSON.stringify(payload), 'utf8');

export const enforceMetadataLimitPreservingNamespace = (payload) => {
  const trimmed = { ...payload };
  let size = metadataByteSize(trimmed);
  const dropped = [];
  const dropOrder = [
    'exif',
    'description',
    'tags',
    'originalUrlNormalized',
    'originalUrl',
    'sourceUrlNormalized',
    'sourceUrl',
    'folder',
    'displayName',
    'filename',
    'contentHash',
    'uploadedAt',
    'type',
    'size',
    'variationParentId',
    'linkedAssetId',
    'variationSort',
  ];

  for (const key of dropOrder) {
    if (size <= METADATA_LIMIT_BYTES) break;
    if (Object.prototype.hasOwnProperty.call(trimmed, key)) {
      delete trimmed[key];
      dropped.push(key);
      size = metadataByteSize(trimmed);
    }
  }

  if (size > METADATA_LIMIT_BYTES) {
    const stringKeys = Object.keys(trimmed)
      .filter((key) => key !== 'namespace' && typeof trimmed[key] === 'string')
      .sort((a, b) => String(trimmed[b]).length - String(trimmed[a]).length);

    for (const key of stringKeys) {
      if (size <= METADATA_LIMIT_BYTES) break;
      delete trimmed[key];
      dropped.push(key);
      size = metadataByteSize(trimmed);
    }
  }

  return { metadata: trimmed, dropped, size };
};

export const sortMissingNamespaceImages = (items) =>
  [...items].sort((a, b) => {
    const uploadedA = Date.parse(a.image.uploaded || '');
    const uploadedB = Date.parse(b.image.uploaded || '');
    const scoreA = Number.isFinite(uploadedA) ? uploadedA : 0;
    const scoreB = Number.isFinite(uploadedB) ? uploadedB : 0;
    return scoreB - scoreA || String(a.image.id).localeCompare(String(b.image.id));
  });

export const findMissingNamespaceImages = (images) =>
  sortMissingNamespaceImages(
    images.flatMap((image) => {
      const metadata = parseMetadata(image.meta);
      return isMissingNamespace(metadata) ? [{ image, metadata }] : [];
    })
  );

export const selectAssignmentCandidates = ({ missing, all = false, ids = [], limit }) => {
  const sorted = sortMissingNamespaceImages(missing);
  const selectedIdSet = ids.length > 0 ? new Set(ids) : null;
  const selected = selectedIdSet
    ? sorted.filter(({ image }) => selectedIdSet.has(image.id))
    : all
      ? sorted
      : sorted.slice(0, limit);
  const notFoundIds = selectedIdSet
    ? ids.filter((id) => !selected.some(({ image }) => image.id === id))
    : [];

  return { selected, notFoundIds };
};

const summarizeMetadata = (metadata) => ({
  keys: Object.keys(metadata).sort(),
  displayName: typeof metadata.displayName === 'string' ? metadata.displayName : undefined,
  filename: typeof metadata.filename === 'string' ? metadata.filename : undefined,
  folder: typeof metadata.folder === 'string' ? metadata.folder : undefined,
  tags: Array.isArray(metadata.tags) ? metadata.tags.slice(0, 20) : undefined,
});

const checksumPayload = (plan) => ({
  version: plan.version,
  kind: plan.kind,
  targetNamespace: plan.targetNamespace,
  entries: plan.entries.map((entry) => ({
    id: entry.id,
    uploaded: entry.uploaded,
    filename: entry.filename,
    targetNamespace: entry.targetNamespace,
    currentNamespace: entry.currentNamespace,
    familyRootId: entry.familyRootId,
    reason: entry.reason,
    action: entry.action,
  })),
  ambiguousFamilies: Array.isArray(plan.ambiguousFamilies)
    ? plan.ambiguousFamilies.map((family) => ({
      familyRootId: family.familyRootId,
      namespaces: family.namespaces,
      imageIds: family.imageIds,
    }))
    : undefined,
});

const legacyChecksumPayload = (plan) => ({
  version: plan.version,
  kind: plan.kind,
  targetNamespace: plan.targetNamespace,
  entries: plan.entries.map((entry) => ({
    id: entry.id,
    uploaded: entry.uploaded,
    filename: entry.filename,
  })),
});

export const computeAssignmentPlanChecksum = (plan) =>
  createHash('sha256')
    .update(JSON.stringify(plan.version === 1 ? legacyChecksumPayload(plan) : checksumPayload(plan)))
    .digest('hex');

export const buildAssignmentPlan = ({
  generatedAt = new Date().toISOString(),
  missingCount,
  scanned,
  selected,
  targetNamespace,
}) => {
  const plan = {
    version: ASSIGNMENT_PLAN_VERSION,
    kind: ASSIGNMENT_PLAN_KIND,
    targetNamespace,
    generatedAt,
    scanned,
    missingCount,
    selectedCount: selected.length,
    entries: selected.map(({ image, metadata }) => ({
      id: image.id,
      uploaded: image.uploaded || '',
      filename: image.filename || metadata.filename || '',
      targetNamespace,
      currentNamespace: '',
      action: 'repair-to-target',
      reason: 'single-target missing namespace repair',
      metadataSummary: summarizeMetadata(metadata),
    })),
    checksum: '',
  };
  plan.checksum = computeAssignmentPlanChecksum(plan);
  return plan;
};

export const assertValidAssignmentPlan = (plan) => {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Assignment plan is not an object.');
  }
  if (plan.kind !== ASSIGNMENT_PLAN_KIND || ![1, ASSIGNMENT_PLAN_VERSION].includes(plan.version)) {
    throw new Error('Assignment plan has an unsupported kind or version.');
  }
  if (plan.version === 1 && (!plan.targetNamespace || typeof plan.targetNamespace !== 'string')) {
    throw new Error('Assignment plan is missing targetNamespace.');
  }
  if (!Array.isArray(plan.entries)) {
    throw new Error('Assignment plan is missing entries.');
  }
  if (plan.version >= 2) {
    const missingTarget = plan.entries.find((entry) => !entry.targetNamespace || typeof entry.targetNamespace !== 'string');
    if (missingTarget) {
      throw new Error(`Assignment plan entry ${missingTarget.id || '[unknown]'} is missing targetNamespace.`);
    }
  }
  const expectedChecksum = computeAssignmentPlanChecksum(plan);
  if (plan.checksum !== expectedChecksum) {
    throw new Error('Assignment plan checksum does not match its contents.');
  }
};

const csvEscape = (value) => {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const assignmentPlanToCsv = (plan) => {
  const rows = [[
    'id',
    'uploaded',
    'filename',
    'current_namespace',
    'target_namespace',
    'action',
    'reason',
    'family_root_id',
    'family_namespaces',
    'metadata_keys',
    'display_name',
    'folder',
    'tags',
  ]];
  for (const entry of plan.entries) {
    rows.push([
      entry.id,
      entry.uploaded,
      entry.filename,
      entry.currentNamespace || '',
      entry.targetNamespace || plan.targetNamespace || '',
      entry.action || '',
      entry.reason || '',
      entry.familyRootId || '',
      entry.familyNamespaceEvidence?.map((evidence) => `${evidence.namespace}:${evidence.id}`).join('|') || '',
      entry.metadataSummary?.keys?.join('|') || '',
      entry.metadataSummary?.displayName || '',
      entry.metadataSummary?.folder || '',
      entry.metadataSummary?.tags?.join('|') || '',
    ]);
  }
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
};

export const ambiguousFamiliesToCsv = (plan) => {
  const rows = [[
    'family_root_id',
    'namespaces',
    'image_ids',
    'evidence',
    'missing_image_ids',
    'cf_orphan_image_ids',
  ]];
  for (const family of plan.ambiguousFamilies || []) {
    rows.push([
      family.familyRootId,
      family.namespaces.join('|'),
      family.imageIds.join('|'),
      family.evidence.map((entry) => `${entry.namespace}:${entry.assetType}:${entry.id}`).join('|'),
      family.missingImageIds.join('|'),
      family.fallbackImageIds.join('|'),
    ]);
  }
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
};

const USE_COLOR = process.env.NO_COLOR !== '1' && process.env.NO_COLOR !== 'true';
const color = (code, value) => USE_COLOR ? `\u001B[${code}m${value}\u001B[0m` : value;
const colors = {
  green: (value) => color(32, value),
  yellow: (value) => color(33, value),
  red: (value) => color(31, value),
  blue: (value) => color(34, value),
  cyan: (value) => color(36, value),
  gray: (value) => color(90, value),
  bold: (value) => color(1, value),
};

const readableNamespace = (value) => value || '[missing]';

const actionLabel = (action) => {
  switch (action) {
    case 'repair-to-family-namespace':
      return colors.green('family namespace repair');
    case 'repair-from-fallback-to-family-namespace':
      return colors.cyan('fallback repair');
    case 'repair-to-fallback':
      return colors.yellow('fallback assignment');
    case 'repair-to-target':
      return colors.blue('direct repair');
    default:
      return colors.blue(action || 'namespace repair');
  }
};

export const formatAssignmentLogEntry = ({
  entry,
  status,
  currentNamespace,
  targetNamespace,
  detail,
}) => {
  const statusLabel = {
    verified: colors.green('VERIFIED'),
    would: colors.blue('WOULD UPDATE'),
    skip: colors.yellow('SKIP'),
    already: colors.cyan('ALREADY TARGET'),
    failed: colors.red('FAILED'),
  }[status] || colors.gray(String(status || 'STATUS').toUpperCase());
  const evidence = entry.familyNamespaceEvidence?.length
    ? entry.familyNamespaceEvidence
      .map((item) => `${item.namespace} from ${item.assetType}:${item.id}`)
      .join('; ')
    : 'none';
  const metadataKeys = entry.metadataSummary?.keys?.length
    ? entry.metadataSummary.keys.join(', ')
    : 'none';
  return [
    `${colors.bold('[assign-namespace]')} ${statusLabel} ${actionLabel(entry.action)}`,
    `  image: ${entry.id} ${entry.filename ? `(${entry.filename})` : ''}`,
    `  uploaded: ${entry.uploaded || '[unknown]'}`,
    `  namespace: ${colors.yellow(readableNamespace(currentNamespace))} -> ${colors.green(readableNamespace(targetNamespace))}`,
    `  family root: ${entry.familyRootId || '[self/unknown]'}`,
    `  why: ${entry.reason || detail || 'planned namespace repair'}`,
    `  evidence: ${evidence}`,
    `  metadata keys in plan: ${metadataKeys}`,
    detail ? `  detail: ${detail}` : '',
  ].filter(Boolean).join('\n');
};

const normalizeId = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeImageRecord = (image) => {
  const metadata = parseMetadata(image.meta);
  return {
    assetType: 'image',
    id: normalizeId(image.id),
    filename: image.filename || metadata.filename || '',
    uploaded: image.uploaded || '',
    namespace: getMetadataNamespace(metadata),
    parentId: normalizeId(metadata.variationParentId),
    image,
    metadata,
  };
};

const normalizeEvidenceRecord = (asset) => ({
  assetType: asset.assetType === 'video' ? 'video' : 'image',
  id: normalizeId(asset.id),
  filename: asset.filename || '',
  uploaded: asset.uploaded || '',
  namespace: typeof asset.namespace === 'string' ? asset.namespace.trim() : '',
  parentId: normalizeId(asset.parentId || asset.variationParentId),
});

const resolveFamilyRootId = (asset, byId) => {
  const visited = new Set();
  let current = asset;
  while (current?.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    if (!byId.has(current.parentId)) {
      return current.parentId;
    }
    current = byId.get(current.parentId);
  }
  return current?.id || asset.id;
};

export const buildFamilyAwareAssignmentPlan = ({
  fallbackNamespace,
  generatedAt = new Date().toISOString(),
  images,
  scanned,
  videos = [],
}) => {
  const normalizedFallback = normalizeRegistryNamespace(fallbackNamespace);
  if (!normalizedFallback) {
    throw new Error('A specific fallback namespace is required.');
  }

  const imageRecords = images.map(normalizeImageRecord).filter((record) => record.id);
  const videoRecords = videos.map(normalizeEvidenceRecord).filter((record) => record.id);
  const allRecords = [...imageRecords, ...videoRecords];
  const byId = new Map(allRecords.map((record) => [record.id, record]));

  for (const record of allRecords) {
    record.familyRootId = resolveFamilyRootId(record, byId);
  }

  const families = new Map();
  for (const record of allRecords) {
    const familyRootId = record.familyRootId || record.id;
    const family = families.get(familyRootId) || [];
    family.push(record);
    families.set(familyRootId, family);
  }

  const entries = [];
  const ambiguousFamilies = [];
  let alreadyOkCount = 0;

  for (const [familyRootId, family] of families) {
    const familyImages = family.filter((record) => record.assetType === 'image');
    const namespaceEvidence = family
      .filter((record) => record.namespace && record.namespace !== normalizedFallback)
      .map((record) => ({
        id: record.id,
        assetType: record.assetType,
        namespace: record.namespace,
        parentId: record.parentId || '',
      }));
    const namespaces = Array.from(new Set(namespaceEvidence.map((record) => record.namespace))).sort();
    const missingImages = familyImages.filter((record) => !record.namespace);
    const fallbackImages = familyImages.filter((record) => record.namespace === normalizedFallback);

    if (namespaces.length > 1) {
      ambiguousFamilies.push({
        familyRootId,
        namespaces,
        evidence: namespaceEvidence,
        imageIds: familyImages.map((record) => record.id).sort(),
        missingImageIds: missingImages.map((record) => record.id).sort(),
        fallbackImageIds: fallbackImages.map((record) => record.id).sort(),
      });
      continue;
    }

    const inferredNamespace = namespaces[0] || '';
    for (const record of familyImages) {
      const familyNamespaceEvidence = namespaceEvidence;
      if (!record.namespace) {
        entries.push({
          id: record.id,
          uploaded: record.uploaded,
          filename: record.filename,
          currentNamespace: '',
          targetNamespace: inferredNamespace || normalizedFallback,
          action: inferredNamespace ? 'repair-to-family-namespace' : 'repair-to-fallback',
          reason: inferredNamespace
            ? 'missing namespace repaired from single family namespace'
            : 'missing namespace with no family namespace evidence',
          familyRootId,
          familyNamespaceEvidence,
          metadataSummary: summarizeMetadata(record.metadata),
        });
        continue;
      }

      if (record.namespace === normalizedFallback && inferredNamespace) {
        entries.push({
          id: record.id,
          uploaded: record.uploaded,
          filename: record.filename,
          currentNamespace: record.namespace,
          targetNamespace: inferredNamespace,
          action: 'repair-from-fallback-to-family-namespace',
          reason: 'fallback namespace repaired from single family namespace',
          familyRootId,
          familyNamespaceEvidence,
          metadataSummary: summarizeMetadata(record.metadata),
        });
        continue;
      }

      alreadyOkCount += 1;
    }
  }

  entries.sort((left, right) => {
    const leftTime = Date.parse(left.uploaded || '');
    const rightTime = Date.parse(right.uploaded || '');
    const leftScore = Number.isFinite(leftTime) ? leftTime : 0;
    const rightScore = Number.isFinite(rightTime) ? rightTime : 0;
    return rightScore - leftScore || left.id.localeCompare(right.id);
  });

  const plan = {
    version: ASSIGNMENT_PLAN_VERSION,
    kind: ASSIGNMENT_PLAN_KIND,
    mode: 'family-aware',
    fallbackNamespace: normalizedFallback,
    generatedAt,
    scanned,
    imageCount: imageRecords.length,
    videoEvidenceCount: videoRecords.length,
    selectedCount: entries.length,
    alreadyOkCount,
    ambiguousFamilyCount: ambiguousFamilies.length,
    entries,
    ambiguousFamilies,
    checksum: '',
  };
  plan.checksum = computeAssignmentPlanChecksum(plan);
  return plan;
};

const sortAssetsForReport = (assets) =>
  [...assets].sort((left, right) => {
    const leftTime = Date.parse(left.uploaded || '');
    const rightTime = Date.parse(right.uploaded || '');
    const leftScore = Number.isFinite(leftTime) ? leftTime : 0;
    const rightScore = Number.isFinite(rightTime) ? rightTime : 0;
    return rightScore - leftScore || left.id.localeCompare(right.id);
  });

export const buildMissingNamespaceReport = ({ ids = [], images, videos = [] }) => {
  const idSet = ids.length > 0 ? new Set(ids.map(normalizeId).filter(Boolean)) : null;
  const imageRecords = images.map(normalizeImageRecord).filter((record) => record.id);
  const videoRecords = videos.map(normalizeEvidenceRecord).filter((record) => record.id);
  const allRecords = [...imageRecords, ...videoRecords].filter((record) => !idSet || idSet.has(record.id));
  const missingAssets = allRecords.filter((record) => !record.namespace);
  const presentAssets = allRecords.filter((record) => record.namespace);
  const foundIds = new Set(allRecords.map((record) => record.id));

  return {
    inspectedIds: ids,
    notFoundIds: idSet ? ids.filter((id) => !foundIds.has(id)) : [],
    imageCount: imageRecords.length,
    videoCount: videoRecords.length,
    missingImages: sortAssetsForReport(missingAssets.filter((record) => record.assetType === 'image')),
    missingVideos: sortAssetsForReport(missingAssets.filter((record) => record.assetType === 'video')),
    presentAssets: sortAssetsForReport(presentAssets),
  };
};

export const missingNamespaceReportToCsv = (report) => {
  const rows = [['status', 'asset_type', 'id', 'uploaded', 'filename', 'namespace', 'parent_id']];
  for (const asset of [...report.missingImages, ...report.missingVideos]) {
    rows.push([
      'missing',
      asset.assetType,
      asset.id,
      asset.uploaded,
      asset.filename,
      '',
      asset.parentId || '',
    ]);
  }
  for (const asset of report.presentAssets) {
    rows.push([
      'has-namespace',
      asset.assetType,
      asset.id,
      asset.uploaded,
      asset.filename,
      asset.namespace,
      asset.parentId || '',
    ]);
  }
  for (const id of report.notFoundIds) {
    rows.push(['not-found', '', id, '', '', '', '']);
  }
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
};

export const prepareNamespaceMetadataUpdate = (existingMetadata, targetNamespace) => {
  const nextMetadata = { ...existingMetadata, namespace: targetNamespace };
  const result = enforceMetadataLimitPreservingNamespace(nextMetadata);
  if (result.metadata.namespace !== targetNamespace || result.size > METADATA_LIMIT_BYTES) {
    return {
      ...result,
      ok: false,
      reason: 'metadata still too large after trimming',
    };
  }
  return { ...result, ok: true };
};

export const getNamespaceRegistryPath = (cwd = process.cwd()) =>
  path.join(process.env.PHOTARIUM_RUNTIME_DATA_DIR ?? path.join(cwd, 'data'), 'namespace-registry.json');

const normalizeRegistryNamespace = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '__none__' || trimmed === '__all__') return '';
  return trimmed;
};

const normalizeRegistryEntry = (entry) => {
  if (typeof entry === 'string') {
    const name = normalizeRegistryNamespace(entry);
    return name ? { name, description: '' } : null;
  }
  if (!entry || typeof entry !== 'object') return null;
  const name = normalizeRegistryNamespace(entry.name);
  if (!name) return null;
  return {
    name,
    description: typeof entry.description === 'string' ? entry.description.trim() : '',
  };
};

const normalizeRegistryEntries = (entries) => {
  const byName = new Map();
  for (const entry of entries) {
    const normalized = normalizeRegistryEntry(entry);
    if (!normalized) continue;
    const existing = byName.get(normalized.name);
    byName.set(normalized.name, {
      name: normalized.name,
      description: normalized.description || existing?.description || '',
    });
  }
  return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
};

export const upsertNamespaceRegistryFile = async ({
  cwd = process.cwd(),
  description = '',
  namespace,
  registryPath = getNamespaceRegistryPath(cwd),
}) => {
  const normalized = normalizeRegistryNamespace(namespace);
  if (!normalized) {
    throw new Error('A specific non-reserved namespace is required for registry upsert.');
  }

  let payload = { namespaces: [], updatedAt: new Date(0).toISOString() };
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw);
    payload = {
      namespaces: Array.isArray(parsed?.namespaces) ? parsed.namespaces : [],
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const entries = normalizeRegistryEntries(payload.namespaces);
  const existing = entries.find((entry) => entry.name === normalized);
  const cleanDescription = typeof description === 'string' ? description.trim() : '';
  let didChange = false;

  if (existing) {
    if (cleanDescription && existing.description !== cleanDescription) {
      existing.description = cleanDescription;
      didChange = true;
    }
  } else {
    entries.push({ name: normalized, description: cleanDescription });
    didChange = true;
  }

  if (!didChange) {
    return { didChange: false, path: registryPath };
  }

  const nextPayload = {
    namespaces: normalizeRegistryEntries(entries),
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, `${JSON.stringify(nextPayload, null, 2)}\n`, 'utf8');
  return { didChange: true, path: registryPath };
};

export const applyAssignmentPlan = async ({
  fetchImageById,
  logger = console,
  patchMetadata,
  plan,
}) => {
  assertValidAssignmentPlan(plan);

  const result = {
    alreadyTarget: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const entry of plan.entries) {
    const targetNamespace = entry.targetNamespace || plan.targetNamespace;
    if (!targetNamespace) {
      result.failed += 1;
      result.details.push({ id: entry.id, status: 'failed', reason: 'missing target namespace' });
      logger.warn?.(`[assign-namespace] Failed ${entry.id}: missing target namespace`);
      continue;
    }
    try {
      const image = await fetchImageById(entry.id);
      const existingMetadata = parseMetadata(image?.meta);
      const existingNamespace = getMetadataNamespace(existingMetadata);
      if (existingNamespace === targetNamespace) {
        result.alreadyTarget += 1;
        result.details.push({ id: entry.id, status: 'already-target', namespace: existingNamespace });
        logger.log?.(formatAssignmentLogEntry({
          entry,
          status: 'already',
          currentNamespace: existingNamespace,
          targetNamespace,
        }));
        continue;
      }
      const canRepairFallback =
        existingNamespace &&
        existingNamespace === plan.fallbackNamespace &&
        entry.action === 'repair-from-fallback-to-family-namespace';
      if (existingNamespace) {
        if (!canRepairFallback) {
          result.skipped += 1;
          result.details.push({ id: entry.id, status: 'skipped', reason: `already has namespace ${existingNamespace}` });
          logger.warn?.(formatAssignmentLogEntry({
            entry,
            status: 'skip',
            currentNamespace: existingNamespace,
            targetNamespace,
            detail: `already has namespace ${existingNamespace}`,
          }));
          continue;
        }
      }

      const prepared = prepareNamespaceMetadataUpdate(existingMetadata, targetNamespace);
      if (!prepared.ok) {
        result.failed += 1;
        result.details.push({ id: entry.id, status: 'failed', reason: prepared.reason });
        logger.warn?.(formatAssignmentLogEntry({
          entry,
          status: 'failed',
          currentNamespace: existingNamespace,
          targetNamespace,
          detail: prepared.reason,
        }));
        continue;
      }

      await patchMetadata(entry.id, prepared.metadata);
      const verifiedImage = await fetchImageById(entry.id);
      const verifiedNamespace = getMetadataNamespace(parseMetadata(verifiedImage?.meta));
      if (verifiedNamespace !== targetNamespace) {
        result.failed += 1;
        result.details.push({
          id: entry.id,
          status: 'failed',
          reason: `post-patch verification found namespace=${verifiedNamespace || '[missing]'}`,
        });
        logger.warn?.(formatAssignmentLogEntry({
          entry,
          status: 'failed',
          currentNamespace: verifiedNamespace,
          targetNamespace,
          detail: `post-patch verification found namespace=${verifiedNamespace || '[missing]'}`,
        }));
        continue;
      }

      result.updated += 1;
      result.details.push({
        id: entry.id,
        status: 'updated',
        dropped: prepared.dropped,
      });
      logger.log?.(formatAssignmentLogEntry({
        entry,
        status: 'verified',
        currentNamespace: existingNamespace,
        targetNamespace,
        detail: prepared.dropped.length ? `metadata trimmed: ${prepared.dropped.join(', ')}` : undefined,
      }));
    } catch (error) {
      result.failed += 1;
      result.details.push({ id: entry.id, status: 'failed', reason: error.message });
      logger.warn?.(formatAssignmentLogEntry({
        entry,
        status: 'failed',
        currentNamespace: entry.currentNamespace || '',
        targetNamespace: targetNamespace || '',
        detail: error.message,
      }));
    }
  }

  return result;
};
