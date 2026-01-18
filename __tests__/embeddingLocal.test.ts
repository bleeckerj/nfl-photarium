import { describe, it, expect } from 'vitest';

const shouldRun = process.env.RUN_EMBEDDING_E2E === '1';

(shouldRun ? describe : describe.skip)('local CLIP embeddings', () => {
  it('generates an embedding from image bytes', async () => {
    process.env.EMBEDDING_PROVIDER = 'local';

    const { generateClipEmbeddingFromBytes } = await import('@/server/embeddingService');

    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwMCAQF9oZ3yAAAAAElFTkSuQmCC';
    const buffer = Buffer.from(pngBase64, 'base64');

    const embedding = await generateClipEmbeddingFromBytes(buffer);

    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding && embedding.length > 0).toBe(true);
  }, 120000);

  it('generates an embedding from an image URL', async () => {
    process.env.EMBEDDING_PROVIDER = 'local';

    const { generateClipEmbedding } = await import('@/server/embeddingService');

    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwMCAQF9oZ3yAAAAAElFTkSuQmCC';
    const dataUrl = `data:image/png;base64,${pngBase64}`;

    const embedding = await generateClipEmbedding(dataUrl);

    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding && embedding.length > 0).toBe(true);
  }, 120000);
});
