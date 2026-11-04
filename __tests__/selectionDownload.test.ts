import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createSelectionArchive } from '@/components/gallery/selectionDownload';

describe('selection downloads', () => {
  it('archives original bytes with unique, safe filenames', async () => {
    const fetchImage = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    const archive = await createSelectionArchive([
      { id: 'one', filename: 'folder/photo.png' },
      { id: 'two', filename: 'folder/photo.png' },
    ], fetchImage as typeof fetch);
    expect(fetchImage).toHaveBeenCalledWith('/api/images/one/download?variant=original');
    expect(fetchImage).toHaveBeenCalledWith('/api/images/two/download?variant=original');
    const zip = await JSZip.loadAsync(await archive.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual(['folder_photo.png', 'folder_photo (2).png']);
    expect(await zip.file('folder_photo.png')?.async('uint8array')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('fails instead of returning a partial archive when an original is unavailable', async () => {
    const fetchImage = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(createSelectionArchive([{ id: 'missing', filename: 'lost.jpg' }], fetchImage as typeof fetch))
      .rejects.toThrow('Could not download lost.jpg (HTTP 404).');
  });
});
