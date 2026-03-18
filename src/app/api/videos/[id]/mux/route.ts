import { NextRequest, NextResponse } from 'next/server';
import { getVideoAssetRecord } from '@/server/videoCatalogStorage';
import { startMuxExport, syncMuxMetadata } from '@/server/videoMuxExportService';

type StartMuxExportBody = {
  force?: boolean;
  playbackPolicy?: 'public' | 'signed';
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    const record = await getVideoAssetRecord(id);
    if (!record) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const synced = record.mux?.assetId
      ? await syncMuxMetadata(id)
      : record;

    return NextResponse.json({
      success: true,
      videoId: synced.id,
      mux: synced.mux || null,
    });
  } catch (error) {
    console.error('[video mux] GET failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch Mux export status' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({})) as StartMuxExportBody;
    const updated = await startMuxExport({
      videoId: id,
      force: body.force === true,
      playbackPolicy: body.playbackPolicy === 'signed' ? 'signed' : 'public',
    });

    return NextResponse.json({
      success: true,
      videoId: updated.id,
      mux: updated.mux || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start Mux export';
    console.error('[video mux] POST failed', error);

    if (
      message.includes('not configured') ||
      message.includes('No valid source URL') ||
      message.includes('Video not found')
    ) {
      const status = message.includes('Video not found') ? 404 : 400;
      return NextResponse.json({ error: message }, { status });
    }

    return NextResponse.json({ error: message }, { status: 502 });
  }
}

