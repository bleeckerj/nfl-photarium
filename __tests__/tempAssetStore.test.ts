import { afterEach, describe, expect, it } from 'vitest';
import {
  clearImportSession,
  createImportSession,
  getTempAssetByUrl,
  readTempAssetBuffer,
  releaseTempAsset,
  storeTempAsset,
} from '@/server/import-metadata/tempAssetStore';

describe('tempAssetStore', () => {
  const createdSessions = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(createdSessions).map((sessionId) => clearImportSession(sessionId)));
    createdSessions.clear();
  });

  it('stores, reads, and releases temp assets by url', async () => {
    const session = await createImportSession();
    createdSessions.add(session.sessionId);

    const record = await storeTempAsset({
      sessionId: session.sessionId,
      url: 'https://example.com/image.jpg',
      buffer: Buffer.from('image-bytes'),
      filename: 'image.jpg',
      contentType: 'image/jpeg',
      dimensions: { width: 1200, height: 800 },
    });

    const stored = await getTempAssetByUrl(session.sessionId, 'https://example.com/image.jpg');
    expect(stored).toMatchObject({
      assetKey: record.assetKey,
      fileSizeBytes: Buffer.byteLength('image-bytes'),
      contentType: 'image/jpeg',
      dimensions: { width: 1200, height: 800 },
    });

    const temp = await readTempAssetBuffer(session.sessionId, record.assetKey);
    expect(temp?.buffer.toString('utf-8')).toBe('image-bytes');

    await releaseTempAsset({ sessionId: session.sessionId, url: 'https://example.com/image.jpg' });
    const afterRelease = await getTempAssetByUrl(session.sessionId, 'https://example.com/image.jpg');
    expect(afterRelease).toBeNull();
  });
});
