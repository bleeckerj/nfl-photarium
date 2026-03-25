import { describe, expect, it } from 'vitest';
import { prioritizeMetadataEnrichmentCandidates } from '@/features/page-import/hooks/useCandidateMetadataEnrichment';
import type { UploaderQueueItem } from '@/features/page-import/types';

const makeItem = (overrides: Partial<UploaderQueueItem>): UploaderQueueItem => ({
  id: overrides.id || 'item',
  assetType: 'image',
  filename: overrides.filename || 'image.jpg',
  remoteUrl: overrides.remoteUrl || `https://example.com/${overrides.id || 'item'}.jpg`,
  importSessionId: overrides.importSessionId || 'session-1',
  selected: overrides.selected,
  metadata: overrides.metadata || { status: 'pending' },
  ...overrides,
});

describe('prioritizeMetadataEnrichmentCandidates', () => {
  it('prioritizes visible selected items before the rest', () => {
    const items = [
      makeItem({ id: 'background', selected: false }),
      makeItem({ id: 'selected-hidden', selected: true }),
      makeItem({ id: 'visible-selected', selected: true }),
      makeItem({ id: 'visible-unselected', selected: false }),
      makeItem({ id: 'resolved', metadata: { status: 'resolved', fileSizeBytes: 42 } }),
    ];

    const prioritized = prioritizeMetadataEnrichmentCandidates(items, [
      'visible-selected',
      'visible-unselected',
    ]);

    expect(prioritized.map((item) => item.id)).toEqual([
      'visible-selected',
      'visible-unselected',
      'selected-hidden',
      'background',
    ]);
  });
});
