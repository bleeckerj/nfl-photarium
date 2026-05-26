import { describe, expect, it } from 'vitest';

import {
  applyImageMetadataSaveResponse,
  buildImageMetadataSavePayload,
  isImageMetadataDraftDirty,
  parseUserTagsInput,
  resolveImageMetadataDraftValuesAfterSave,
  resolveImageMetadataDraftValues,
} from '@/components/image-detail/imageMetadataDraft';

const image = {
  id: 'image-1',
  filename: 'original.jpg',
  folder: 'old-folder',
  tags: ['hero', '_favorite_'],
  description: 'Cloudflare description',
  originalUrl: 'https://example.com/source.jpg',
  sourceUrl: 'https://example.com/page',
  displayName: 'Original name',
  altTag: 'Cloudflare alt',
  exif: { Camera: 'Test' },
};

describe('imageMetadataDraft', () => {
  it('resolves initial draft values from image metadata and extras', () => {
    expect(resolveImageMetadataDraftValues(image, {
      imageId: image.id,
      description: 'Extras description',
      altText: 'Extras alt',
    })).toEqual({
      folderSelect: 'old-folder',
      newFolderInput: '',
      tagsInput: 'hero',
      descriptionInput: 'Extras description',
      altTextInput: 'Extras alt',
      originalUrlInput: 'https://example.com/source.jpg',
      sourceUrlInput: 'https://example.com/page',
      displayNameInput: 'Original name',
    });
  });

  it('keeps system tags out of user tag parsing', () => {
    expect(parseUserTagsInput('hero, _favorite_, detail')).toEqual(['hero', 'detail']);
  });

  it('marks a changed folder as dirty during a background refresh comparison', () => {
    const draft = resolveImageMetadataDraftValues(image, null);
    expect(isImageMetadataDraftDirty({
      ...draft,
      folderSelect: 'new-folder',
    }, image, null)).toBe(true);
  });

  it('builds the save payload from the selected folder and preserves system tags', () => {
    const draft = {
      ...resolveImageMetadataDraftValues(image, null),
      folderSelect: 'new-folder',
      tagsInput: 'detail',
      altTextInput: 'Updated alt',
    };

    expect(buildImageMetadataSavePayload(draft, image)).toEqual({
      folder: 'new-folder',
      tags: ['detail', '_favorite_'],
      description: 'Cloudflare description',
      originalUrl: 'https://example.com/source.jpg',
      sourceUrl: 'https://example.com/page',
      displayName: 'Original name',
      altTag: 'Updated alt',
    });
  });

  it('applies a save response without requiring an immediate refetch', () => {
    const draft = {
      ...resolveImageMetadataDraftValues(image, null),
      folderSelect: 'new-folder',
      descriptionInput: 'Updated description',
    };

    expect(applyImageMetadataSaveResponse(image, {
      folder: 'new-folder',
      tags: ['hero', '_favorite_'],
      originalUrl: 'https://example.com/source.jpg',
      sourceUrl: 'https://example.com/page',
      displayName: 'Original name',
    }, draft)).toEqual({
      ...image,
      folder: 'new-folder',
      tags: ['hero', '_favorite_'],
      description: 'Updated description',
      altTag: 'Cloudflare alt',
      exif: { Camera: 'Test' },
    });
  });

  it('resolves a clean draft baseline after save', () => {
    const draft = {
      ...resolveImageMetadataDraftValues(image, null),
      folderSelect: 'new-folder',
      descriptionInput: 'Updated description',
      altTextInput: 'Updated alt',
    };
    const savedImage = applyImageMetadataSaveResponse(image, {
      folder: 'new-folder',
      tags: ['hero', '_favorite_'],
      originalUrl: 'https://example.com/source.jpg',
      sourceUrl: 'https://example.com/page',
      displayName: 'Original name',
    }, draft);
    const cleanDraft = resolveImageMetadataDraftValuesAfterSave(savedImage, draft);

    expect(cleanDraft).toEqual({
      folderSelect: 'new-folder',
      newFolderInput: '',
      tagsInput: 'hero',
      descriptionInput: 'Updated description',
      altTextInput: 'Updated alt',
      originalUrlInput: 'https://example.com/source.jpg',
      sourceUrlInput: 'https://example.com/page',
      displayNameInput: 'Original name',
    });
    expect(isImageMetadataDraftDirty(cleanDraft, savedImage, {
      description: 'Updated description',
      altText: 'Updated alt',
    })).toBe(false);
  });
});
