import JSZip from 'jszip';
import type { CloudflareImage } from './types';

type SelectedAsset = Pick<CloudflareImage, 'id' | 'filename' | 'assetType'>;

export async function createSelectionArchive(images: SelectedAsset[], fetchImage: typeof fetch = fetch): Promise<Blob> {
  const zip = new JSZip();
  const names = new Set<string>();
  for (const image of images) {
    const response = await fetchImage(`/api/images/${encodeURIComponent(image.id)}/download?variant=original`);
    if (!response.ok) throw new Error(`Could not download ${image.filename || image.id} (HTTP ${response.status}).`);
    const filename = (image.filename || image.id).replace(/[\\/\x00-\x1f]/g, '_').replace(/^\.+$/, '_');
    const dot = filename.lastIndexOf('.');
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : '';
    let name = filename;
    let suffix = 2;
    while (names.has(name.toLowerCase())) name = `${base} (${suffix++})${extension}`;
    names.add(name.toLowerCase());
    zip.file(name, await response.arrayBuffer());
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export function saveSelectionArchive(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'photarium-selected-images.zip';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
