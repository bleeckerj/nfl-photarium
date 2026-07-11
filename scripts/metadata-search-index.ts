import { getCachedImages } from '@/server/cloudflareImageCache';
import { getImageExtrasRecords } from '@/server/imageExtras';
import {
  clearMetadataSearchIndex,
  closeMetadataSearchIndex,
  indexMetadataImage,
  isMetadataImageIndexed,
  METADATA_SEARCH_INDEX_VERSION,
} from '@/server/metadataSearchIndex';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const verify = args.has('--verify');
const colorEnabled = process.stdout.isTTY && !process.env.NO_COLOR;
const color = (code: number, value: string) => colorEnabled ? `\u001b[${code}m${value}\u001b[0m` : value;

async function main() {
  const images = await getCachedImages(false);
  const extras = await getImageExtrasRecords(images.map((image) => image.id));
  console.log(`[metadata-search-index] ${dryRun ? 'DRY RUN' : 'REBUILD'} version=${METADATA_SEARCH_INDEX_VERSION} images=${images.length}`);
  const deletedKeys = dryRun ? 0 : await clearMetadataSearchIndex();
  if (!dryRun) console.log(`[metadata-search-index] cleared ${deletedKeys} stale index keys`);
  let indexed = 0;
  let failed = 0;
  for (const image of images) {
    const ok = dryRun || await indexMetadataImage(image, extras[image.id] ?? null).catch(() => false);
    const verified = !dryRun && verify && ok ? await isMetadataImageIndexed(image.id) : ok;
    if (verified) indexed += 1;
    else failed += 1;
    const status = dryRun ? color(36, 'DRY RUN') : verified ? color(32, verify ? 'VERIFIED' : 'INDEXED') : color(31, 'FAILED');
    console.log(`${status} ${image.id} ${image.filename} from=${image.namespace ?? '(none)'} -> search-index reason=full-rebuild`);
  }
  console.log(`[metadata-search-index] complete indexed=${indexed} failed=${failed}${verify ? ' verification=write-confirmed' : ''}`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('[metadata-search-index] fatal', error);
    process.exitCode = 1;
  })
  .finally(() => closeMetadataSearchIndex());
