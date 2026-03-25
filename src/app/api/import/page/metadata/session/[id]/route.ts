import { NextRequest, NextResponse } from 'next/server';
import { clearImportSession } from '@/server/import-metadata/tempAssetStore';

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Session id is required' }, { status: 400 });
    }
    await clearImportSession(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to clear import metadata session', error);
    return NextResponse.json({ error: 'Failed to clear import metadata session' }, { status: 500 });
  }
}
