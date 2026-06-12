import { describe, expect, it } from 'vitest';

import { createTestImageFixture } from './helpers/imageFixtures';
import { assertDecodableSourceImage } from '@/server/image-tools/sourceImageValidation';

describe('source image validation', () => {
  it('accepts a real image buffer', async () => {
    const fixture = await createTestImageFixture('webp');

    await expect(assertDecodableSourceImage({
      buffer: fixture.buffer,
      contentType: fixture.contentType,
      filename: fixture.filename,
      imageId: 'source-webp',
    })).resolves.toBeUndefined();
  });

  it('rejects non-image responses before Grainrad sees them', async () => {
    await expect(assertDecodableSourceImage({
      buffer: Buffer.from('<html>not an image</html>'),
      contentType: 'text/html; charset=utf-8',
      filename: 'source.webp',
      imageId: 'source-html',
    })).rejects.toThrow(/not an image/i);
  });

  it('rejects corrupt image bytes before Grainrad sees them', async () => {
    await expect(assertDecodableSourceImage({
      buffer: Buffer.from('not-webp-image-data'),
      contentType: 'image/webp',
      filename: 'source.webp',
      imageId: 'source-corrupt',
    })).rejects.toThrow(/not decodable/i);
  });
});
