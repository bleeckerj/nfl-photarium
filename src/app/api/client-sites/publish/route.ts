import { NextRequest, NextResponse } from 'next/server';
import { publishClientSiteProject } from '@/features/client-sites-publishing/publisher';
import type { ClientSitePublishRequest } from '@/features/client-sites-publishing/types';

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as ClientSitePublishRequest;
    const result = await publishClientSiteProject(payload);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[client-sites/publish] failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to publish client-site project' },
      { status: 400 }
    );
  }
}
