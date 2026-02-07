import { describe, expect, it } from 'vitest';
import { detectComfyMetadata } from '@/utils/comfyMetadata';

const BASE_PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e527d4a20000000049454e44ae426082',
  'hex'
);

const addChunkBeforeIend = (png: Buffer, type: string, data: Buffer) => {
  const iendChunk = png.subarray(png.length - 12);
  const prefix = png.subarray(0, png.length - 12);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); // CRC not validated by our parser
  return Buffer.concat([prefix, length, typeBytes, data, crc, iendChunk]);
};

describe('detectComfyMetadata', () => {
  it('detects ComfyUI prompt metadata in PNG text chunks', async () => {
    const promptJson = JSON.stringify({
      '1': { class_type: 'KSampler', inputs: { seed: 1 } },
    });
    const chunkData = Buffer.from(`prompt\0${promptJson}`, 'utf8');
    const png = addChunkBeforeIend(BASE_PNG_1X1, 'tEXt', chunkData);

    const result = await detectComfyMetadata(png, { mimeType: 'image/png' });

    expect(result.detected).toBe(true);
    expect(result.sources).toContain('png:prompt');
  });

  it('detects ComfyUI APNG comf metadata chunks', async () => {
    const workflowJson = JSON.stringify({
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'hello' } },
    });
    const comfData = Buffer.concat([
      Buffer.from('workflow\0', 'latin1'),
      Buffer.from(workflowJson, 'latin1'),
    ]);
    const png = addChunkBeforeIend(BASE_PNG_1X1, 'comf', comfData);

    const result = await detectComfyMetadata(png, { mimeType: 'image/png' });

    expect(result.detected).toBe(true);
    expect(result.sources).toContain('png-comf:workflow');
  });

  it('returns false when no ComfyUI metadata exists', async () => {
    const result = await detectComfyMetadata(BASE_PNG_1X1, { mimeType: 'image/png' });
    expect(result.detected).toBe(false);
    expect(result.sources).toEqual([]);
  });
});
