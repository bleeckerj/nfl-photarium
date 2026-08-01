import { NextRequest, NextResponse } from 'next/server';
import { updateImageFolder } from '@/utils/cloudflareClient';
import { listCatalogImagesWithFolderOverrides } from '@/server/folderInventory';
import { removeFolder, renameFolder } from '@/utils/folderStore';
import { FolderPolicyError, requireValidFolderName } from '@/server/folderPolicy';

const resolveNamespaceFilter = (request: NextRequest): string | null => {
  const namespaceParam = request.nextUrl.searchParams.get('namespace');
  const defaultNamespace = process.env.IMAGE_NAMESPACE || process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
  if (namespaceParam === '__all__') return null;
  if (namespaceParam === '__none__') return '';
  if (namespaceParam !== null) return namespaceParam.trim();
  return defaultNamespace;
};

async function updateAllImages(oldName: string, newName: string | undefined, namespace: string | null) {
  const images = await listCatalogImagesWithFolderOverrides();
  const filtered = namespace === null
    ? images
    : namespace === ''
      ? images.filter((img) => !img.namespace)
      : images.filter((img) => img.namespace === namespace);
  const targets = filtered.filter((img) => img.folder === oldName);
  for (const image of targets) {
    await updateImageFolder(image.id, newName);
  }
  return targets.length;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const namespace = resolveNamespaceFilter(request);
    if (namespace === null) {
      return NextResponse.json(
        { error: 'Choose a specific namespace before renaming folders' },
        { status: 400 }
      );
    }
    const body = await request.json();
    const newName = requireValidFolderName(typeof body?.newName === 'string' ? body.newName : '');
    if (!name) {
      return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
    }
    if (!newName) {
      return NextResponse.json({ error: 'New folder name is required' }, { status: 400 });
    }
    const images = await listCatalogImagesWithFolderOverrides();
    const targets = images.filter((image) =>
      (namespace === null || (namespace === '' ? !image.namespace : image.namespace === namespace)) &&
      image.folder === name
    );
    if (request.nextUrl.searchParams.get('dryRun') === 'true') {
      return NextResponse.json({ dryRun: true, operation: 'rename', from: name, to: newName, imageCount: targets.length });
    }
    await renameFolder(name, newName, namespace);
    await updateAllImages(name, newName, namespace);
    return NextResponse.json({ success: true, name: newName, imageCount: targets.length });
  } catch (error) {
    console.error('Rename folder error', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to rename folder' }, { status: error instanceof FolderPolicyError ? error.status : 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const namespace = resolveNamespaceFilter(request);
    if (namespace === null) {
      return NextResponse.json(
        { error: 'Choose a specific namespace before deleting folders' },
        { status: 400 }
      );
    }
    if (!name) {
      return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
    }
    const images = await listCatalogImagesWithFolderOverrides();
    const targets = images.filter((image) =>
      (namespace === null || (namespace === '' ? !image.namespace : image.namespace === namespace)) &&
      image.folder === name
    );
    if (request.nextUrl.searchParams.get('dryRun') === 'true') {
      return NextResponse.json({ dryRun: true, operation: 'unfile', folder: name, imageCount: targets.length });
    }
    await removeFolder(name, namespace);
    await updateAllImages(name, undefined, namespace);
    return NextResponse.json({ success: true, imageCount: targets.length, assetsDeleted: 0 });
  } catch (error) {
    console.error('Delete folder error', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to delete folder' }, { status: 500 });
  }
}
