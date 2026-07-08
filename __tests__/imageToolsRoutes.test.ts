import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '@/app/api/image-tools/[toolId]/runs/route';
import { POST as POST_PREVIEW } from '@/app/api/image-tools/[toolId]/previews/route';
import { POST as POST_ACCEPT_PREVIEW } from '@/app/api/image-tools/previews/[previewId]/accept/route';
import { GET as GET_RUN } from '@/app/api/image-tools/runs/[runId]/route';
import { GET as GET_PREVIEW } from '@/app/api/image-tools/previews/[previewId]/route';
import { GET as GET_PREVIEW_ARTIFACT } from '@/app/api/image-tools/previews/[previewId]/artifact/route';
import { createImageToolRun, addImageToolRunEvent } from '@/server/image-tools/runStore';
import { completeImageToolPreview, createImageToolPreview } from '@/server/image-tools/previewStore';

const { acceptImageToolPreviewArtifactMock, startImageToolRunMock, startImageToolPreviewRunMock } = vi.hoisted(() => ({
  acceptImageToolPreviewArtifactMock: vi.fn(),
  startImageToolRunMock: vi.fn(),
  startImageToolPreviewRunMock: vi.fn(),
}));

vi.mock('@/server/image-tools/executor', () => ({
  startImageToolRun: startImageToolRunMock,
  startImageToolPreviewRun: startImageToolPreviewRunMock,
}));

vi.mock('@/server/image-tools/previewAcceptance', () => ({
  acceptImageToolPreviewArtifact: acceptImageToolPreviewArtifactMock,
}));

const createPostRequest = (body: Record<string, unknown>) =>
  new NextRequest(
    new Request('http://localhost/api/image-tools/grainrad/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

const createPreviewPostRequest = (body: Record<string, unknown>) =>
  new NextRequest(
    new Request('http://localhost/api/image-tools/grainrad/previews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

describe('image tool run routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects run creation without an image id', async () => {
    const response = await POST(
      createPostRequest({ request: {} }),
      { params: Promise.resolve({ toolId: 'grainrad' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/imageId/i);
    expect(startImageToolRunMock).not.toHaveBeenCalled();
  });

  it('starts a run through the executor', async () => {
    startImageToolRunMock.mockReturnValueOnce({
      id: 'run-1',
      toolId: 'grainrad',
      imageId: 'img-1',
      status: 'queued',
      message: 'Queued',
      percent: 0,
    });

    const response = await POST(
      createPostRequest({ imageId: 'img-1', request: { effectId: 'threshold' } }),
      { params: Promise.resolve({ toolId: 'grainrad' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload.run.id).toBe('run-1');
    expect(startImageToolRunMock).toHaveBeenCalledWith(
      'grainrad',
      expect.objectContaining({
        imageId: 'img-1',
        request: { effectId: 'threshold' },
      })
    );
  });

  it('returns a stored run by id', async () => {
    const run = createImageToolRun({
      toolId: 'grainrad',
      imageId: 'img-2',
      request: {
        effectId: 'vhs',
        params: {},
        output: { mode: 'still', format: 'png' },
      },
    });
    addImageToolRunEvent(run.id, {
      phase: 'grainrad.submit',
      message: 'Submitted',
    });

    const response = await GET_RUN(
      new Request(`http://localhost/api/image-tools/runs/${run.id}`),
      { params: Promise.resolve({ runId: run.id }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.run.id).toBe(run.id);
    expect(payload.run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'grainrad.submit' }),
      ])
    );
  });

  it('creates a preview through the executor', async () => {
    startImageToolPreviewRunMock.mockReturnValueOnce({
      id: 'preview-1',
      toolId: 'grainrad',
      imageId: 'img-1',
      status: 'running',
      message: 'Rendering Grainrad preview',
      percent: 0.5,
      events: [],
    });

    const response = await POST_PREVIEW(
      createPreviewPostRequest({ imageId: 'img-1', request: { effectId: 'threshold' } }),
      { params: Promise.resolve({ toolId: 'grainrad' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload.preview.id).toBe('preview-1');
    expect(startImageToolPreviewRunMock).toHaveBeenCalledWith(
      'grainrad',
      expect.objectContaining({
        imageId: 'img-1',
        request: { effectId: 'threshold' },
      })
    );
  });

  it('returns a stored preview by id', async () => {
    const preview = createImageToolPreview({
      toolId: 'grainrad',
      imageId: 'img-4',
      request: {
        effectId: 'vhs',
        params: {},
        output: { mode: 'still', format: 'png' },
      },
    });

    const response = await GET_PREVIEW(
      new Request(`http://localhost/api/image-tools/previews/${preview.id}`),
      { params: Promise.resolve({ previewId: preview.id }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.preview.id).toBe(preview.id);
    expect(payload.preview.status).toBe('queued');
  });

  it('streams a stored preview artifact', async () => {
    const preview = createImageToolPreview({
      toolId: 'grainrad',
      imageId: 'img-3',
      request: {
        effectId: 'vhs',
        params: {},
        output: { mode: 'still', format: 'png' },
      },
    });
    completeImageToolPreview(preview.id, {
      buffer: Buffer.from('preview-bytes'),
      contentType: 'image/png',
      filename: 'preview.png',
    });

    const response = await GET_PREVIEW_ARTIFACT(
      new Request(`http://localhost/api/image-tools/previews/${preview.id}/artifact`),
      { params: Promise.resolve({ previewId: preview.id }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('preview-bytes');
  });

  it('accepts a completed preview through the preview acceptance service', async () => {
    acceptImageToolPreviewArtifactMock.mockResolvedValueOnce({
      preview: {
        id: 'preview-accepted',
        toolId: 'grainrad-eight-bit-reinterpretation',
        imageId: 'img-5',
        status: 'completed',
        message: 'Preview ready',
        percent: 1,
        createdAt: '2026-07-08T00:00:00.000Z',
        updatedAt: '2026-07-08T00:00:01.000Z',
        expiresAt: '2026-07-08T00:10:00.000Z',
        request: {
          effectId: 'eight-bit',
          params: {},
          output: { mode: 'still', format: 'png' },
        },
        events: [],
      },
      uploadedAsset: {
        id: 'generated-preview-1',
        assetType: 'image',
        filename: 'accepted.png',
      },
      artifact: {
        filename: 'preview.png',
        contentType: 'image/png',
      },
    });

    const response = await POST_ACCEPT_PREVIEW(
      new Request('http://localhost/api/image-tools/previews/preview-accepted/accept', { method: 'POST' }),
      { params: Promise.resolve({ previewId: 'preview-accepted' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.uploadedAsset.id).toBe('generated-preview-1');
    expect(acceptImageToolPreviewArtifactMock).toHaveBeenCalledWith('preview-accepted');
  });
});
