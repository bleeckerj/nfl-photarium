import { NextRequest, NextResponse } from 'next/server';
import { listRegistryNamespaces, upsertRegistryNamespace } from '@/server/namespaceRegistry';
import { getCachedImages } from '@/server/cloudflareImageCache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

async function loadNamespaces() {
  const namespaces = await listRegistryNamespaces();
  const cachedImages = await getCachedImages();
  const discovered = new Set<string>();

  cachedImages.forEach(image => {
    if (image.namespace) {
      const trimmed = image.namespace.trim();
      if (trimmed) discovered.add(trimmed);
    }
  });

  return Array.from(new Set([...namespaces, ...discovered])).sort();
}

export async function GET() {
  try {
    const namespaces = await loadNamespaces();
    return NextResponse.json({ namespaces }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('Fetch namespaces error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const namespace = typeof body?.namespace === 'string' ? body.namespace.trim() : '';

    if (!namespace || namespace === '__all__' || namespace === '__none__') {
      return NextResponse.json(
        { error: 'A non-empty namespace is required.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    await upsertRegistryNamespace(namespace);
    const namespaces = await loadNamespaces();
    return NextResponse.json({ namespaces }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('Register namespace error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
