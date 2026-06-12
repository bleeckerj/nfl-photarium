import sharp from 'sharp';

export type TestImageFormat = 'jpeg' | 'png' | 'webp';

export type TestImageFixture = {
  buffer: Buffer;
  contentType: string;
  extension: string;
  filename: string;
  format: TestImageFormat;
};

const contentTypeByFormat: Record<TestImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const createTestImageFixture = async (
  format: TestImageFormat,
  name = `grainrad-source.${format === 'jpeg' ? 'jpg' : format}`
): Promise<TestImageFixture> => {
  const base = sharp({
    create: {
      width: 96,
      height: 72,
      channels: 4,
      background: { r: 36, g: 66, b: 110, alpha: 1 },
    },
  }).composite([
    {
      input: Buffer.from(
        '<svg width="96" height="72" xmlns="http://www.w3.org/2000/svg">' +
          '<rect x="8" y="8" width="80" height="56" fill="#f6d365"/>' +
          '<circle cx="48" cy="36" r="18" fill="#f56b6b"/>' +
        '</svg>'
      ),
    },
  ]);

  const buffer = format === 'png'
    ? await base.png().toBuffer()
    : format === 'webp'
      ? await base.webp({ quality: 86 }).toBuffer()
      : await base.jpeg({ quality: 88 }).toBuffer();

  return {
    buffer,
    contentType: contentTypeByFormat[format],
    extension: format === 'jpeg' ? 'jpg' : format,
    filename: name,
    format,
  };
};

export const createTestImageFixtures = async () => Promise.all([
  createTestImageFixture('png', 'grainrad-source.png'),
  createTestImageFixture('webp', 'grainrad-source.webp'),
  createTestImageFixture('jpeg', 'grainrad-source.jpg'),
]);
