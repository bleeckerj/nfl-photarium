import { describe, expect, it } from 'vitest';

describe('flickr sidecar helpers', async () => {
  const sidecar = await import('../scripts/fs-ingest/flickr-sidecar.mjs');

  describe('extractFlickrPhotoIdCandidates', () => {
    it('extracts the photo id from title-prefixed filenames', () => {
      expect(sidecar.extractFlickrPhotoIdCandidates('vacation_42342142421_o.jpg')).toEqual(['42342142421']);
    });

    it('extracts the photo id from id-secret-size filenames', () => {
      expect(sidecar.extractFlickrPhotoIdCandidates('42342142421_abcdef1234_o.jpg')).toEqual([
        '42342142421',
        '1234', // not actually 8 digits, won't appear; '1234' length=4 won't match
      ].filter((v) => v.length >= 8));
    });

    it('extracts the photo id when the size code is not original', () => {
      expect(sidecar.extractFlickrPhotoIdCandidates('title_42342142421_b.jpg')).toEqual(['42342142421']);
    });

    it('extracts the photo id from bare id filenames', () => {
      expect(sidecar.extractFlickrPhotoIdCandidates('42342142421_o.jpg')).toEqual(['42342142421']);
      expect(sidecar.extractFlickrPhotoIdCandidates('42342142421.jpg')).toEqual(['42342142421']);
    });

    it('returns multiple candidates when filename has multiple digit runs', () => {
      // e.g. a date in the title plus the actual photo id at the end
      const candidates = sidecar.extractFlickrPhotoIdCandidates('trip_20230515_42342142421_o.jpg');
      expect(candidates).toContain('42342142421');
      expect(candidates).toContain('20230515');
      // photo id is conventionally last
      expect(candidates[candidates.length - 1]).toBe('42342142421');
    });

    it('returns empty for filenames with no digit run of 8+', () => {
      expect(sidecar.extractFlickrPhotoIdCandidates('vacation_2023.jpg')).toEqual([]);
      expect(sidecar.extractFlickrPhotoIdCandidates('IMG_1234.jpg')).toEqual([]);
    });

    it('strips path before extracting', () => {
      expect(sidecar.extractFlickrPhotoIdCandidates('/some/dir/title_42342142421_o.jpg')).toEqual(['42342142421']);
    });
  });

  describe('lookupSidecarForFile', () => {
    it('returns the rightmost candidate that matches the index', () => {
      const index = new Map([['42342142421', '/sidecars/photo_42342142421.json']]);
      const hit = sidecar.lookupSidecarForFile('trip_20230515_42342142421_o.jpg', index);
      expect(hit).toEqual({
        photoId: '42342142421',
        sidecarPath: '/sidecars/photo_42342142421.json',
      });
    });

    it('falls back to an earlier candidate if the rightmost is unknown', () => {
      const index = new Map([['20230515', '/sidecars/photo_20230515.json']]);
      const hit = sidecar.lookupSidecarForFile('trip_20230515_42342142421_o.jpg', index);
      expect(hit?.photoId).toBe('20230515');
    });

    it('returns null when no candidate matches', () => {
      const index = new Map([['99999999999', '/sidecars/photo_99999999999.json']]);
      expect(sidecar.lookupSidecarForFile('title_42342142421_o.jpg', index)).toBeNull();
    });

    it('returns null for filenames with no digit candidates', () => {
      const index = new Map([['42342142421', '/sidecars/photo_42342142421.json']]);
      expect(sidecar.lookupSidecarForFile('vacation.jpg', index)).toBeNull();
    });
  });

  describe('normalizeFlickrPrivacy', () => {
    it('maps the documented vocabulary', () => {
      expect(sidecar.normalizeFlickrPrivacy('public')).toBe('public');
      expect(sidecar.normalizeFlickrPrivacy('private')).toBe('private');
      expect(sidecar.normalizeFlickrPrivacy('friend')).toBe('friends');
      expect(sidecar.normalizeFlickrPrivacy('friends')).toBe('friends');
      expect(sidecar.normalizeFlickrPrivacy('family')).toBe('family');
      expect(sidecar.normalizeFlickrPrivacy('friend & family')).toBe('friends-family');
      expect(sidecar.normalizeFlickrPrivacy('friends and family')).toBe('friends-family');
    });

    it('handles empty / unknown input', () => {
      expect(sidecar.normalizeFlickrPrivacy('')).toBeUndefined();
      expect(sidecar.normalizeFlickrPrivacy(null)).toBeUndefined();
      expect(sidecar.normalizeFlickrPrivacy('something-weird')).toBe('something-weird');
    });
  });

  describe('normalizeSidecar', () => {
    it('normalizes a complete Flickr export sidecar', () => {
      const normalized = sidecar.normalizeSidecar({
        id: '42342142421',
        name: '  Sunset over the bay  ',
        description: 'A long shot at golden hour.',
        date_taken: '2023-07-15 18:32:11',
        date_imported: '2023-07-20 10:15:23',
        photopage: 'https://www.flickr.com/photos/me/42342142421/',
        original: 'https://live.staticflickr.com/4567/42342142421_o.jpg',
        license: 'All Rights Reserved',
        privacy: 'public',
        safety: 'Safe',
        tags: [
          { tag: 'sunset', user: 'me' },
          { tag: 'mountains', user: 'me' },
          { tag: '', user: 'me' },
        ],
        albums: [
          { id: '72157712345678901', title: 'Vacation 2023' },
          { id: '72157700000000000', title: '' },
          null,
        ],
      });

      expect(normalized).toEqual({
        id: '42342142421',
        name: 'Sunset over the bay',
        description: 'A long shot at golden hour.',
        dateTaken: '2023-07-15 18:32:11',
        dateImported: '2023-07-20 10:15:23',
        photopage: 'https://www.flickr.com/photos/me/42342142421/',
        original: 'https://live.staticflickr.com/4567/42342142421_o.jpg',
        license: 'All Rights Reserved',
        privacy: 'public',
        safety: 'Safe',
        tags: ['sunset', 'mountains'],
        albums: [{ id: '72157712345678901', title: 'Vacation 2023' }],
      });
    });

    it('accepts plain-string tags', () => {
      const normalized = sidecar.normalizeSidecar({ id: '1', tags: ['one', '  two  ', ''] });
      expect(normalized?.tags).toEqual(['one', 'two']);
    });

    it('returns null for non-object input', () => {
      expect(sidecar.normalizeSidecar(null)).toBeNull();
      expect(sidecar.normalizeSidecar('not an object')).toBeNull();
    });

    it('drops missing optional fields', () => {
      const normalized = sidecar.normalizeSidecar({ id: '42342142421' });
      expect(normalized?.name).toBeUndefined();
      expect(normalized?.description).toBeUndefined();
      expect(normalized?.tags).toEqual([]);
      expect(normalized?.albums).toEqual([]);
    });
  });

  describe('enrichUploadFromSidecar', () => {
    const fullSidecar = {
      id: '42342142421',
      name: 'Sunset over the bay',
      description: 'Golden hour.',
      photopage: 'https://www.flickr.com/photos/me/42342142421/',
      original: 'https://live.staticflickr.com/4567/42342142421_o.jpg',
      license: 'CC BY-NC 2.0',
      privacy: 'public',
      safety: 'Safe',
      dateTaken: '2023-07-15 18:32:11',
      tags: ['sunset', 'mountains'],
      albums: [
        { id: '1', title: 'Vacation 2023' },
        { id: '2', title: 'Favorites' },
      ],
    };

    it('uses sidecar tags, prepends base, dedupes, adds the flickr tag', () => {
      const result = sidecar.enrichUploadFromSidecar({
        baseTags: ['imported', 'mountains'],
        sidecar: fullSidecar,
      });
      expect(result.tags).toEqual(['imported', 'mountains', 'sunset', 'flickr']);
    });

    it('uses primary album as folder when folderFromAlbum is on', () => {
      const result = sidecar.enrichUploadFromSidecar({
        baseFolder: 'fallback-folder',
        sidecar: fullSidecar,
      });
      expect(result.folder).toBe('Vacation 2023');
    });

    it('falls back to baseFolder when folderFromAlbum is off', () => {
      const result = sidecar.enrichUploadFromSidecar({
        baseFolder: 'fallback-folder',
        sidecar: fullSidecar,
        folderFromAlbum: false,
      });
      expect(result.folder).toBe('fallback-folder');
    });

    it('adds album titles as tags when albumTags is enabled', () => {
      const result = sidecar.enrichUploadFromSidecar({
        baseTags: [],
        sidecar: fullSidecar,
        albumTags: true,
      });
      expect(result.tags).toContain('vacation 2023');
      expect(result.tags).toContain('favorites');
    });

    it('overrides displayName, sourceUrl, originalUrl from sidecar', () => {
      const result = sidecar.enrichUploadFromSidecar({
        baseDisplayName: 'baseName',
        baseSourceUrl: 'local://path',
        baseOriginalUrl: undefined,
        sidecar: fullSidecar,
      });
      expect(result.displayName).toBe('Sunset over the bay');
      expect(result.sourceUrl).toBe('https://www.flickr.com/photos/me/42342142421/');
      expect(result.originalUrl).toBe('https://live.staticflickr.com/4567/42342142421_o.jpg');
    });

    it('joins description prefix with sidecar description', () => {
      const result = sidecar.enrichUploadFromSidecar({
        descriptionPrefix: '[Imported from Flickr]',
        sidecar: fullSidecar,
      });
      expect(result.description).toBe('[Imported from Flickr] | Golden hour.');
    });

    it('keeps base description if sidecar has none and no prefix', () => {
      const noDescSidecar = { ...fullSidecar, description: undefined };
      const result = sidecar.enrichUploadFromSidecar({
        baseDescription: 'fallback desc',
        sidecar: noDescSidecar,
      });
      expect(result.description).toBe('fallback desc');
    });

    it('returns base values when sidecar is null', () => {
      const result = sidecar.enrichUploadFromSidecar({
        baseTags: ['a', 'b'],
        baseFolder: 'F',
        baseDisplayName: 'name',
        sidecar: null,
      });
      expect(result.tags).toEqual(['a', 'b']);
      expect(result.folder).toBe('F');
      expect(result.displayName).toBe('name');
    });

    it('honors the tag limit', () => {
      const lots = Array.from({ length: 30 }, (_, i) => `t${i}`);
      const result = sidecar.enrichUploadFromSidecar({
        baseTags: lots,
        sidecar: fullSidecar,
        tagLimit: 5,
      });
      expect(result.tags).toHaveLength(5);
    });
  });

  describe('buildFlickrSourceRecord', () => {
    it('produces a compact record with all sidecar provenance', () => {
      const record = sidecar.buildFlickrSourceRecord({
        sidecar: {
          id: '42342142421',
          name: 'Title',
          photopage: 'https://www.flickr.com/photos/me/42342142421/',
          original: 'https://live.staticflickr.com/o.jpg',
          privacy: 'public',
          safety: 'Safe',
          license: 'CC BY 2.0',
          dateTaken: '2023-07-15 18:32:11',
          dateImported: '2023-07-20 10:15:23',
          tags: ['sunset', 'mountains'],
          albums: [{ id: '1', title: 'Vacation' }],
        },
        contentHash: 'abc123',
      });
      expect(record).toEqual({
        photoId: '42342142421',
        permalink: 'https://www.flickr.com/photos/me/42342142421/',
        visibility: 'public',
        safety: 'Safe',
        license: 'CC BY 2.0',
        takenAt: '2023-07-15 18:32:11',
        dateImported: '2023-07-20 10:15:23',
        albumTitles: ['Vacation'],
        tagList: ['sunset', 'mountains'],
        selectedSourceUrl: 'https://live.staticflickr.com/o.jpg',
        downloadedContentHash: 'abc123',
        importSource: 'flickr-export',
      });
    });

    it('omits empty arrays and undefined fields', () => {
      const record = sidecar.buildFlickrSourceRecord({
        sidecar: {
          id: '42342142421',
          tags: [],
          albums: [],
        },
      });
      expect(record).toEqual({
        photoId: '42342142421',
        importSource: 'flickr-export',
      });
    });

    it('returns null when sidecar is null', () => {
      expect(sidecar.buildFlickrSourceRecord({ sidecar: null })).toBeNull();
    });
  });
});
