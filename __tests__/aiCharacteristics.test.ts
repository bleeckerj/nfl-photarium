import { describe, expect, it } from 'vitest';
import {
  combineAiCharacteristicScans,
  scanAiCharacteristics,
} from '@/utils/aiCharacteristics';
import { transformImage } from '@/server/cloudflareImageCacheMapper';
import { toListableImage } from '@/server/galleryQueryRoute';
import { enforceCloudflareMetadataLimit, pickCloudflareMetadata } from '@/utils/cloudflareMetadata';

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngChunk = (type: string, data: string | Buffer) => {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const result = Buffer.alloc(12 + payload.length);
  result.writeUInt32BE(payload.length, 0);
  result.write(type, 4, 4, 'ascii');
  payload.copy(result, 8);
  return result;
};

const pngWithText = (key: string, value: string) => Buffer.concat([
  pngSignature,
  pngChunk('tEXt', Buffer.concat([Buffer.from(key), Buffer.from([0]), Buffer.from(value)])),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const webpWithC2pa = () => {
  const payload = Buffer.from('c2pa credential payload');
  const chunk = Buffer.alloc(8 + payload.length + 1);
  chunk.write('C2PA', 0, 4, 'ascii');
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, 8);
  return Buffer.concat([Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'binary'), chunk]);
};

describe('scanAiCharacteristics', () => {
  it('detects explicit AI metadata fields in PNG text chunks', async () => {
    await expect(scanAiCharacteristics(pngWithText('parameters', 'steps=20; sampler=Euler'))).resolves.toMatchObject({
      status: 'detected',
      sources: ['ai-metadata'],
      format: 'png',
    });
  });

  it('detects Comfy-style workflow metadata as AI evidence', async () => {
    const workflow = JSON.stringify({ '1': { class_type: 'KSampler', inputs: { steps: 20 } } });
    const result = await scanAiCharacteristics(pngWithText('prompt', workflow), { mimeType: 'image/png' });
    expect(result.status).toBe('detected');
    expect(result.sources).toContain('ai-metadata');
  });

  it('detects PNG, WebP, and JPEG C2PA containers without claiming validation', async () => {
    const png = Buffer.concat([pngSignature, pngChunk('caBX', Buffer.from('jumbf')), pngChunk('IEND', Buffer.alloc(0))]);
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xeb, 0x00, 0x12]),
      Buffer.from('c2pa-jumbf-data'),
      Buffer.from([0xff, 0xd9]),
    ]);
    await expect(scanAiCharacteristics(png)).resolves.toMatchObject({ status: 'detected', sources: ['c2pa-jumbf'] });
    await expect(scanAiCharacteristics(webpWithC2pa())).resolves.toMatchObject({ status: 'detected', sources: ['c2pa-jumbf'] });
    await expect(scanAiCharacteristics(jpeg)).resolves.toMatchObject({ status: 'detected', sources: ['c2pa-jumbf'] });

    const jpegJumbf = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xeb, 0x00, 0x06]),
      Buffer.from('jumb'),
      Buffer.from([0xff, 0xd9]),
    ]);
    await expect(scanAiCharacteristics(jpegJumbf)).resolves.toMatchObject({ status: 'detected', sources: ['c2pa-jumbf'] });
  });

  it('does not treat ordinary comments or camera metadata names as AI evidence', async () => {
    await expect(scanAiCharacteristics(pngWithText('Comment', 'a prompt for a family portrait'))).resolves.toMatchObject({
      status: 'clear',
      sources: [],
    });
  });

  it('reports unsupported AVIF and combines source and persisted-byte evidence', async () => {
    await expect(scanAiCharacteristics(Buffer.from('....ftypavif....'), { mimeType: 'image/avif' })).resolves.toMatchObject({
      status: 'unsupported',
      format: 'unsupported',
    });
    const combined = combineAiCharacteristicScans([
      {
        scan: { scannerVersion: 'v1', status: 'detected', sources: ['ai-metadata'], format: 'jpeg' },
        evidenceBasis: 'uploaded-source',
      },
      {
        scan: { scannerVersion: 'v1', status: 'detected', sources: ['c2pa-jumbf'], format: 'jpeg' },
        evidenceBasis: 'persisted-bytes',
      },
    ]);
    expect(combined).toMatchObject({
      status: 'detected',
      sources: ['ai-metadata', 'c2pa-jumbf'],
      evidenceBases: ['uploaded-source', 'persisted-bytes'],
    });
  });

  it('preserves the positive marker through metadata selection, cache mapping, and gallery serialization', () => {
    const metadata = {
      aiCharacteristicsDetected: true,
      aiCharacteristicsSources: ['ai-metadata', 'c2pa-jumbf'],
      aiCharacteristicsScannerVersion: 'v1',
    };
    const picked = pickCloudflareMetadata(metadata);
    const cached = transformImage({
      id: 'ai-image',
      filename: 'ai-image.png',
      uploaded: '2026-09-12T00:00:00.000Z',
      variants: [],
      meta: picked,
    });
    const serialized = toListableImage(cached as unknown as Record<string, unknown>);

    expect(cached).toMatchObject(metadata);
    expect(serialized).toMatchObject(metadata);
  });

  it('keeps the compact positive marker ahead of oversized descriptive metadata', () => {
    const result = enforceCloudflareMetadataLimit({
      description: 'x'.repeat(4_000),
      aiCharacteristicsDetected: true,
      aiCharacteristicsSources: ['ai-metadata'],
      aiCharacteristicsScannerVersion: 'v1',
    });

    expect(result.metadata.aiCharacteristicsDetected).toBe(true);
    expect(result.metadata.aiCharacteristicsSources).toEqual(['ai-metadata']);
  });
});
