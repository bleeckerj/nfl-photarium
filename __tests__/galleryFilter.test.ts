import { describe, it, expect } from 'vitest';
import { filterImagesForGallery, GalleryImage, isLikelySourceSearchTerm } from '@/utils/galleryFilter';

let uniqueCounter = 0;
const makeImage = (overrides: Partial<GalleryImage> = {}): GalleryImage => ({
  id: overrides.id ?? `image-${uniqueCounter++}`,
  filename: overrides.filename ?? 'sample.png',
  uploaded: overrides.uploaded ?? '2025-01-01T00:00:00.000Z',
  variants: overrides.variants ?? [],
  folder: overrides.folder,
  tags: overrides.tags,
  altTag: overrides.altTag,
  altText: overrides.altText,
  description: overrides.description,
  parentId: overrides.parentId,
  originalUrl: overrides.originalUrl,
  promptThis: overrides.promptThis
});

describe('filterImagesForGallery', () => {
  const images: GalleryImage[] = [
    makeImage({
      id: '1',
      filename: 'client-olalekan-hero.png',
      tags: ['Olalekan', 'client'],
      folder: 'clients'
    }),
    makeImage({
      id: '2',
      filename: 'internal-sketch.png',
      tags: ['sketch'],
      altTag: 'Ola brainstorming session',
      folder: 'internal'
    }),
    makeImage({
      id: '3',
      filename: 'variant-child.png',
      tags: ['children'],
      parentId: 'parent-1',
      folder: 'clients'
    })
  ];

  it('matches partial tag search (case insensitive)', () => {
    const result = filterImagesForGallery(images, {
      selectedFolder: 'all',
      selectedTag: '',
      searchTerm: 'Ola',
      onlyCanonical: false
    });

    const ids = result.map((img) => img.id);
    expect(ids).toContain('1');
    expect(ids).toContain('2'); // alt tag should match as well
  });

  it('respects canonical-only filter even when search matches', () => {
    const result = filterImagesForGallery(images, {
      selectedFolder: 'all',
      selectedTag: '',
      searchTerm: 'child',
      onlyCanonical: true
    });

    const ids = result.map((img) => img.id);
    expect(ids).not.toContain('3');
  });

  it('matches search when original URL contains the text', () => {
    const extendedImages = [
      ...images,
      makeImage({
        id: '4',
        filename: 'dribbble-shot.png',
        originalUrl: 'https://dribbble.com/shots/cool-shot',
        folder: 'internal'
      })
    ];

    const result = filterImagesForGallery(extendedImages, {
      selectedFolder: 'all',
      selectedTag: '',
      searchTerm: 'dribbble',
      onlyCanonical: false
    });

    expect(result.map(img => img.id)).toContain('4');
  });

  it('matches search when Prompt This contains the text', () => {
    const extendedImages = [
      ...images,
      makeImage({
        id: '5',
        filename: 'prompt-image.png',
        promptThis: 'A neon-lit alleyway, rain, cyberpunk vibes',
        folder: 'internal'
      })
    ];

    const result = filterImagesForGallery(extendedImages, {
      selectedFolder: 'all',
      selectedTag: '',
      searchTerm: 'cyberpunk',
      onlyCanonical: false
    });

    expect(result.map((img) => img.id)).toContain('5');
  });

  it('matches search when extras altText contains the text', () => {
    const extendedImages = [
      ...images,
      makeImage({
        id: '6',
        filename: 'extras-alt.png',
        altText: 'A red lighthouse at dawn',
        folder: 'internal',
      })
    ];

    const result = filterImagesForGallery(extendedImages, {
      selectedFolder: 'all',
      selectedTag: '',
      searchTerm: 'lighthouse',
      onlyCanonical: false
    });

    expect(result.map((img) => img.id)).toContain('6');
  });

  it('detects Discord/source-id style search terms', () => {
    expect(isLikelySourceSearchTerm('1476850850478690358')).toBe(true);
    expect(isLikelySourceSearchTerm('https://discord.com/channels/1/2/1476850850478690358')).toBe(true);
    expect(isLikelySourceSearchTerm('retro kiosk')).toBe(false);
  });
});
