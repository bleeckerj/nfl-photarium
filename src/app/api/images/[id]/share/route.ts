import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareImageUrl } from '@/utils/imageUtils';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
  }

  const variant = request.nextUrl.searchParams.get('variant') || 'large';
  try {
    const url = getCloudflareImageUrl(id, variant);
    return NextResponse.redirect(url, 307);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to build share URL' }, { status: 500 });
  }
}
