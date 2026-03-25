import { NextRequest, NextResponse } from 'next/server';
import {
  cleanupExpiredImportSessions,
  createImportSession,
} from '@/server/import-metadata/tempAssetStore';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    await cleanupExpiredImportSessions();
    const session = await createImportSession(
      typeof body?.sessionId === 'string' ? body.sessionId : undefined
    );
    return NextResponse.json({
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  } catch (error) {
    console.error('Failed to create import metadata session', error);
    return NextResponse.json({ error: 'Failed to create import metadata session' }, { status: 500 });
  }
}
