import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const SOURCE_EXTENSIONS = /\.(mjs|js|jsx|ts|tsx)$/;
const TEST_EXTENSIONS = /\.(test|spec)\.(mjs|js|jsx|ts|tsx)$/;

function run(command, args) {
  console.log(`[hygiene:targeted] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function gitLines(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' })
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function unique(values) {
  return [...new Set(values)].sort();
}

function changedFiles() {
  const staged = gitLines(['diff', '--name-only', '--cached']);
  const unstaged = gitLines(['diff', '--name-only']);
  const untracked = gitLines(['ls-files', '--others', '--exclude-standard']);
  return unique([...staged, ...unstaged, ...untracked]).filter((file) => existsSync(file));
}

function testsForFile(file) {
  const tests = [];
  if (TEST_EXTENSIONS.test(file)) tests.push(file);
  if (file.includes('ImageUploader') || file.includes('image-uploader/')) {
    tests.push('__tests__/imageUploaderHelpers.test.ts');
  }
  if (file.includes('ImageGallery') || file.includes('components/gallery/') || file.includes('galleryQuery')) {
    tests.push('__tests__/galleryQuery.test.ts', '__tests__/imageGalleryMotionAssets.test.ts');
  }
  if (file.includes('image-detail/')) {
    tests.push('__tests__/imageDetailTransforms.test.ts');
  }
  if (file.includes('video-detail/') || file.includes('app/videos/[id]')) {
    tests.push('__tests__/videoDetailTransforms.test.ts');
  }
  if (file.includes('page-import/') || file.includes('/api/import/page/scroll')) {
    tests.push('__tests__/importPageScrollStreamRoute.test.ts');
  }
  if (file.includes('uploadExternalRoute') || file.includes('/api/upload/external')) {
    tests.push('__tests__/uploadExternalRoute.test.ts');
  }
  if (file.includes('imageSearchRoute') || file.includes('/api/images/search')) {
    tests.push('__tests__/imageSearchRoute.test.ts');
  }
  if (file.includes('vectorSearch') || file.includes('vectorColorTransforms')) {
    tests.push('__tests__/imageSearchRoute.test.ts', '__tests__/colorsRoute.test.ts');
  }
  if (file.includes('cloudflareImageCache')) {
    tests.push(
      '__tests__/cloudflareImageCache.test.ts',
      '__tests__/imageRouteEmbeddingStatus.test.ts',
      '__tests__/uploadExternalRoute.test.ts'
    );
  }
  if (file.includes('assetParentService') || file.includes('detach-children')) {
    tests.push('__tests__/assetParentService.test.ts', '__tests__/detachChildrenRoute.test.ts');
  }
  if (file.includes('image-tools/')) {
    tests.push('__tests__/imageToolsRegistry.test.ts', '__tests__/imageToolsRoutes.test.ts');
  }
  if (file.includes('fs-ingest')) {
    tests.push('__tests__/fsIngestScript.test.ts', '__tests__/fsIngestFlickrSidecar.test.ts');
  }
  if (file.includes('dng-ingest')) {
    tests.push('__tests__/dngIngestScript.test.ts');
  }
  if (file.includes('audit-file-sizes') || file.includes('hygiene-targeted')) {
    tests.push();
  }
  return tests.filter((test) => existsSync(test));
}

const files = changedFiles();
console.log(`[hygiene:targeted] changed files: ${files.length}`);

run('npm', ['run', 'size:audit']);

const lintFiles = files.filter((file) => SOURCE_EXTENSIONS.test(file));
if (lintFiles.length > 0) {
  run('npx', ['eslint', ...lintFiles]);
} else {
  console.log('[hygiene:targeted] no changed lintable files');
}

const testFiles = unique(files.flatMap(testsForFile));
if (testFiles.length > 0) {
  run('npx', ['vitest', 'run', ...testFiles]);
} else {
  console.log('[hygiene:targeted] no mapped targeted tests');
}
