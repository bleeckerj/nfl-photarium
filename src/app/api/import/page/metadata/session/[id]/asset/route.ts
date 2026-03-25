import { NextRequest, NextResponse } from 'next/server';
import { releaseTempAsset } from '@/server/import-metadata/tempAssetStore';

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json().catch(() => ({}));
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Session id is required' }, { status: 400 });
    }
    const assetKey =
      typeof body?.assetKey === 'string' && body.assetKey.trim() ? body.assetKey.trim() : undefined;
    const url = typeof body?.url === 'string' && body.url.trim() ? body.url.trim() : undefined;
    if (!assetKey && !url) {
      return NextResponse.json({ error: 'assetKey or url is required' }, { status: 400 });
    }
    await releaseTempAsset({ sessionId: id, assetKey, url });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to release import temp asset', error);
    return NextResponse.json({ error: 'Failed to release import temp asset' }, { status: 500 });
  }
}
