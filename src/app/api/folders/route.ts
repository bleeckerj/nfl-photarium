import { NextRequest, NextResponse } from 'next/server';
import { addFolder, listStoredFolders } from '@/utils/folderStore';
import { buildFolderInventory, listCatalogImagesWithFolderOverrides } from '@/server/folderInventory';
import { requireValidFolderName, FolderPolicyError } from '@/server/folderPolicy';

const resolveNamespaceFilter = (request: NextRequest): string | null => {
  const namespaceParam = request.nextUrl.searchParams.get('namespace');
  const defaultNamespace = process.env.IMAGE_NAMESPACE || process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
  if (namespaceParam === '__all__') return null;
  if (namespaceParam === '__none__') return '';
  if (namespaceParam !== null) return namespaceParam.trim();
  return defaultNamespace;
};

export async function GET(request: NextRequest) {
  try {
    const namespace = resolveNamespaceFilter(request);
    const [cloudflareImages, storedFolders] = await Promise.all([
      listCatalogImagesWithFolderOverrides().catch((err) => {
        console.error('Failed to load catalog images for folder list', err);
        return [];
      }),
      listStoredFolders(namespace)
    ]);

    const filteredImages = namespace === null
      ? cloudflareImages
      : namespace === ''
        ? cloudflareImages.filter((image) => !image.namespace)
        : cloudflareImages.filter((image) => image.namespace === namespace);

    const derivedFolders = Array.from(
      new Set(
        filteredImages
          .map((image) => image.folder)
          .filter((folder): folder is string => Boolean(folder))
      )
    );

    const allFolders = Array.from(
      new Set([
        ...storedFolders,
        ...derivedFolders
      ])
    ).sort((a, b) => a.localeCompare(b));

    const folderStats = await buildFolderInventory(namespace, cloudflareImages);
    return NextResponse.json({ folders: allFolders, folderStats });
  } catch (error) {
    console.error('List folders error', error);
    return NextResponse.json({ error: 'Failed to load folders' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const namespace = resolveNamespaceFilter(request);
    if (namespace === null) {
      return NextResponse.json(
        { error: 'Choose a specific namespace before creating folders' },
        { status: 400 }
      );
    }
    const body = await request.json();
    const name = requireValidFolderName(typeof body?.name === 'string' ? body.name : '');
    await addFolder(name, namespace);
    return NextResponse.json({ success: true, name });
  } catch (error) {
    console.error('Create folder error', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create folder' },
      { status: error instanceof FolderPolicyError ? error.status : 500 }
    );
  }
}
