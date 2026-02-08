import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  searchComfyWorkflowsByIntentMock,
  isWorkflowIntentSearchAvailableMock,
} = vi.hoisted(() => ({
  searchComfyWorkflowsByIntentMock: vi.fn(),
  isWorkflowIntentSearchAvailableMock: vi.fn(),
}));

vi.mock('@/server/comfy/workflowSearch', () => ({
  searchComfyWorkflowsByIntent: searchComfyWorkflowsByIntentMock,
}));

vi.mock('@/server/comfy/workflowIntentSearch', () => ({
  isWorkflowIntentSearchAvailable: isWorkflowIntentSearchAvailableMock,
}));

import { GET, POST } from '@/app/api/workflows/search/route';

function createJsonRequest(url: string, body: unknown) {
  return new NextRequest(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

describe('POST /api/workflows/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when query is missing', async () => {
    const response = await POST(createJsonRequest('http://localhost/api/workflows/search', {}));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/query/i);
  });

  it('returns 503 when index is unavailable', async () => {
    isWorkflowIntentSearchAvailableMock.mockResolvedValueOnce(false);

    const response = await POST(
      createJsonRequest('http://localhost/api/workflows/search', { query: 'retro poster style' })
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toMatch(/index/i);
  });

  it('returns search results with count', async () => {
    isWorkflowIntentSearchAvailableMock.mockResolvedValueOnce(true);
    searchComfyWorkflowsByIntentMock.mockResolvedValueOnce([
      {
        imageId: 'img-1',
        representativeImage: {
          id: 'img-1',
          filename: 'image.png',
          uploaded: '2026-02-07T00:00:00.000Z',
        },
        workflowIntentText: 'prompt_candidates: retro poster',
        promptCandidates: ['retro poster'],
        nodeTypeSignatures: ['CLIPTextEncode'],
        nodeSettingSignatures: ['KSampler(steps=20,cfg=6)'],
        reason: {
          annDistance: 0.2,
          annSimilarity: 0.9,
          clipSimilarity: 0.7,
          keywordOverlap: 0.6,
          matchedTerms: ['retro', 'poster'],
          weightedScore: 0.81,
        },
      },
    ]);

    const response = await POST(
      createJsonRequest('http://localhost/api/workflows/search', {
        query: 'retro poster style',
        limit: 8,
        includeWorkflowJson: false,
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(payload.results[0].imageId).toBe('img-1');
    expect(searchComfyWorkflowsByIntentMock).toHaveBeenCalledWith({
      query: 'retro poster style',
      limit: 8,
      offset: undefined,
      includeWorkflowJson: false,
    });
  });

  it('supports GET query string shorthand', async () => {
    isWorkflowIntentSearchAvailableMock.mockResolvedValueOnce(true);
    searchComfyWorkflowsByIntentMock.mockResolvedValueOnce([]);

    const response = await GET(
      new NextRequest('http://localhost/api/workflows/search?q=cathedral%20interior&limit=5')
    );

    expect(response.status).toBe(200);
    expect(searchComfyWorkflowsByIntentMock).toHaveBeenCalledWith({
      query: 'cathedral interior',
      limit: 5,
      offset: undefined,
      includeWorkflowJson: true,
    });
  });
});
