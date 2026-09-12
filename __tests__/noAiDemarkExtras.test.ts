import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const patch = vi.hoisted(() => vi.fn());
vi.mock('@/server/imageExtras', () => ({ getImageExtrasRecord: vi.fn(), patchImageExtrasRecord: patch }));
import { PATCH } from '@/app/api/images/[id]/extras/route';

const provenance = {
  toolId: 'no-ai-demarker', adapterKind: 'noai-watermark', sourceImageId: 'source',
  effectId: 'metadata', params: { hostedOriginalSha256: 'verified-sha', verification: { c2pa_present: false } },
  output: { mode: 'still', format: 'webp' }, createdAt: '2026-09-12T00:00:00.000Z',
};
const request = (body: unknown) => new NextRequest('http://localhost/api/images/child/extras', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('demark Extras provenance', () => {
  beforeEach(() => {
    patch.mockReset().mockImplementation(async (imageId: string, updates: unknown) => ({ imageId, ...(updates as object) }));
  });

  it('persists and returns structured verification without replacing the description', async () => {
    const response = await PATCH(request({ imageToolRun: provenance }), { params: Promise.resolve({ id: 'child' }) });
    expect(response.status).toBe(200);
    expect(patch).toHaveBeenCalledWith('child', { imageToolRun: provenance });
    expect(await response.json()).toMatchObject({ record: { imageToolRun: provenance } });
  });

  it('rejects malformed provenance before writing', async () => {
    const response = await PATCH(request({ imageToolRun: { sourceImageId: 'source' } }), { params: Promise.resolve({ id: 'child' }) });
    expect(response.status).toBe(400);
    expect(patch).not.toHaveBeenCalled();
  });
});
