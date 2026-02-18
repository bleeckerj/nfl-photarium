import { NextResponse } from 'next/server';
import { listRegistryNamespaces } from '@/server/namespaceRegistry';
import { getCachedImages } from '@/server/cloudflareImageCache';

export async function GET() {
  try {
    const namespaces = await listRegistryNamespaces();
    const cachedImages = await getCachedImages();
    const discovered = new Set<string>();

    cachedImages.forEach(image => {
      if (image.namespace) {
        const trimmed = image.namespace.trim();
        if (trimmed) discovered.add(trimmed);
      }
    });

    const merged = Array.from(new Set([...namespaces, ...discovered])).sort();
    return NextResponse.json({ namespaces: merged });
  } catch (error) {
    console.error('Fetch namespaces error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
