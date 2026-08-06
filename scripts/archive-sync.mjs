const baseUrl = process.env.ARCHIVE_CATALOG_BASE_URL || 'http://localhost:8790';
const request = async (endpoint, options = {}) => fetch(`${baseUrl}${endpoint}`, {
  ...options,
  signal: AbortSignal.timeout(10_000),
});

const knownCatalogsResponse = await request('/catalogs');
const knownCatalogs = knownCatalogsResponse.ok ? await knownCatalogsResponse.json() : { catalogs: [] };
const catalogPaths = Array.isArray(knownCatalogs.catalogs)
  ? knownCatalogs.catalogs.map((catalog) => catalog.path).filter((path) => typeof path === 'string')
  : [];
const response = await request('/sync', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    hashFiles: process.argv.includes('--hash'),
    allowLockedCatalog: process.argv.includes('--allow-locked'),
    ...(catalogPaths.length ? { catalogPaths } : {}),
  }),
});

if (!response.ok) {
  throw new Error(`Archive sync failed (${response.status}): ${await response.text()}`);
}

const started = await response.json();
if (started.status !== 'started') {
  console.log(JSON.stringify(started, null, 2));
  process.exit(0);
}

console.log(`Archive sync started: ${started.jobId}`);
for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const statusResponse = await request('/status');
  if (!statusResponse.ok) throw new Error(`Archive status failed (${statusResponse.status}): ${await statusResponse.text()}`);
  const status = await statusResponse.json();
  const sync = status.sync;
  if (sync?.status === 'running') {
    process.stdout.write('.');
    continue;
  }
  process.stdout.write('\n');
  if (sync?.status === 'failed') throw new Error(`Archive sync failed: ${sync.error}`);
  console.log(JSON.stringify(sync?.result ?? status, null, 2));
  break;
}
