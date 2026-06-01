import { describe, expect, it } from 'vitest';

describe('dng-ingest script helpers', async () => {
  const script = await import('../scripts/dng-ingest.mjs');

  it('parses preview and embedding options without running ingest', () => {
    const options = script.parseArgs([
      '--root',
      '/tmp/photos',
      '--namespace',
      'cf-raw',
      '--preview-max',
      '2k',
      '--preview-format',
      'webp',
      '--preview-quality',
      '82',
      '--no-embeddings',
      '--quiet',
    ]);

    expect(options.errors).toEqual([]);
    expect(options.root).toBe('/tmp/photos');
    expect(options.namespace).toBe('cf-raw');
    expect(options.previewMax).toBe(2048);
    expect(options.previewFormat).toBe('webp');
    expect(options.previewQuality).toBe(82);
    expect(options.ensureEmbeddings).toBe(false);
    expect(options.verbose).toBe(false);
  });

  it('defaults AI metadata to tags while preserving display names', () => {
    const options = script.parseArgs([
      '--root',
      '/tmp/photos',
      '--namespace',
      'cf-raw',
      '--ai-metadata',
    ]);

    expect(options.aiTags).toBe(true);
    expect(options.aiDisplayName).toBe(false);
  });
});
