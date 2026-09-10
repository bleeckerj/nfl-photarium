import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('fs-ingest script', async () => {
  const script = await import('../scripts/fs-ingest.mjs');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses --on-duplicate family', () => {
    const options = script.parseArgs([
      '--root',
      '/tmp/images',
      '--namespace',
      'cf-default',
      '--on-duplicate',
      'family',
    ]);

    expect(options.errors).toEqual([]);
    expect(options.onDuplicate).toBe('family');
  });

  it('discovers DNGs recursively and uploads their raw bytes with a DNG MIME type', async () => {
    const { walkMediaFiles } = await import('../scripts/fs-ingest/mediaPipeline.mjs');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-dng-'));
    try {
      await fs.mkdir(path.join(directory, 'photos'));
      const filePath = path.join(directory, 'photos', 'Camera.DNG');
      await fs.writeFile(filePath, 'raw-bytes');
      expect(await walkMediaFiles(directory)).toEqual([{ path: filePath, kind: 'image' }]);
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = init?.body as FormData;
        const file = body.get('file') as File;
        expect(file.name).toBe('Camera.DNG');
        expect(file.type).toBe('image/x-adobe-dng');
        expect(await file.text()).toBe('raw-bytes');
        expect(body.get('namespace')).toBe('cf-test');
        return new Response(JSON.stringify({ id: 'converted-image' }), { status: 200 });
      });
      const result = await script.uploadImage({ apiBase: 'http://localhost:3000', filePath, namespace: 'cf-test', tags: [] });
      expect(result.ok).toBe(true);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('passes duplicateAction through multipart uploads when family mode is requested', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-ingest-'));
    const filePath = path.join(tmpDir, 'sample.png');
    await fs.writeFile(filePath, 'png-ish');

    let duplicateActionValue: FormDataEntryValue | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = init?.body as FormData;
      duplicateActionValue = body.get('duplicateAction');
      return new Response(JSON.stringify({ id: 'img-1' }), { status: 200 });
    });

    const result = await script.uploadImage({
      apiBase: 'http://localhost:3000',
      filePath,
      namespace: 'cf-default',
      folder: 'discord',
      tags: ['discord'],
      description: 'sample',
      displayName: 'Sample',
      sourcePath: 'local://sample.png',
      duplicateAction: 'family',
    });

    expect(result.ok).toBe(true);
    expect(duplicateActionValue).toBe('family');
  });
});
