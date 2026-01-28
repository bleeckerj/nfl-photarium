#!/usr/bin/env node
/**
 * Folder → Variants Organizer
 *
 * For a specific namespace, groups images by `folder` metadata and makes all
 * images in each folder (except a chosen parent) variants of that parent.
 *
 * This is meant to reduce gallery clutter by consolidating many related images
 * into a single parent + variant set.
 *
 * How it works:
 * - Fetches images from the local app: GET /api/images?namespace=<ns>
 * - Groups by `folder`
 * - Picks a parent per folder (default: oldest uploaded)
 * - Updates each child via: PATCH /api/images/:id/update { parentId, variationSort }
 *
 * Notes / requirements:
 * - Requires the Next app to be running and able to reach Cloudflare
 *   (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN configured in that app).
 * - Dry-run by default; pass --apply to actually write changes.
 *
 * Usage:
 *   node scripts/folder-to-variants.mjs --namespace=<ns> [options]
 *
 * Options:
 *   --namespace=<ns>           Namespace to process (required)
 *   --api-base=<url>           Base URL for the app (default: http://localhost:3000)
 *   --refresh                  Force refresh cache when listing images
 *   --apply                    Actually apply changes (otherwise dry-run)
 *   --force                    Re-parent even if image already has a different parentId
 *   --detach-parent            If chosen parent already has a parentId, clear it (set parentId="")
 *   --strategy=oldest|newest|first  Parent selection strategy (default: oldest)
 *   --min-group-size=<n>       Only process folders with at least n images (default: 2)
 *   --limit-folders=<n>        Stop after processing n folders (default: unlimited)
 *   --include-folder=<regex>   Only folders whose name matches regex
 *   --exclude-folder=<regex>   Skip folders whose name matches regex
 *   --delay=<ms>               Delay between PATCH calls (default: 50)
 *   -v, --verbose              Verbose logging
 *   --help, -h                 Show help
 */

const DEFAULT_API_BASE = 'http://localhost:3000';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseRegex = (value) => {
  if (!value) return undefined;
  try {
    // Support either plain pattern or /pattern/flags
    const match = String(value).match(/^\/(.*)\/([a-z]*)$/i);
    if (match) return new RegExp(match[1], match[2]);
    return new RegExp(String(value));
  } catch {
    throw new Error(`Invalid regex: ${value}`);
  }
};

const help = () => {
  console.log(`\
Folder → Variants Organizer

Usage:
  node scripts/folder-to-variants.mjs --namespace=<ns> [options]

Options:
  --namespace=<ns>                Namespace to process (required)
  --api-base=<url>                Base URL for the app (default: ${DEFAULT_API_BASE})
  --refresh                       Force refresh cache when listing images
  --apply                         Actually apply changes (otherwise dry-run)
  --force                         Re-parent even if image already has a different parentId
  --detach-parent                 If chosen parent already has a parentId, clear it (set parentId="")
  --strategy=oldest|newest|first   Parent selection strategy (default: oldest)
  --min-group-size=<n>            Only process folders with at least n images (default: 2)
  --limit-folders=<n>             Stop after processing n folders (default: unlimited)
  --include-folder=<regex>        Only folders whose name matches regex
  --exclude-folder=<regex>        Skip folders whose name matches regex
  --delay=<ms>                    Delay between PATCH calls (default: 50)
  -v, --verbose                   Verbose logging
  --help, -h                      Show help

Examples:
  # Dry run (default), show which folders would be consolidated
  node scripts/folder-to-variants.mjs --namespace=cf-default

  # Actually apply changes
  node scripts/folder-to-variants.mjs --namespace=cf-default --apply

  # Only process folders matching "2025" and limit to 25 folders
  node scripts/folder-to-variants.mjs --namespace=cf-default --include-folder=2025 --limit-folders=25 --apply

  # Force re-parenting even if images already have a different parent
  node scripts/folder-to-variants.mjs --namespace=cf-default --force --apply
`);
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    namespace: undefined,
    apiBase: process.env.API_BASE || DEFAULT_API_BASE,
    refresh: false,
    apply: false,
    force: false,
    detachParent: false,
    strategy: 'oldest',
    minGroupSize: 2,
    limitFolders: Infinity,
    includeFolder: undefined,
    excludeFolder: undefined,
    delay: 50,
    verbose: false,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      help();
      process.exit(0);
    } else if (arg.startsWith('--namespace=')) {
      options.namespace = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('--api-base=')) {
      options.apiBase = arg.split('=').slice(1).join('=');
    } else if (arg === '--refresh') {
      options.refresh = true;
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--detach-parent') {
      options.detachParent = true;
    } else if (arg.startsWith('--strategy=')) {
      options.strategy = arg.split('=').slice(1).join('=').trim();
    } else if (arg.startsWith('--min-group-size=')) {
      const n = Number(arg.split('=').slice(1).join('='));
      if (Number.isFinite(n)) options.minGroupSize = Math.max(2, Math.floor(n));
    } else if (arg.startsWith('--limit-folders=')) {
      const n = Number(arg.split('=').slice(1).join('='));
      if (Number.isFinite(n)) options.limitFolders = Math.max(0, Math.floor(n));
    } else if (arg.startsWith('--include-folder=')) {
      options.includeFolder = parseRegex(arg.split('=').slice(1).join('='));
    } else if (arg.startsWith('--exclude-folder=')) {
      options.excludeFolder = parseRegex(arg.split('=').slice(1).join('='));
    } else if (arg.startsWith('--delay=')) {
      const ms = Number(arg.split('=').slice(1).join('='));
      if (Number.isFinite(ms)) options.delay = Math.max(0, Math.floor(ms));
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose = true;
    }
  }

  if (!['oldest', 'newest', 'first'].includes(options.strategy)) {
    throw new Error(`Invalid --strategy=${options.strategy} (use oldest|newest|first)`);
  }

  return options;
};

const fetchJson = async (url, init) => {
  const resp = await fetch(url, init);
  const contentType = resp.headers.get('content-type') || '';
  const text = await resp.text();
  const data = contentType.includes('application/json') ? JSON.parse(text || 'null') : text;
  return { resp, data, text };
};

const fetchImages = async ({ apiBase, namespace, refresh }) => {
  const url = new URL('/api/images', apiBase);
  url.searchParams.set('namespace', namespace);
  if (refresh) url.searchParams.set('refresh', '1');

  const { resp, data, text } = await fetchJson(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch images: ${resp.status} ${typeof data === 'string' ? data : JSON.stringify(data)}\n${text}`);
  }
  if (!data || !Array.isArray(data.images)) {
    throw new Error('Unexpected response shape from /api/images (missing images array)');
  }
  return data.images;
};

const chooseParent = (items, strategy) => {
  const sorted = [...items].sort((a, b) => {
    const da = Date.parse(a.uploaded || '') || 0;
    const db = Date.parse(b.uploaded || '') || 0;
    if (strategy === 'newest') {
      if (db !== da) return db - da;
    } else if (strategy === 'oldest') {
      if (da !== db) return da - db;
    }
    // strategy=first falls through to stable id sort
    return String(a.id).localeCompare(String(b.id));
  });
  return sorted[0];
};

const patchUpdate = async ({ apiBase, id, body }) => {
  const url = new URL(`/api/images/${id}/update`, apiBase);
  const { resp, data, text } = await fetchJson(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`PATCH ${url.pathname} failed: ${resp.status} ${typeof data === 'string' ? data : JSON.stringify(data)}\n${text}`);
  }
  return data;
};

const main = async () => {
  const options = parseArgs();

  if (!options.namespace || !String(options.namespace).trim()) {
    console.error('Missing --namespace=<ns>');
    help();
    process.exitCode = 1;
    return;
  }

  console.log(`[folder-to-variants] namespace=${options.namespace}`);
  console.log(`[folder-to-variants] apiBase=${options.apiBase} refresh=${options.refresh}`);
  console.log(`[folder-to-variants] apply=${options.apply} force=${options.force} detachParent=${options.detachParent}`);
  console.log(`[folder-to-variants] strategy=${options.strategy} minGroupSize=${options.minGroupSize} limitFolders=${options.limitFolders}`);

  const images = await fetchImages({
    apiBase: options.apiBase,
    namespace: options.namespace,
    refresh: options.refresh,
  });

  console.log(`[folder-to-variants] fetched ${images.length} images`);

  const byFolder = new Map();
  let missingFolder = 0;

  for (const img of images) {
    const folder = typeof img.folder === 'string' ? img.folder.trim() : '';
    if (!folder) {
      missingFolder += 1;
      continue;
    }
    if (options.includeFolder && !options.includeFolder.test(folder)) continue;
    if (options.excludeFolder && options.excludeFolder.test(folder)) continue;

    const list = byFolder.get(folder) ?? [];
    list.push(img);
    byFolder.set(folder, list);
  }

  const folders = Array.from(byFolder.entries())
    .filter(([, items]) => items.length >= options.minGroupSize)
    .sort(([a], [b]) => a.localeCompare(b));

  console.log(`[folder-to-variants] folders with >=${options.minGroupSize} images: ${folders.length} (missing folder: ${missingFolder})`);

  let processedFolders = 0;
  let plannedChildren = 0;
  for (const [, items] of folders) plannedChildren += Math.max(0, items.length - 1);

  console.log(`[folder-to-variants] planned child re-parent ops (before skips): ${plannedChildren}`);
  if (!options.apply) {
    console.log('[folder-to-variants] DRY RUN (use --apply to make changes)');
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let detached = 0;

  for (const [folder, items] of folders) {
    if (processedFolders >= options.limitFolders) break;
    processedFolders += 1;

    const parent = chooseParent(items, options.strategy);
    const children = items.filter((img) => img.id !== parent.id);

    if (options.verbose) {
      console.log(`\n[folder] ${folder}`);
      console.log(`  parent: ${parent.id} (${parent.filename || 'no-filename'}) uploaded=${parent.uploaded}`);
      console.log(`  children: ${children.length}`);
    } else {
      console.log(`\n[folder] ${folder} → parent=${parent.id} children=${children.length}`);
    }

    if (options.detachParent && parent.parentId) {
      if (!options.apply) {
        console.log(`  - would detach parent from parentId=${parent.parentId}`);
      } else {
        try {
          await patchUpdate({ apiBase: options.apiBase, id: parent.id, body: { parentId: '' } });
          detached += 1;
          console.log('  - detached parent');
          await sleep(options.delay);
        } catch (err) {
          failed += 1;
          console.error(`  - failed to detach parent: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Sort children deterministically (uploaded asc, then id)
    const sortedChildren = [...children].sort((a, b) => {
      const da = Date.parse(a.uploaded || '') || 0;
      const db = Date.parse(b.uploaded || '') || 0;
      if (da !== db) return da - db;
      return String(a.id).localeCompare(String(b.id));
    });

    for (let index = 0; index < sortedChildren.length; index += 1) {
      const child = sortedChildren[index];

      if (!options.force && child.parentId && child.parentId !== parent.id) {
        skipped += 1;
        if (options.verbose) {
          console.log(`  - skip child ${child.id}: already parentId=${child.parentId}`);
        }
        continue;
      }

      const body = {
        parentId: parent.id,
        variationSort: index + 1,
      };

      if (!options.apply) {
        console.log(`  - would set ${child.id}.parentId=${parent.id} variationSort=${index + 1}`);
        continue;
      }

      try {
        await patchUpdate({ apiBase: options.apiBase, id: child.id, body });
        updated += 1;
        if (options.verbose) {
          console.log(`  - updated child ${child.id}`);
        }
      } catch (err) {
        failed += 1;
        console.error(`  - failed child ${child.id}: ${err instanceof Error ? err.message : String(err)}`);
      }

      await sleep(options.delay);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`folders considered: ${folders.length}`);
  console.log(`folders processed:  ${processedFolders}`);
  console.log(`detached parents:   ${detached}`);
  console.log(`updated children:   ${updated}`);
  console.log(`skipped children:   ${skipped}`);
  console.log(`failed ops:         ${failed}`);

  if (!options.apply) {
    console.log('\nNo changes were applied (dry run).');
  }
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
