import { NextRequest, NextResponse } from 'next/server';
import { buildPublishedProjectManifest } from '@/features/client-sites-publishing/manifestBuilder';
import type { ClientSiteManifestRequest } from '@/features/client-sites-publishing/types';

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as ClientSiteManifestRequest;
    const manifest = await buildPublishedProjectManifest(payload);
    return NextResponse.json({ manifest });
  } catch (error) {
    console.error('[client-sites/manifest] failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build client-site manifest' },
      { status: 400 }
    );
  }
}

