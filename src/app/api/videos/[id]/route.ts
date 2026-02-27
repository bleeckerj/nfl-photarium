import { NextRequest, NextResponse } from 'next/server';
import {
  getVideoAssetRecord,
  getVideoAssetRecordWithSync,
} from '@/server/videoCatalogStorage';
import { queueAutoEmbeddingsForVideo } from '@/server/videoEmbeddingService';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    const forceSync = request.nextUrl.searchParams.get('refresh') === '1';
    const video = forceSync
      ? await getVideoAssetRecordWithSync(id)
      : await getVideoAssetRecord(id);

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }
    return NextResponse.json({ video });
  } catch (error) {
    console.error('[video] fetch failed', error);
    return NextResponse.json({ error: 'Failed to fetch video' }, { status: 500 });
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
    const video = await getVideoAssetRecord(id);
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const status = await queueAutoEmbeddingsForVideo(video);
    return NextResponse.json({
      success: true,
      embedding: status,
    });
  } catch (error) {
    console.error('[video] embedding queue failed', error);
    return NextResponse.json({ error: 'Failed to queue video embeddings' }, { status: 500 });
  }
}

