import { NextRequest, NextResponse } from 'next/server';
import { fetchCloudflareImages, updateImageFolder } from '@/utils/cloudflareClient';
import { removeFolder, renameFolder } from '@/utils/folderStore';
import { cleanString } from '@/utils/cloudflareMetadata';

const resolveNamespaceFilter = (request: NextRequest): string | null => {
  const namespaceParam = request.nextUrl.searchParams.get('namespace');
  const defaultNamespace = process.env.IMAGE_NAMESPACE || process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
  if (namespaceParam === '__all__') return null;
  if (namespaceParam === '__none__') return '';
  if (namespaceParam !== null) return namespaceParam.trim();
  return defaultNamespace;
};

async function updateAllImages(oldName: string, newName: string | undefined, namespace: string | null) {
  const images = await fetchCloudflareImages();
  const filtered = namespace === null
    ? images
    : namespace === ''
      ? images.filter((img) => !img.namespace)
      : images.filter((img) => img.namespace === namespace);
  const targets = filtered.filter((img) => img.folder === oldName);
  for (const image of targets) {
    await updateImageFolder(image.id, newName);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const namespace = resolveNamespaceFilter(request);
    const body = await request.json();
    const newName = cleanString(typeof body?.newName === 'string' ? body.newName : undefined);
    if (!name) {
      return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
    }
    if (!newName) {
      return NextResponse.json({ error: 'New folder name is required' }, { status: 400 });
    }
    await renameFolder(name, newName);
    await updateAllImages(name, newName, namespace);
    return NextResponse.json({ success: true, name: newName });
  } catch (error) {
    console.error('Rename folder error', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to rename folder' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const namespace = resolveNamespaceFilter(request);
    if (!name) {
      return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
    }
    await removeFolder(name);
    await updateAllImages(name, undefined, namespace);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete folder error', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to delete folder' }, { status: 500 });
  }
}
