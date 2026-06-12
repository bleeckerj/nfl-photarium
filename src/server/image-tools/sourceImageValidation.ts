import sharp from 'sharp';

type SourceImageValidationInput = {
  buffer: Buffer;
  contentType: string;
  filename: string;
  imageId: string;
};

const normalizeContentType = (contentType: string) =>
  contentType.split(';', 1)[0]?.trim().toLowerCase() || 'application/octet-stream';

const sourceLabel = (input: SourceImageValidationInput) =>
  `${input.imageId} (${input.filename}, ${normalizeContentType(input.contentType)}, ${input.buffer.byteLength} bytes)`;

export const assertDecodableSourceImage = async (input: SourceImageValidationInput) => {
  const normalizedContentType = normalizeContentType(input.contentType);
  if (!normalizedContentType.startsWith('image/')) {
    throw new Error(
      `Source image download for ${sourceLabel(input)} returned ${normalizedContentType}, not an image. ` +
      'Check Cloudflare source asset availability before sending it to Grainrad.'
    );
  }

  if (input.buffer.byteLength === 0) {
    throw new Error(
      `Source image download for ${sourceLabel(input)} was empty. ` +
      'Check Cloudflare source asset bytes before sending it to Grainrad.'
    );
  }

  try {
    const metadata = await sharp(input.buffer, { animated: true }).metadata();
    if (!metadata.width || !metadata.height || !metadata.format) {
      throw new Error('missing image dimensions or format metadata');
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Source image download for ${sourceLabel(input)} is not decodable: ${detail}. ` +
      'Check Cloudflare source asset bytes before sending it to Grainrad.'
    );
  }
};
