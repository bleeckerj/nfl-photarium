import { describe, expect, it } from 'vitest';
import {
  buildAdoptVariationCandidatePage,
  clampAdoptVariationPage,
  filterAdoptVariationCandidates,
  getDefaultAdoptVariationScope,
  type AdoptVariationCandidate,
  type AdoptVariationSearchAsset,
} from '@/components/image-detail/adoptVariationSearch';

type TestAsset = AdoptVariationSearchAsset & {
  filename: string;
};

const makeCandidate = (
  id: string,
  overrides: Partial<TestAsset> = {}
): AdoptVariationCandidate<TestAsset> => ({
  asset: {
    id,
    filename: `${id}.jpg`,
    assetType: 'image',
    ...overrides,
  },
  availability: 'available',
});

describe('adopt variation search pagination', () => {
  it('paginates 25 matching candidates into three 12-item pages', () => {
    const candidates = Array.from({ length: 25 }, (_, index) =>
      makeCandidate(`candidate-${String(index + 1).padStart(2, '0')}`, {
        tags: ['matching-tag'],
      })
    );

    const page = buildAdoptVariationCandidatePage({
      candidates,
      search: 'matching-tag',
      folderFilter: '',
      assetTypeFilter: '',
      page: 1,
      pageSize: 12,
    });

    expect(page.filteredAssignmentCandidates).toHaveLength(25);
    expect(page.totalPages).toBe(3);
    expect(page.pagedAssignmentCandidates).toHaveLength(12);
    expect(page.pageStart).toBe(1);
    expect(page.pageEnd).toBe(12);
  });

  it('returns the expected second page slice', () => {
    const candidates = Array.from({ length: 25 }, (_, index) =>
      makeCandidate(`candidate-${String(index + 1).padStart(2, '0')}`)
    );

    const page = buildAdoptVariationCandidatePage({
      candidates,
      search: '',
      folderFilter: '',
      assetTypeFilter: '',
      page: 2,
      pageSize: 12,
    });

    expect(page.pagedAssignmentCandidates.map((candidate) => candidate.asset.id)).toEqual([
      'candidate-13',
      'candidate-14',
      'candidate-15',
      'candidate-16',
      'candidate-17',
      'candidate-18',
      'candidate-19',
      'candidate-20',
      'candidate-21',
      'candidate-22',
      'candidate-23',
      'candidate-24',
    ]);
    expect(page.pageStart).toBe(13);
    expect(page.pageEnd).toBe(24);
  });

  it('matches searchable candidate fields', () => {
    const candidate = makeCandidate('asset-id-fragment', {
      displayName: 'Display Fragment',
      filename: 'filename-fragment.jpg',
      folder: 'Folder Fragment',
      tags: ['tag-fragment'],
      description: 'Description Fragment',
      altText: 'Alt Text Fragment',
    });

    for (const search of [
      'id-fragment',
      'display fragment',
      'filename-fragment',
      'folder fragment',
      'tag-fragment',
      'description fragment',
      'alt text fragment',
    ]) {
      expect(
        filterAdoptVariationCandidates([candidate], {
          search,
          folderFilter: '',
          assetTypeFilter: '',
        }).map((entry) => entry.asset.id)
      ).toEqual(['asset-id-fragment']);
    }
  });

  it('matches parent fields', () => {
    const candidate: AdoptVariationCandidate<TestAsset> = {
      ...makeCandidate('child'),
      parentAsset: {
        id: 'parent-id-fragment',
        filename: 'parent-filename-fragment.jpg',
        displayName: 'Parent Display Fragment',
      },
    };

    expect(
      filterAdoptVariationCandidates([candidate], {
        search: 'parent display fragment',
        folderFilter: '',
        assetTypeFilter: '',
      }).map((entry) => entry.asset.id)
    ).toEqual(['child']);
  });

  it('filters cross-namespace orphan candidates out of current namespace scope', () => {
    const sameNamespace = makeCandidate('same-namespace', { namespace: 'alpha' });
    const otherNamespace = makeCandidate('other-namespace', { namespace: 'beta' });

    expect(
      filterAdoptVariationCandidates([sameNamespace, otherNamespace], {
        search: '',
        folderFilter: '',
        assetTypeFilter: '',
        scope: 'current',
        currentNamespace: 'alpha',
      }).map((entry) => entry.asset.id)
    ).toEqual(['same-namespace']);
  });

  it('includes cross-namespace orphan candidates in all namespace scope', () => {
    const sameNamespace = makeCandidate('same-namespace', { namespace: 'alpha' });
    const otherNamespace = makeCandidate('other-namespace', { namespace: 'beta' });

    expect(
      filterAdoptVariationCandidates([sameNamespace, otherNamespace], {
        search: '',
        folderFilter: '',
        assetTypeFilter: '',
        scope: 'all',
        currentNamespace: 'alpha',
      }).map((entry) => entry.asset.id)
    ).toEqual(['same-namespace', 'other-namespace']);
  });

  it('defaults blank namespace families to all namespaces', () => {
    expect(getDefaultAdoptVariationScope('alpha')).toBe('current');
    expect(getDefaultAdoptVariationScope('')).toBe('all');
    expect(getDefaultAdoptVariationScope('   ')).toBe('all');
    expect(getDefaultAdoptVariationScope(undefined)).toBe('all');
  });

  it('finds exact cross-namespace IDs only when all namespaces are selected', () => {
    const sameNamespace = makeCandidate('same-namespace', { namespace: 'alpha' });
    const otherNamespace = makeCandidate('844fb2e3-b0a5-4a54-a2f8-5baf59711f00', {
      namespace: 'beta',
      displayName: 'SonyOraculator',
    });

    expect(
      filterAdoptVariationCandidates([sameNamespace, otherNamespace], {
        search: '844fb2e3-b0a5',
        folderFilter: '',
        assetTypeFilter: '',
        scope: 'current',
        currentNamespace: 'alpha',
      }).map((entry) => entry.asset.id)
    ).toEqual([]);

    expect(
      filterAdoptVariationCandidates([sameNamespace, otherNamespace], {
        search: '844fb2e3-b0a5',
        folderFilter: '',
        assetTypeFilter: '',
        scope: 'all',
        currentNamespace: 'alpha',
      }).map((entry) => entry.asset.id)
    ).toEqual(['844fb2e3-b0a5-4a54-a2f8-5baf59711f00']);
  });

  it('clamps pages after namespace scope filtering reduces total pages', () => {
    const candidates = [
      ...Array.from({ length: 13 }, (_, index) =>
        makeCandidate(`same-${String(index + 1).padStart(2, '0')}`, { namespace: 'alpha' })
      ),
      makeCandidate('other-namespace', { namespace: 'beta' }),
    ];

    const page = buildAdoptVariationCandidatePage({
      candidates,
      search: '',
      folderFilter: '',
      assetTypeFilter: '',
      scope: 'current',
      currentNamespace: 'beta',
      page: 3,
      pageSize: 12,
    });

    expect(page.page).toBe(1);
    expect(page.filteredAssignmentCandidates.map((candidate) => candidate.asset.id)).toEqual([
      'other-namespace',
    ]);
  });

  it('orders filtered candidates by newest upload before pagination', () => {
    const candidates = [
      makeCandidate('old-upload', { uploaded: '2026-05-12T19:00:00.000Z' }),
      makeCandidate('new-upload', { uploaded: '2026-05-13T00:25:13.741Z' }),
      makeCandidate('missing-upload'),
    ];

    const page = buildAdoptVariationCandidatePage({
      candidates,
      search: '',
      folderFilter: '',
      assetTypeFilter: '',
      scope: 'all',
      page: 1,
      pageSize: 2,
    });

    expect(page.filteredAssignmentCandidates.map((candidate) => candidate.asset.id)).toEqual([
      'new-upload',
      'old-upload',
      'missing-upload',
    ]);
    expect(page.pagedAssignmentCandidates.map((candidate) => candidate.asset.id)).toEqual([
      'new-upload',
      'old-upload',
    ]);
  });

  it('clamps invalid pages after filtering reduces total pages', () => {
    expect(clampAdoptVariationPage(5, 13, 12)).toBe(2);
    expect(clampAdoptVariationPage(0, 13, 12)).toBe(1);
    expect(clampAdoptVariationPage(5, 0, 12)).toBe(1);
  });
});
