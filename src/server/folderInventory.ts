import { type CloudflareImageRecord } from '@/utils/cloudflareClient';
import { getCachedImages } from '@/server/cloudflareImageCache';
import { getImageFolderOverrides } from '@/server/imageExtras';
import { listStoredFolders } from '@/utils/folderStore';
import { validateFolderName } from './folderPolicy';

export type FolderInventoryEntry = {
  name: string;
  imageCount: number;
  lastUploaded?: string;
  status: 'empty' | 'singleton' | 'healthy' | 'policy-invalid';
  issues: string[];
};

const matchesNamespace = (image: CloudflareImageRecord, namespace: string | null) => {
  if (namespace === null) return true;
  if (namespace === '') return !image.namespace;
  return image.namespace === namespace;
};

// Full catalog from the in-memory cache with extras folder overrides applied —
// the same folder truth the gallery uses. The old fetchCloudflareImages() path
// issued a single un-paginated Cloudflare request that silently saw only the
// API's first page.
export async function listCatalogImagesWithFolderOverrides(): Promise<CloudflareImageRecord[]> {
  const [images, overrides] = await Promise.all([
    getCachedImages(),
    getImageFolderOverrides(),
  ]);
  if (overrides.size === 0) return images;
  return images.map((image) =>
    overrides.has(image.id) ? { ...image, folder: overrides.get(image.id) } : image
  );
}

export async function buildFolderInventory(
  namespace: string | null,
  images?: CloudflareImageRecord[]
): Promise<FolderInventoryEntry[]> {
  const [resolvedImages, storedFolders] = await Promise.all([
    images ? Promise.resolve(images) : listCatalogImagesWithFolderOverrides(),
    listStoredFolders(namespace),
  ]);
  const scopedImages = resolvedImages.filter((image) => matchesNamespace(image, namespace));
  const names = new Set<string>(storedFolders);
  // Single pass grouping instead of one full scan per folder name.
  const membersByFolder = new Map<string, CloudflareImageRecord[]>();
  scopedImages.forEach((image) => {
    if (!image.folder) return;
    names.add(image.folder);
    const members = membersByFolder.get(image.folder);
    if (members) {
      members.push(image);
    } else {
      membersByFolder.set(image.folder, [image]);
    }
  });

  return Array.from(names)
    .map((name): FolderInventoryEntry => {
      const members = membersByFolder.get(name) ?? [];
      const validation = validateFolderName(name);
      const issues = validation.ok ? [] : [validation.error];
      const sortedDates = members
        .map((image) => image.uploaded)
        .filter(Boolean)
        .sort();
      if (members.length === 0) issues.push('Folder has no assigned images');
      if (members.length === 1) issues.push('Folder contains a single image');
      return {
        name,
        imageCount: members.length,
        lastUploaded: sortedDates.at(-1),
        status: !validation.ok
          ? 'policy-invalid'
          : members.length === 0
            ? 'empty'
            : members.length === 1
              ? 'singleton'
              : 'healthy',
        issues,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
