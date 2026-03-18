import { describe, expect, it } from 'vitest';
import { inferAssetTypeFromUrl, isImageOnlyImportError } from '@/utils/mediaAssetType';

describe('mediaAssetType utils', () => {
  describe('inferAssetTypeFromUrl', () => {
    it('classifies common video URL extensions as video', () => {
      expect(inferAssetTypeFromUrl('https://cdn.example.com/clip.mp4')).toBe('video');
      expect(inferAssetTypeFromUrl('https://cdn.example.com/clip.webm?token=abc')).toBe('video');
      expect(inferAssetTypeFromUrl('blob:https://example.com/123')).toBe('video');
    });

    it('defaults to image when URL is empty or does not match known video extensions', () => {
      expect(inferAssetTypeFromUrl()).toBe('image');
      expect(inferAssetTypeFromUrl('https://cdn.example.com/photo.jpg')).toBe('image');
      expect(inferAssetTypeFromUrl('https://cdn.example.com/asset')).toBe('image');
    });
  });

  describe('isImageOnlyImportError', () => {
    it('matches known image-only import validation errors', () => {
      expect(isImageOnlyImportError('URL must point to an image')).toBe(true);
      expect(isImageOnlyImportError('URL must point to a supported image')).toBe(true);
      expect(isImageOnlyImportError('A valid image URL is required')).toBe(true);
    });

    it('does not match unrelated errors', () => {
      expect(isImageOnlyImportError('Failed to download image from example.com')).toBe(false);
      expect(isImageOnlyImportError('Network timeout')).toBe(false);
      expect(isImageOnlyImportError(undefined)).toBe(false);
    });
  });
});
