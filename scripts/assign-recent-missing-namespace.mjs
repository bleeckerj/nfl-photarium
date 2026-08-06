#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  applyAssignmentPlan,
  ambiguousFamiliesToCsv,
  assignmentPlanToCsv,
  assertValidAssignmentPlan,
  buildFamilyAwareAssignmentPlan,
  buildAssignmentPlan,
  buildMissingNamespaceReport,
  findMissingNamespaceImages,
  formatAssignmentLogEntry,
  getMetadataNamespace,
  isMissingNamespace,
  missingNamespaceReportToCsv,
  parseMetadata,
  prepareNamespaceMetadataUpdate,
  selectAssignmentCandidates,
} from './lib/missingNamespaceAssignment.mjs';
import { formatMissingNamespaceReportText, registerTargetNamespace, registerTargetNamespaces, writeOrPrint } from './assign-recent-missing-namespace/reportHelpers.mjs';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_NAMESPACE = 'cf-artifacts';
const printHelp = () => {
  console.log(`
Assign Cloudflare Images assets with missing namespace metadata.

Usage:
  node scripts/assign-recent-missing-namespace.mjs --all --namespace <name> [options]
  node scripts/assign-recent-missing-namespace.mjs --limit <n> [options]
  node scripts/assign-recent-missing-namespace.mjs --ids <id,id,...> [options]
  node scripts/assign-recent-missing-namespace.mjs --list-missing [options]
  node scripts/assign-recent-missing-namespace.mjs --apply-plan <path> --apply [options]

Options:
  --namespace <name>       Namespace to assign (default: ${DEFAULT_NAMESPACE})
  --family-aware           Infer per-image target namespaces from variant families
  --fallback-namespace <n> Fallback namespace for namespace-less families (default: cf-orphan)
  --all                    Assign all missing-namespace images
  --limit <n>              Assign the N most recent missing-namespace images
  --ids <id,id,...>        Assign explicit image IDs instead of using --all/--limit
  --ids-file <path>        File containing one image ID per line
  --list-missing           Read-only report of images/videos currently missing namespace
  --format <text|csv|json> Output format for --list-missing (default: text)
  --output <path>          Write --list-missing output to a file instead of stdout
  --plan-file <path>       Write a frozen JSON plan and sibling CSV during dry-run
  --apply-plan <path>      Apply exactly the IDs from a frozen JSON plan
  --video-evidence-file <path>
                           Optional JSON file of video records used as namespace evidence
  --page-size <n>          Cloudflare list page size, 1-100 (default: ${DEFAULT_PAGE_SIZE})
  --apply                  Actually patch Cloudflare metadata
  --dry-run                Show planned updates only (default)
  --help                   Show this help

Examples:
  node scripts/assign-recent-missing-namespace.mjs --all --namespace cf-orphan --plan-file /private/tmp/cf-orphan-namespace-plan.json
  node scripts/assign-recent-missing-namespace.mjs --family-aware --fallback-namespace cf-orphan --plan-file /private/tmp/family-namespace-repair-plan.json
  node scripts/assign-recent-missing-namespace.mjs --list-missing
  node scripts/assign-recent-missing-namespace.mjs --list-missing --ids 8f97c591-c016-48d6-f5d0-861a31fd2900
  node scripts/assign-recent-missing-namespace.mjs --apply-plan /private/tmp/cf-orphan-namespace-plan.json --apply
  node scripts/assign-recent-missing-namespace.mjs --limit 10
  node scripts/assign-recent-missing-namespace.mjs --ids 64946cbd-7fa0-405a-6986-c5ee8c1dac00 --apply
`);
};

const readValueArg = (args, index) => {
  const arg = args[index];
  if (arg.includes('=')) {
    return { value: arg.split('=').slice(1).join('='), nextIndex: index };
  }
  return { value: args[index + 1], nextIndex: index + 1 };
};

const parseIdList = (value) =>
  String(value || '')
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

export const parseArgs = async (argv = process.argv.slice(2)) => {
  const parsed = {
    all: false,
    apply: false,
    applyPlanFile: undefined,
    fallbackNamespace: 'cf-orphan',
    familyAware: false,
    format: 'text',
    help: false,
    ids: [],
    idsFile: undefined,
    limit: undefined,
    listMissing: false,
    namespace: DEFAULT_NAMESPACE,
    namespaceProvided: false,
    output: undefined,
    pageSize: DEFAULT_PAGE_SIZE,
    planFile: undefined,
    videoEvidenceFile: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--all') {
      parsed.all = true;
      continue;
    }
    if (arg === '--apply') {
      parsed.apply = true;
      continue;
    }
    if (arg === '--family-aware') {
      parsed.familyAware = true;
      continue;
    }
    if (arg === '--list-missing') {
      parsed.listMissing = true;
      continue;
    }
    if (arg === '--format' || arg.startsWith('--format=')) {
      const result = readValueArg(argv, index);
      parsed.format = String(result.value || '').trim().toLowerCase();
      index = result.nextIndex;
      continue;
    }
    if (arg === '--output' || arg.startsWith('--output=')) {
      const result = readValueArg(argv, index);
      parsed.output = result.value;
      index = result.nextIndex;
      continue;
    }
    if (arg === '--fallback-namespace' || arg.startsWith('--fallback-namespace=')) {
      const result = readValueArg(argv, index);
      parsed.fallbackNamespace = String(result.value || '').trim();
      index = result.nextIndex;
      continue;
    }
    if (arg === '--dry-run') {
      parsed.apply = false;
      continue;
    }
    if (arg === '--namespace' || arg.startsWith('--namespace=')) {
      const result = readValueArg(argv, index);
      parsed.namespace = String(result.value || '').trim();
      parsed.namespaceProvided = true;
      index = result.nextIndex;
      continue;
    }
    if (arg === '--limit' || arg.startsWith('--limit=')) {
      const result = readValueArg(argv, index);
      const value = Number(result.value);
      if (Number.isFinite(value)) parsed.limit = Math.max(0, Math.floor(value));
      index = result.nextIndex;
      continue;
    }
    if (arg === '--ids' || arg.startsWith('--ids=')) {
      const result = readValueArg(argv, index);
      parsed.ids.push(...parseIdList(result.value));
      index = result.nextIndex;
      continue;
    }
    if (arg === '--ids-file' || arg.startsWith('--ids-file=')) {
      const result = readValueArg(argv, index);
      parsed.idsFile = result.value;
      index = result.nextIndex;
      continue;
    }
    if (arg === '--plan-file' || arg.startsWith('--plan-file=')) {
      const result = readValueArg(argv, index);
      parsed.planFile = result.value;
      index = result.nextIndex;
      continue;
    }
    if (arg === '--apply-plan' || arg.startsWith('--apply-plan=')) {
      const result = readValueArg(argv, index);
      parsed.applyPlanFile = result.value;
      index = result.nextIndex;
      continue;
    }
    if (arg === '--video-evidence-file' || arg.startsWith('--video-evidence-file=')) {
      const result = readValueArg(argv, index);
      parsed.videoEvidenceFile = result.value;
      index = result.nextIndex;
      continue;
    }
    if (arg === '--page-size' || arg.startsWith('--page-size=')) {
      const result = readValueArg(argv, index);
      const value = Number(result.value);
      if (Number.isFinite(value)) {
        parsed.pageSize = Math.min(100, Math.max(1, Math.floor(value)));
      }
      index = result.nextIndex;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (parsed.idsFile) {
    const content = await fs.readFile(parsed.idsFile, 'utf8');
    parsed.ids.push(...parseIdList(content));
  }

  parsed.ids = Array.from(new Set(parsed.ids));
  return parsed;
};

const loadEnvFile = async (filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    content.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const index = trimmed.indexOf('=');
      if (index === -1) return;
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();
      if (!key || process.env[key]) return;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[assign-namespace] Failed to load ${filePath}: ${error.message}`);
    }
  }
};

const assertValidNamespace = (namespace) => {
  if (!namespace || namespace === '__all__' || namespace === '__none__' || namespace === 'undefined') {
    throw new Error('A specific non-reserved namespace is required.');
  }
};

const fetchImagesPage = async (accountId, apiToken, page, perPage) => {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  });
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1?${params.toString()}`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.message || `Failed to fetch page ${page}`);
  }
  return Array.isArray(payload?.result?.images) ? payload.result.images : [];
};

const fetchImageById = async (accountId, apiToken, id) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${id}`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.message || payload?.error || `Failed to fetch ${id}`);
  }
  return payload?.result;
};

const patchMetadata = async (accountId, apiToken, id, metadata) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ metadata }),
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.message || payload?.error || 'Failed to update metadata');
  }
  return payload?.result;
};

const collectMissingNamespaceImages = async ({ accountId, apiToken, pageSize }) => {
  const missing = [];
  let scanned = 0;
  let page = 1;

  while (true) {
    const images = await fetchImagesPage(accountId, apiToken, page, pageSize);
    if (!images.length) break;
    scanned += images.length;
    missing.push(...findMissingNamespaceImages(images));

    console.log(`[assign-namespace] Scanned page ${page}; total scanned=${scanned}; missing=${missing.length}`);
    if (images.length < pageSize) break;
    page += 1;
  }

  return { missing, scanned };
};

const collectAllImages = async ({ accountId, apiToken, pageSize }) => {
  const images = [];
  let scanned = 0;
  let page = 1;

  while (true) {
    const pageImages = await fetchImagesPage(accountId, apiToken, page, pageSize);
    if (!pageImages.length) break;
    scanned += pageImages.length;
    images.push(...pageImages);

    console.log(`[assign-namespace] Scanned page ${page}; total scanned=${scanned}`);
    if (pageImages.length < pageSize) break;
    page += 1;
  }

  return { images, scanned };
};

const fetchImagesByIdsForAudit = async ({ accountId, apiToken, ids }) => {
  const images = [];
  for (const id of ids) {
    try {
      const image = await fetchImageById(accountId, apiToken, id);
      if (image) {
        images.push(image);
        console.log(`[assign-namespace] Inspected image id=${id}`);
      }
    } catch (error) {
      console.warn(`[assign-namespace] Image id=${id} not found in Cloudflare Images (${error.message})`);
    }
  }
  return images;
};

const csvPathForPlan = (planFile) => {
  const parsed = path.parse(planFile);
  return path.join(parsed.dir, `${parsed.name}.csv`);
};

const writeAssignmentPlan = async (planFile, plan) => {
  await fs.mkdir(path.dirname(planFile), { recursive: true });
  await fs.writeFile(planFile, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  const csvPath = csvPathForPlan(planFile);
  await fs.writeFile(csvPath, assignmentPlanToCsv(plan), 'utf8');
  console.log(`[assign-namespace] Wrote plan ${planFile}`);
  console.log(`[assign-namespace] Wrote CSV ${csvPath}`);
  if (Array.isArray(plan.ambiguousFamilies) && plan.ambiguousFamilies.length > 0) {
    const parsed = path.parse(planFile);
    const ambiguousPath = path.join(parsed.dir, `${parsed.name}.ambiguous-families.csv`);
    await fs.writeFile(ambiguousPath, ambiguousFamiliesToCsv(plan), 'utf8');
    console.log(`[assign-namespace] Wrote ambiguous family CSV ${ambiguousPath}`);
  }
};

const readAssignmentPlan = async (planFile) => {
  const content = await fs.readFile(planFile, 'utf8');
  const plan = JSON.parse(content);
  assertValidAssignmentPlan(plan);
  return plan;
};

const readCacheEnvelopeFromFile = async (cacheDir, key) => {
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(cacheDir, `${safeKey}.json`);
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return parsed?.data;
};

const readCacheEnvelopeFromRedis = async (key) => {
  const Redis = (await import('ioredis')).default;
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
  try {
    await client.connect();
    const raw = await client.get(`photarium:cache:${key}`);
    return raw ? JSON.parse(raw)?.data : undefined;
  } finally {
    await client.quit();
  }
};

const loadVideoEvidenceRecords = async (args) => {
  if (args.videoEvidenceFile) {
    const raw = await fs.readFile(args.videoEvidenceFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.videos) ? parsed.videos : [];
  }

  try {
    if (process.env.CACHE_STORAGE_TYPE === 'redis') {
      const ids = await readCacheEnvelopeFromRedis('video-asset-index');
      if (!Array.isArray(ids) || ids.length === 0) return [];
      const records = await Promise.all(ids.map((id) => readCacheEnvelopeFromRedis(`video-asset:${id}`)));
      return records.filter(Boolean);
    }

    const cacheDirs = [
      process.env.CACHE_STORAGE_DIR,
      path.join(process.cwd(), '.cache'),
      path.join(os.tmpdir(), 'photarium-cache'),
    ].filter(Boolean);

    for (const cacheDir of cacheDirs) {
      try {
        const ids = await readCacheEnvelopeFromFile(cacheDir, 'video-asset-index');
        if (!Array.isArray(ids) || ids.length === 0) continue;
        const records = await Promise.all(
          ids.map(async (id) => {
            try {
              return await readCacheEnvelopeFromFile(cacheDir, `video-asset:${id}`);
            } catch {
              return null;
            }
          })
        );
        return records.filter(Boolean);
      } catch {
        // Try the next plausible cache directory.
      }
    }
  } catch (error) {
    console.warn(`[assign-namespace] Failed to load video namespace evidence: ${error.message}`);
  }

  return [];
};

const runListMissing = async ({ accountId, apiToken, args }) => {
  if (!['text', 'csv', 'json'].includes(args.format)) {
    throw new Error('Invalid --format. Use text, csv, or json.');
  }
  let images;
  let scanned;
  let videos;

  if (args.ids.length > 0) {
    console.log(
      `[assign-namespace] Inspecting ${args.ids.length} explicit ID${args.ids.length === 1 ? '' : 's'} without a full catalog scan`
    );
    [images, videos] = await Promise.all([
      fetchImagesByIdsForAudit({ accountId, apiToken, ids: args.ids }),
      loadVideoEvidenceRecords(args),
    ]);
    scanned = images.length;
  } else {
    [{ images, scanned }, videos] = await Promise.all([
      collectAllImages({ accountId, apiToken, pageSize: args.pageSize }),
      loadVideoEvidenceRecords(args),
    ]);
  }

  const report = buildMissingNamespaceReport({
    ids: args.ids,
    images,
    videos,
  });
  const payload = {
    ...report,
    scanned,
    generatedAt: new Date().toISOString(),
  };
  const content = args.format === 'json'
    ? `${JSON.stringify(payload, null, 2)}\n`
    : args.format === 'csv'
      ? missingNamespaceReportToCsv(payload)
      : formatMissingNamespaceReportText(payload);
  await writeOrPrint({ content, output: args.output });
};

const runApplyPlan = async ({ accountId, apiToken, args }) => {
  if (!args.apply) {
    throw new Error('Pass --apply with --apply-plan to patch Cloudflare metadata.');
  }

  const plan = await readAssignmentPlan(args.applyPlanFile);
  if (args.namespaceProvided && plan.targetNamespace && args.namespace !== plan.targetNamespace) {
    throw new Error(
      `Plan namespace ${plan.targetNamespace} does not match CLI namespace ${args.namespace}.`
    );
  }
  const targetNamespaces = plan.targetNamespace
    ? [plan.targetNamespace]
    : plan.entries.map((entry) => entry.targetNamespace).filter(Boolean);
  targetNamespaces.forEach(assertValidNamespace);
  await registerTargetNamespaces(targetNamespaces);

  console.log(
    `[assign-namespace] Applying plan=${args.applyPlanFile} selected=${plan.entries.length} namespaces=${Array.from(new Set(targetNamespaces)).sort().join(',')}`
  );

  const result = await applyAssignmentPlan({
    plan,
    fetchImageById: (id) => fetchImageById(accountId, apiToken, id),
    patchMetadata: (id, metadata) => patchMetadata(accountId, apiToken, id, metadata),
    logger: console,
  });
  console.log(
    `[assign-namespace] Done. updated=${result.updated} alreadyTarget=${result.alreadyTarget} skipped=${result.skipped} failed=${result.failed}`
  );
};

const runFamilyAwareSelection = async ({ accountId, apiToken, args }) => {
  const fallbackNamespace = args.fallbackNamespace.trim();
  assertValidNamespace(fallbackNamespace);
  if (!args.planFile) {
    throw new Error('Pass --plan-file <path> with --family-aware so the multi-target plan can be reviewed.');
  }
  if (args.apply) {
    throw new Error('Family-aware live selection is dry-run only. Review the plan, then use --apply-plan <path> --apply.');
  }

  const [{ images, scanned }, videos] = await Promise.all([
    collectAllImages({ accountId, apiToken, pageSize: args.pageSize }),
    loadVideoEvidenceRecords(args),
  ]);
  const plan = buildFamilyAwareAssignmentPlan({
    fallbackNamespace,
    images,
    scanned,
    videos,
  });

  const actionCounts = plan.entries.reduce((counts, entry) => {
    counts[entry.action] = (counts[entry.action] || 0) + 1;
    return counts;
  }, {});
  console.log(
    `[assign-namespace] familyAware scanned=${scanned} images=${plan.imageCount} videoEvidence=${plan.videoEvidenceCount} selected=${plan.selectedCount} ambiguousFamilies=${plan.ambiguousFamilyCount}`
  );
  console.log(`[assign-namespace] actionCounts=${JSON.stringify(actionCounts)}`);

  await writeAssignmentPlan(args.planFile, plan);
};

const runLiveSelection = async ({ accountId, apiToken, args }) => {
  const namespace = args.namespace.trim();
  assertValidNamespace(namespace);

  const selectionModeCount = Number(args.all) + Number(args.limit !== undefined) + Number(args.ids.length > 0);
  if (selectionModeCount !== 1) {
    throw new Error('Pass exactly one of --all, --limit <n>, or --ids/--ids-file.');
  }
  if (args.limit !== undefined && args.limit <= 0) {
    throw new Error('Pass a positive --limit value.');
  }

  const { missing, scanned } = await collectMissingNamespaceImages({
    accountId,
    apiToken,
    pageSize: args.pageSize,
  });
  const { selected, notFoundIds } = selectAssignmentCandidates({
    all: args.all,
    ids: args.ids,
    limit: args.limit,
    missing,
  });
  const plan = buildAssignmentPlan({
    missingCount: missing.length,
    scanned,
    selected,
    targetNamespace: namespace,
  });

  console.log(
    `[assign-namespace] scanned=${scanned} missing=${missing.length} selected=${selected.length} namespace=${namespace} mode=${args.apply ? 'apply' : 'dry-run'}`
  );
  if (args.apply) {
    await registerTargetNamespace(namespace);
  }
  if (notFoundIds.length) {
    console.warn(`[assign-namespace] Requested IDs not found among missing-namespace images: ${notFoundIds.join(', ')}`);
  }
  if (args.planFile) {
    await writeAssignmentPlan(args.planFile, plan);
  }

  let updated = 0;
  let alreadyTarget = 0;
  let skipped = 0;
  let failed = 0;

  for (const { image, metadata: existingMetadata } of selected) {
    const prepared = prepareNamespaceMetadataUpdate(existingMetadata, namespace);
    if (!prepared.ok) {
      failed += 1;
      console.warn(`[assign-namespace] Skip ${image.id}: ${prepared.reason}`);
      continue;
    }

    const label = `${image.uploaded || '[unknown date]'} ${image.id} ${image.filename || ''}`;
    if (!args.apply) {
      console.log(formatAssignmentLogEntry({
        entry: {
          id: image.id,
          uploaded: image.uploaded || '',
          filename: image.filename || '',
          currentNamespace: '',
          targetNamespace: namespace,
          action: 'repair-to-target',
          reason: 'single-target missing namespace repair',
          metadataSummary: { keys: Object.keys(existingMetadata).sort() },
        },
        status: 'would',
        currentNamespace: '',
        targetNamespace: namespace,
        detail: prepared.dropped.length ? `would trim metadata: ${prepared.dropped.join(', ')}` : undefined,
      }));
      updated += 1;
      continue;
    }

    const liveImage = await fetchImageById(accountId, apiToken, image.id);
    const liveMetadata = parseMetadata(liveImage?.meta);
    const liveNamespace = getMetadataNamespace(liveMetadata);
    if (liveNamespace === namespace) {
      alreadyTarget += 1;
      console.log(`[assign-namespace] Already target ${image.id}: namespace=${liveNamespace}`);
      continue;
    }
    if (!isMissingNamespace(liveMetadata)) {
      skipped += 1;
      console.warn(`[assign-namespace] Skip ${image.id}: already has namespace=${liveNamespace}`);
      continue;
    }
    const livePrepared = prepareNamespaceMetadataUpdate(liveMetadata, namespace);
    if (!livePrepared.ok) {
      failed += 1;
      console.warn(`[assign-namespace] Skip ${image.id}: ${livePrepared.reason}`);
      continue;
    }

    try {
      await patchMetadata(accountId, apiToken, image.id, livePrepared.metadata);
      const verifiedImage = await fetchImageById(accountId, apiToken, image.id);
      const verifiedNamespace = getMetadataNamespace(parseMetadata(verifiedImage?.meta));
      if (verifiedNamespace !== namespace) {
        failed += 1;
        console.warn(
          `[assign-namespace] Failed ${image.id}: post-patch verification found namespace=${verifiedNamespace || '[missing]'}`
        );
        continue;
      }
      console.log(`[assign-namespace] Verified assigned ${label}${livePrepared.dropped.length ? ` (dropped: ${livePrepared.dropped.join(', ')})` : ''}`);
      updated += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[assign-namespace] Failed ${image.id}: ${error.message}`);
    }
  }

  console.log(
    `[assign-namespace] Done. ${args.apply ? 'updated' : 'wouldUpdate'}=${updated} alreadyTarget=${alreadyTarget} skipped=${skipped} failed=${failed}`
  );
};

const main = async () => {
  await loadEnvFile(path.join(process.cwd(), '.env.local'));
  await loadEnvFile(path.join(process.cwd(), '.env'));

  const args = await parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
  }

  if (args.applyPlanFile) {
    await runApplyPlan({ accountId, apiToken, args });
    return;
  }

  if (args.listMissing) {
    await runListMissing({ accountId, apiToken, args });
    return;
  }

  if (args.familyAware) {
    await runFamilyAwareSelection({ accountId, apiToken, args });
    return;
  }

  await runLiveSelection({ accountId, apiToken, args });
};

main().catch((error) => {
  console.error(`[assign-namespace] ${error.message}`);
  process.exitCode = 1;
});
