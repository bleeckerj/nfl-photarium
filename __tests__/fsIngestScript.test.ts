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
