import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdoptVariationSection } from '@/components/image-detail/AdoptVariationSection';
import type { ImageAssignmentCandidateLike } from '@/components/image-detail/AdoptVariationSection';

vi.mock('next/image', () => ({
  default: () => null,
}));

vi.mock('@/utils/assetUrls', () => ({
  getAssetDetailPath: (asset: { id: string }) => `/images/${asset.id}`,
  getAssetPreviewUrl: (asset: { id: string }) => `https://example.test/${asset.id}.jpg`,
  isVideoAsset: (asset: { assetType?: string }) => asset.assetType === 'video',
}));

const makeCandidate = (id: string): ImageAssignmentCandidateLike => ({
  asset: {
    id,
    filename: `${id}.jpg`,
    uploaded: '2026-05-12T00:00:00.000Z',
    assetType: 'image',
    namespace: 'alpha',
    variants: ['https://imagedelivery.net/hash/image/public'],
  },
  availability: 'available',
});

describe('AdoptVariationSection', () => {
  it('renders search pagination controls with page range near the controls', () => {
    const candidates = Array.from({ length: 13 }, (_, index) => makeCandidate(`candidate-${index + 1}`));
    const baseProps = {
        adoptSearch: 'candidate',
        setAdoptSearch: vi.fn(),
        adoptFolderFilter: '',
        setAdoptFolderFilter: vi.fn(),
        adoptFolderOptions: [{ value: '', label: 'All folders' }],
        adoptScope: 'current',
        setAdoptScope: vi.fn(),
        adoptScopeOptions: [
          { value: 'current', label: 'Current namespace: alpha' },
          { value: 'all', label: 'All namespaces' },
        ],
        adoptAssetTypeFilter: '',
        setAdoptAssetTypeFilter: vi.fn(),
        adoptAssetTypeOptions: [{ value: '', label: 'All types' }],
        filteredAssignmentCandidates: candidates,
        pagedAssignmentCandidates: candidates.slice(0, 12),
        adoptPage: 1,
        setAdoptPage: vi.fn(),
        totalAdoptPages: 2,
        adoptPageSize: 12,
        adoptPageStart: 1,
        adoptPageEnd: 12,
        onHandleThumbMouseMove: vi.fn(),
        onHandleThumbLeave: vi.fn(),
        onHandleImageDragStart: vi.fn(),
        onAssignExistingAsChild: vi.fn(),
        onAssignExistingAsChildren: vi.fn(),
        assigningId: null,
        assigningBulk: false,
      };
    const markup = renderToStaticMarkup(
      React.createElement(AdoptVariationSection, baseProps)
    );
    const allScopeMarkup = renderToStaticMarkup(
      React.createElement(AdoptVariationSection, {
        ...baseProps,
        adoptScope: 'all',
      })
    );

    expect(markup).toContain('Page 1 of 2');
    expect(markup).toContain('Showing 1-12 of 13 matches');
    expect(markup).toContain('Current namespace: alpha');
    expect(allScopeMarkup).toContain('All namespaces');
    expect(markup).toContain('alpha');
    expect(markup).toContain('Prev');
    expect(markup).toContain('Next');
  });
});
