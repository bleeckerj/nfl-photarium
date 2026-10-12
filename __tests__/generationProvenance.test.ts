import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { FileExtrasStorage, type IExtrasStorage } from '@/server/extrasStorage';
import { sha256, validateReceipt } from '@/server/provenance/validation';
import { attachReceipt, saveUploadReceipt } from '@/server/provenance/service';
import { getReceiptJson, getProvenanceRevision, listReceiptBindings, markProvenanceImageDeleted } from '@/server/provenance/storage';
import { projectProvenance } from '@/server/provenance/projection';
import { readProvenance, writeProvenance } from '@/server/provenance/routes';
import { verifyUploadReceipt } from '@/server/provenance/upload';
import { persistUploadedReceipt } from '@/server/provenance/upload';
import { getCachedImage } from '@/server/cloudflareImageCache';
import { requireProvenanceAccess } from '@/server/provenance/access';

const state = vi.hoisted(() => ({ storage: null as IExtrasStorage | null, download: vi.fn() }));
vi.mock('@/server/extrasStorage', async (original) => ({ ...await original<typeof import('@/server/extrasStorage')>(), getExtrasStorage: () => state.storage! }));
vi.mock('@/server/image-tools/sourceDownloader', () => ({ downloadSourceImage: state.download }));
vi.mock('@/server/cloudflareImageCache', () => ({ getCachedImage: vi.fn() }));

let directory: string;
let bytes: Buffer;
const receipt = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  schema_version: 1, provider: 'openai', model: 'gpt-image-2.5-sunburst-2026-09-08',
  created_at: '2026-10-12T01:00:00Z', request_id: 'req_test',
  request: { prompt: 'Change Infection to Inflection', quality: 'xhigh', size: '2048x1152' },
  api_response: { quality: 'xhigh', size: '2048x1152', usage: { input_tokens: 42 } },
  source_images: [{ path: '/private/source.png', sha256: 'a'.repeat(64), bytes: 50, dimensions: [2, 3] }],
  outputs: [{ sha256: sha256(bytes), bytes: bytes.length, dimensions: [2, 3] }], ...overrides,
}, null, 2);

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'photarium-provenance-test-'));
  state.storage = new FileExtrasStorage(path.join(directory, 'store'));
  bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#00aaff' } }).png().toBuffer();
  state.download.mockReset().mockResolvedValue({ buffer: bytes });
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe('generation provenance', () => {
  it('preserves exact JSON, is idempotent, and survives reopening and backup restoration', async () => {
    const json = receipt();
    const first = await attachReceipt({ imageId: 'child', receipt: json, sourceImageIds: ['direct-input'] });
    const again = await attachReceipt({ imageId: 'child', receipt: json, sourceImageIds: ['different-retry-input'] });
    expect(again).toEqual(first);
    expect(await listReceiptBindings('child')).toHaveLength(1);
    expect(first.sourceImageIds).toEqual(['direct-input']);
    const backup = `${directory}/backup`;
    await cp(path.join(directory, 'store'), backup, { recursive: true });
    state.storage = new FileExtrasStorage(backup);
    expect(await getReceiptJson('child', first.receiptId)).toBe(json);
    expect(sha256(await getReceiptJson('child', first.receiptId))).toBe(first.receiptId);
  });

  it('keeps concurrent receipts and selects the matching output of a multi-output receipt', async () => {
    const alternate = receipt({ outputs: [
      { sha256: 'b'.repeat(64), bytes: 42, dimensions: [4, 5] },
      { sha256: sha256(bytes), bytes: bytes.length, dimensions: [2, 3] },
    ] });
    const bindings = await Promise.all([receipt(), alternate].map((json) => attachReceipt({ imageId: 'child', receipt: json })));
    expect(bindings[1].outputIndex).toBe(1);
    expect(await listReceiptBindings('child')).toHaveLength(2);
    expect(await getProvenanceRevision()).not.toBe('0');
  });

  it('lists formatting copies once while retaining exact JSON for both IDs', async () => {
    const json = receipt();
    const compact = JSON.stringify(JSON.parse(json));
    const uploaded = await attachReceipt({ imageId: 'child', receipt: json, uploadSource: bytes, persistedHash: sha256(bytes) });
    const attached = await attachReceipt({ imageId: 'child', receipt: compact });
    expect(attached.receiptId).not.toBe(uploaded.receiptId);
    expect(await listReceiptBindings('child')).toEqual([attached]);
    expect(await getReceiptJson('child', uploaded.receiptId)).toBe(json);
    expect(await getReceiptJson('child', attached.receiptId)).toBe(compact);
  });

  it('groups reordered JSON keys and preserves receipts with different prompts', async () => {
    const parsed: Record<string, unknown> = JSON.parse(receipt());
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse()));
    await attachReceipt({ imageId: 'child', receipt: receipt() });
    await attachReceipt({ imageId: 'child', receipt: reordered });
    expect(await listReceiptBindings('child')).toHaveLength(1);
    const changed = receipt({ request: { prompt: 'A different generation prompt', quality: 'xhigh', size: '2048x1152' } });
    await attachReceipt({ imageId: 'child', receipt: changed });
    expect(await listReceiptBindings('child')).toHaveLength(2);
  });

  it('preserves distinct persisted hashes and declared sources for equivalent receipts', async () => {
    const json = receipt();
    await attachReceipt({ imageId: 'child', receipt: json, uploadSource: bytes, persistedHash: 'c'.repeat(64) });
    await attachReceipt({ imageId: 'child', receipt: JSON.stringify(JSON.parse(json)) });
    expect(await listReceiptBindings('child')).toHaveLength(2);
    await attachReceipt({ imageId: 'child', receipt: `${json}\n`, sourceImageIds: ['other-source'] });
    expect(await listReceiptBindings('child')).toHaveLength(3);
  });

  it('rejects mismatched hashes and dimensions without creating availability', async () => {
    await expect(attachReceipt({ imageId: 'child', receipt: receipt({ outputs: [{ sha256: 'f'.repeat(64), bytes: bytes.length, dimensions: [2, 3] }] }) })).rejects.toThrow('does not match');
    await expect(attachReceipt({ imageId: 'child', receipt: receipt({ outputs: [{ sha256: sha256(bytes), bytes: bytes.length, dimensions: [3, 2] }] }) })).rejects.toThrow('dimensions conflict');
    expect(await projectProvenance([{ id: 'child' }])).toMatchObject([{ provenanceAvailable: false }]);
    expect(state.download).toHaveBeenCalledWith('child', { requireOriginal: true });
  });

  it('retains separate generated and persisted hashes for normalized uploads', async () => {
    const binding = await attachReceipt({ imageId: 'child', receipt: receipt(), uploadSource: bytes, persistedHash: 'c'.repeat(64) });
    expect(binding).toMatchObject({ generatedSha256: sha256(bytes), persistedSha256: 'c'.repeat(64), verification: 'upload-source-matched' });
    expect(state.download).not.toHaveBeenCalled();
  });

  it('retains receipts and a tombstone after image cleanup', async () => {
    const binding = await attachReceipt({ imageId: 'child', receipt: receipt() });
    await markProvenanceImageDeleted('child');
    expect(await state.storage!.get('generation-tombstone:child')).toMatchObject({ imageId: 'child' });
    expect(await getReceiptJson('child', binding.receiptId)).toBe(receipt());
  });

  it('reports persistence failure without losing the successful upload ID', async () => {
    vi.spyOn(state.storage!, 'setIfAbsent').mockRejectedValueOnce(new Error('storage offline'));
    expect(await saveUploadReceipt({ imageId: 'uploaded-child', receipt: receipt(), uploadSource: bytes, persistedHash: sha256(bytes) }))
      .toMatchObject({ imageId: 'uploaded-child', saved: false });
    expect((await saveUploadReceipt({ imageId: 'uploaded-child', receipt: receipt(), uploadSource: bytes, persistedHash: sha256(bytes) })).saved).toBe(true);
  });

  it('verifies stored bytes when cache access fails after upload', async () => {
    vi.mocked(getCachedImage).mockRejectedValueOnce(new Error('cache unavailable'));
    const result = await persistUploadedReceipt('uploaded-child', receipt(), bytes);
    expect(result).toMatchObject({ imageId: 'uploaded-child', saved: true, verified: true });
    expect(state.download).toHaveBeenCalledWith('uploaded-child', { requireOriginal: true });
  });

  it('requires receipts for declared generated uploads while preserving ordinary uploads', () => {
    const form = new FormData();
    expect(verifyUploadReceipt(form, bytes)).toBeUndefined();
    form.set('generated', 'true');
    expect(() => verifyUploadReceipt(form, bytes)).toThrow('require a provenance receipt');
    form.set('provenanceReceipt', receipt());
    expect(verifyUploadReceipt(form, bytes)?.model).toContain('2026-09-08');
  });

  it.each([
    { schema_version: 2 }, { model: '' }, { created_at: 'invalid' }, { api_key: 'private' },
    { headers: {} }, { outputs: [] }, { request: { prompt: `sk-proj-${'x'.repeat(40)}` } },
    { request: { source: 'https://example.test/?token=private' } },
  ])('rejects unsupported or unsafe receipt %j', (override) => {
    expect(() => validateReceipt(receipt(override))).toThrow();
  });

  it('keeps full receipts out of gallery projections and binds downloads to their image', async () => {
    const binding = await attachReceipt({ imageId: 'child', receipt: receipt() });
    const gallery = await projectProvenance([{ id: 'child' }, { id: 'other' }]);
    expect(gallery).toMatchObject([{ provenanceAvailable: true }, { provenanceAvailable: false }]);
    expect(JSON.stringify(gallery)).not.toContain('/private/');
    await expect(getReceiptJson('other', binding.receiptId)).rejects.toThrow('not attached');
    const download = await readProvenance(new Request(`http://localhost/api/images/child/provenance?receiptId=${binding.receiptId}`), 'child');
    expect(download.headers.get('Cache-Control')).toBe('private, no-store');
    expect(download.headers.get('Content-Disposition')).toContain('attachment;');
    expect(await download.text()).toBe(receipt());
    const inline = await readProvenance(new Request(`http://localhost/api/images/child/provenance?receiptId=${binding.receiptId}&view=inline`), 'child');
    expect(inline.headers.get('Content-Disposition')).toContain('inline;');
    expect(inline.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await inline.text()).toBe(receipt());
    const unbound = await readProvenance(new Request(`http://localhost/api/images/other/provenance?receiptId=${binding.receiptId}&view=inline`), 'other');
    expect(unbound.status).toBe(404);
  });

  it('rejects cross-origin and remote receipt access; permits configured operator bearer access', async () => {
    const blocked = await writeProvenance(new Request('https://example.test/api/images/child/provenance', { method: 'POST', body: '{}' }), 'child');
    expect(blocked.status).toBe(403);
    expect(() => requireProvenanceAccess(new Request('http://localhost/api', { headers: { origin: 'https://example.test' } }))).toThrow('Operator access');
    vi.stubEnv('PHOTARIUM_PROVENANCE_TOKEN', 'operator-token-é');
    expect(() => requireProvenanceAccess(new Request('https://example.test/api', { headers: { authorization: 'Bearer operator-token-é' } }))).not.toThrow();
  });
});
