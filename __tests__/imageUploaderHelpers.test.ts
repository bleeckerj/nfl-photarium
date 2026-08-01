import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  buildUploaderGallerySummaryUrl,
  extractZipImages,
  inferAssetTypeFromFile,
  isArchiveFile,
  isImageFile,
  isKeynoteFile,
  isZipFile,
  mergeTagInputs,
  resolveTagInput,
} from '@/components/image-uploader/fileHelpers';
import { runWithConcurrency } from '@/components/image-uploader/concurrency';

describe('image uploader helpers', () => {
  it('classifies archive and media files', () => {
    const zip = new File(['zip'], 'deck.zip', { type: 'application/zip' });
    const keynote = new File(['key'], 'presentation.key', { type: '' });
    const image = new File(['img'], 'photo.png', { type: 'image/png' });
    const video = new File(['vid'], 'clip.mp4', { type: 'video/mp4' });

    expect(isZipFile(zip)).toBe(true);
    expect(isKeynoteFile(keynote)).toBe(true);
    expect(isArchiveFile(zip)).toBe(true);
    expect(isArchiveFile(keynote)).toBe(true);
    expect(isImageFile(image)).toBe(true);
    expect(inferAssetTypeFromFile(image)).toBe('image');
    expect(inferAssetTypeFromFile(video)).toBe('video');
  });

  it('merges tag inputs without duplicating tags by case', () => {
    expect(mergeTagInputs('Keynote, Hero', 'hero, Slide')).toBe('Keynote, hero, Slide');
    expect(resolveTagInput('global', undefined)).toBe('global');
    expect(resolveTagInput('global', '')).toBe('');
  });

  it('builds the uploader gallery summary URL for namespace states', () => {
    expect(buildUploaderGallerySummaryUrl('__all__')).toBe('/api/images?page=1&pageSize=1&namespace=__all__');
    expect(buildUploaderGallerySummaryUrl('studio')).toBe('/api/images?page=1&pageSize=1&namespace=studio');
  });

  it('extracts AVIF images from archives with the correct MIME type', async () => {
    const zip = new JSZip();
    zip.file('assets/source.avif', 'avif-bytes');
    zip.file('assets/source.jpg', 'jpeg-bytes');
    zip.file('notes.txt', 'ignore');
    const blob = await zip.generateAsync({ type: 'blob' });

    const extracted = await extractZipImages(new File([blob], 'images.zip', { type: 'application/zip' }));

    expect(extracted.map((entry) => [entry.filename, entry.file.type])).toEqual([
      ['source.avif', 'image/avif'],
      ['source.jpg', 'image/jpeg'],
    ]);
  });
});

describe('runWithConcurrency', () => {
  it('processes every item while respecting the concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const completed: number[] = [];

    await runWithConcurrency([1, 2, 3, 4], 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      completed.push(item);
      active -= 1;
    });

    expect(completed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
