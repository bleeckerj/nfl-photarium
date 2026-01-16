import { NextRequest, NextResponse } from 'next/server';
import { getUploadDownloadInfo } from '@/server/cloudflareUploadsService';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const withCors = (response: NextResponse) => {
  Object.entries(corsHeaders).forEach(([key, value]) => response.headers.set(key, value));
  return response;
};

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return withCors(NextResponse.json({ error: 'Upload ID is required' }, { status: 400 }));
    }

    const { url, filename, contentType, size } = await getUploadDownloadInfo(id);
    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok || !response.body) {
      return withCors(
        NextResponse.json({ error: 'Failed to download asset from Cloudflare' }, { status: 502 })
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
    if (size) {
      headers.set('Content-Length', size.toString());
    }

    return withCors(new NextResponse(response.body, { headers }));
  } catch (error) {
    console.error('Failed to download upload:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return withCors(
      NextResponse.json(
        { error: message },
        { status: message === 'Cloudflare credentials not configured' ? 500 : 502 }
      )
    );
  }
}
