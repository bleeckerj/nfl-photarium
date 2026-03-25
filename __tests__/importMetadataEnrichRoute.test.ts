import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/import/page/metadata/enrich/route';

const { enrichImportCandidateMetadataMock } = vi.hoisted(() => ({
  enrichImportCandidateMetadataMock: vi.fn(),
}));

vi.mock('@/server/import-metadata/service', () => ({
  enrichImportCandidateMetadata: enrichImportCandidateMetadataMock,
}));

const createRequest = (body: Record<string, unknown>) =>
  new NextRequest(
    new Request('http://localhost/api/import/page/metadata/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

describe('POST /api/import/page/metadata/enrich', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    enrichImportCandidateMetadataMock.mockResolvedValue({
      id: 'ignored-by-route',
      url: 'https://example.com/image.jpg',
      metadata: {
        status: 'resolved',
        fileSizeBytes: 2048,
        dimensions: { width: 1200, height: 800 },
      },
      tempAssetKey: 'asset-1',
    });
  });

  it('returns metadata patches keyed to the incoming candidate ids', async () => {
    const response = await POST(
      createRequest({
        sessionId: 'session-1',
        candidates: [
          {
            id: 'candidate-1',
            url: 'https://example.com/image.jpg',
            filename: 'image.jpg',
            metadata: { status: 'pending' },
          },
        ],
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.patches).toEqual([
      expect.objectContaining({
        id: 'candidate-1',
        url: 'https://example.com/image.jpg',
        tempAssetKey: 'asset-1',
        metadata: expect.objectContaining({
          status: 'resolved',
          fileSizeBytes: 2048,
        }),
      }),
    ]);
  });
});
