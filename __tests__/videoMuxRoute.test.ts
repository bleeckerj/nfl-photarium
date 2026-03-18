import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getVideoAssetRecordMock,
  startMuxExportMock,
  syncMuxMetadataMock,
} = vi.hoisted(() => ({
  getVideoAssetRecordMock: vi.fn(),
  startMuxExportMock: vi.fn(),
  syncMuxMetadataMock: vi.fn(),
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  getVideoAssetRecord: getVideoAssetRecordMock,
}));

vi.mock('@/server/videoMuxExportService', () => ({
  startMuxExport: startMuxExportMock,
  syncMuxMetadata: syncMuxMetadataMock,
}));

import { GET, POST } from '@/app/api/videos/[id]/mux/route';

describe('video mux route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns 404 when video does not exist', async () => {
    getVideoAssetRecordMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/videos/vid-1/mux');
    const res = await GET(req, { params: Promise.resolve({ id: 'vid-1' }) });
    const payload = await res.json();

    expect(res.status).toBe(404);
    expect(payload.error).toMatch(/not found/i);
  });

  it('GET returns synced mux metadata when asset id exists', async () => {
    getVideoAssetRecordMock.mockResolvedValue({
      id: 'vid-1',
      mux: { assetId: 'mux-asset-1', status: 'ingesting' },
    });
    syncMuxMetadataMock.mockResolvedValue({
      id: 'vid-1',
      mux: { assetId: 'mux-asset-1', status: 'ready', playbackId: 'playback-1' },
    });

    const req = new NextRequest('http://localhost/api/videos/vid-1/mux');
    const res = await GET(req, { params: Promise.resolve({ id: 'vid-1' }) });
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(syncMuxMetadataMock).toHaveBeenCalledWith('vid-1');
    expect(payload.mux.status).toBe('ready');
    expect(payload.mux.playbackId).toBe('playback-1');
  });

  it('POST starts mux export and returns updated metadata', async () => {
    startMuxExportMock.mockResolvedValue({
      id: 'vid-1',
      mux: { assetId: 'mux-asset-1', status: 'ingesting' },
    });

    const req = new NextRequest('http://localhost/api/videos/vid-1/mux', {
      method: 'POST',
      body: JSON.stringify({ force: true, playbackPolicy: 'signed' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'vid-1' }) });
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(startMuxExportMock).toHaveBeenCalledWith({
      videoId: 'vid-1',
      force: true,
      playbackPolicy: 'signed',
    });
    expect(payload.success).toBe(true);
    expect(payload.mux.assetId).toBe('mux-asset-1');
  });

  it('POST returns 400 for missing credentials style errors', async () => {
    startMuxExportMock.mockRejectedValue(new Error('Mux credentials not configured. Set MUX_TOKEN_ID and MUX_TOKEN_SECRET.'));

    const req = new NextRequest('http://localhost/api/videos/vid-1/mux', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'vid-1' }) });
    const payload = await res.json();

    expect(res.status).toBe(400);
    expect(payload.error).toMatch(/not configured/i);
  });
});
