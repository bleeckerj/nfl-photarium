import { fetchCloudflareImages, type CloudflareImageRecord } from '@/utils/cloudflareClient';
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

export async function buildFolderInventory(
  namespace: string | null,
  images?: CloudflareImageRecord[]
): Promise<FolderInventoryEntry[]> {
  const [resolvedImages, storedFolders] = await Promise.all([
    images ? Promise.resolve(images) : fetchCloudflareImages(),
    listStoredFolders(namespace),
  ]);
  const scopedImages = resolvedImages.filter((image) => matchesNamespace(image, namespace));
  const names = new Set<string>(storedFolders);
  scopedImages.forEach((image) => {
    if (image.folder) names.add(image.folder);
  });

  return Array.from(names)
    .map((name): FolderInventoryEntry => {
      const members = scopedImages.filter((image) => image.folder === name);
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
