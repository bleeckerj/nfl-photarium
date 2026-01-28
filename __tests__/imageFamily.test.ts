import { describe, expect, it } from 'vitest';
import { listImageFamilyIds } from '../src/server/imageFamily';

describe('listImageFamilyIds', () => {
  it('returns root + children for a parent', () => {
    const images = [
      { id: 'p' },
      { id: 'c1', parentId: 'p' },
      { id: 'c2', parentId: 'p' },
    ];

    const result = listImageFamilyIds(images, 'p');
    expect(result.rootId).toBe('p');
    expect(result.memberIds).toEqual(['c1', 'c2', 'p']);
  });

  it('resolves family root when deleting a child', () => {
    const images = [
      { id: 'p' },
      { id: 'c1', parentId: 'p' },
      { id: 'c2', parentId: 'p' },
    ];

    const result = listImageFamilyIds(images, 'c1');
    expect(result.rootId).toBe('p');
    expect(result.memberIds).toEqual(['c1', 'c2', 'p']);
  });

  it('includes rootId even if parent record is missing', () => {
    const images = [{ id: 'c1', parentId: 'p' }];

    const result = listImageFamilyIds(images, 'c1');
    expect(result.rootId).toBe('p');
    expect(result.memberIds).toEqual(['c1', 'p']);
  });
});
