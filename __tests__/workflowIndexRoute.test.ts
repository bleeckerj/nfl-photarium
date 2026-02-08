import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { indexComfyWorkflowIntentsMock } = vi.hoisted(() => ({
  indexComfyWorkflowIntentsMock: vi.fn(),
}));

vi.mock('@/server/comfy/workflowIndexer', () => ({
  indexComfyWorkflowIntents: indexComfyWorkflowIntentsMock,
}));

import { POST } from '@/app/api/workflows/index/route';

function createRequest(body: unknown, contentType = 'application/json') {
  return new NextRequest(
    new Request('http://localhost/api/workflows/index', {
      method: 'POST',
      headers: contentType ? { 'content-type': contentType } : undefined,
      body: contentType ? JSON.stringify(body) : undefined,
    })
  );
}

describe('POST /api/workflows/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('indexes a specific sanitized image id list', async () => {
    indexComfyWorkflowIntentsMock.mockResolvedValueOnce({
      results: [{ imageId: 'img-1', status: 'indexed' }],
      summary: { indexed: 1, skipped: 0, failed: 0 },
    });

    const response = await POST(
      createRequest({ imageIds: [' img-1 ', '', 42, 'img-2'], limit: 30 })
    );

    expect(response.status).toBe(200);
    expect(indexComfyWorkflowIntentsMock).toHaveBeenCalledWith({
      imageIds: ['img-1', 'img-2'],
      limit: 30,
    });
  });

  it('defaults to auto selection when body is empty', async () => {
    indexComfyWorkflowIntentsMock.mockResolvedValueOnce({
      results: [],
      summary: { indexed: 0, skipped: 0, failed: 0 },
    });

    const response = await POST(createRequest({}, ''));

    expect(response.status).toBe(200);
    expect(indexComfyWorkflowIntentsMock).toHaveBeenCalledWith({
      imageIds: undefined,
      limit: undefined,
    });
  });
});
