import { NextRequest, NextResponse } from 'next/server';
import {
  listRegistryNamespaceDetails,
  upsertRegistryNamespace,
  type NamespaceRegistryEntry,
} from '@/server/namespaceRegistry';
import { getCachedImages } from '@/server/cloudflareImageCache';
import { listVideoAssetRecords } from '@/server/videoCatalogStorage';
import {
  deleteNamespaceByMovingAssets,
  validateNamespaceDeletionName,
} from '@/server/namespaceDeletion';
import {
  renameNamespace,
  validateNamespaceRenameNames,
} from '@/server/namespaceRename';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

async function loadNamespaces() {
  const namespaceDetails = await listRegistryNamespaceDetails();
  const [cachedImages, videos] = await Promise.all([
    getCachedImages(),
    listVideoAssetRecords(),
  ]);
  const discovered = new Set<string>();
  const detailsByName = new Map<string, NamespaceRegistryEntry>();

  namespaceDetails.forEach((entry) => {
    detailsByName.set(entry.name, entry);
  });

  cachedImages.forEach(image => {
    if (image.namespace) {
      const trimmed = image.namespace.trim();
      if (trimmed) discovered.add(trimmed);
    }
  });
  videos.forEach(video => {
    if (video.namespace) {
      const trimmed = video.namespace.trim();
      if (trimmed) discovered.add(trimmed);
    }
  });

  discovered.forEach((name) => {
    if (!detailsByName.has(name)) {
      detailsByName.set(name, { name, description: '' });
    }
  });

  const details = Array.from(detailsByName.values()).sort((left, right) => left.name.localeCompare(right.name));
  return {
    namespaces: details.map((entry) => entry.name),
    namespaceDetails: details,
  };
}

export async function GET() {
  try {
    const payload = await loadNamespaces();
    return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
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
    const description = typeof body?.description === 'string' ? body.description.trim() : '';

    if (!namespace || namespace === '__all__' || namespace === '__none__') {
      return NextResponse.json(
        { error: 'A non-empty namespace is required.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    await upsertRegistryNamespace(namespace, description);
    const payload = await loadNamespaces();
    return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('Register namespace error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const namespace = typeof body?.namespace === 'string' ? body.namespace.trim() : '';
    const targetNamespace = typeof body?.targetNamespace === 'string' ? body.targetNamespace.trim() : '';
    const dryRun = body?.dryRun === true;
    const validation = validateNamespaceRenameNames(namespace, targetNamespace);

    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const result = await renameNamespace(validation.sourceNamespace, validation.targetNamespace, { dryRun });
    const payload = dryRun || result.partialFailure
      ? { ...result }
      : { ...result, ...(await loadNamespaces()) };

    return NextResponse.json(payload, {
      status: result.partialFailure ? 207 : 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const isConflict = message.includes('already exists');
    if (!isConflict) {
      console.error('Rename namespace error:', error);
    }
    return NextResponse.json(
      { error: message },
      { status: isConflict ? 409 : 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const namespace = typeof body?.namespace === 'string' ? body.namespace.trim() : '';
    const dryRun = body?.dryRun === true;
    const validation = validateNamespaceDeletionName(namespace);

    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const result = await deleteNamespaceByMovingAssets(validation.namespace, { dryRun });
    const payload = dryRun || result.partialFailure
      ? { ...result }
      : { ...result, ...(await loadNamespaces()) };

    return NextResponse.json(payload, {
      status: result.partialFailure ? 207 : 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error('Delete namespace error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
