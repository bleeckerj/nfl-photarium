import { describe, expect, it } from 'vitest';
import { buildParentReassignmentState } from '@/hooks/parentReassignmentUtils';
import type { ParentReassignmentImage } from '@/hooks/useParentReassignment';

const makeImage = (overrides: Partial<ParentReassignmentImage> & Pick<ParentReassignmentImage, 'id' | 'filename' | 'uploaded'>): ParentReassignmentImage => ({
  assetType: 'image',
  ...overrides,
});

describe('buildParentReassignmentState', () => {
  it('scopes adoptable candidates to the current canonical namespace', () => {
    const current = makeImage({
      id: 'current',
      filename: 'current.png',
      uploaded: '2026-04-18T23:00:00.000Z',
      namespace: 'alpha',
    });
    const state = buildParentReassignmentState({
      currentImage: current,
      excludeId: current.id,
      allImages: [
        current,
        makeImage({
          id: 'same-ns',
          filename: 'same-ns.png',
          uploaded: '2026-04-18T23:01:00.000Z',
          namespace: 'alpha',
        }),
        makeImage({
          id: 'other-ns',
          filename: 'other-ns.png',
          uploaded: '2026-04-18T23:02:00.000Z',
          namespace: 'beta',
        }),
      ],
    });

    expect(state.adoptableImages.map((asset) => asset.id)).toEqual(['same-ns']);
    expect(state.reassignParentOptions.map((option) => option.value)).toEqual(['', 'same-ns']);
  });

  it('uses the canonical family root namespace when viewing a child variation', () => {
    const current = makeImage({
      id: 'child',
      filename: 'child.png',
      uploaded: '2026-04-18T23:00:00.000Z',
      namespace: 'beta',
      parentId: 'root',
    });
    const root = makeImage({
      id: 'root',
      filename: 'root.png',
      uploaded: '2026-04-18T22:59:00.000Z',
      namespace: 'alpha',
    });
    const state = buildParentReassignmentState({
      currentImage: current,
      excludeId: current.id,
      allImages: [
        current,
        root,
        makeImage({
          id: 'same-root-ns',
          filename: 'same-root-ns.png',
          uploaded: '2026-04-18T23:01:00.000Z',
          namespace: 'alpha',
        }),
        makeImage({
          id: 'child-ns-only',
          filename: 'child-ns-only.png',
          uploaded: '2026-04-18T23:02:00.000Z',
          namespace: 'beta',
        }),
      ],
    });

    expect(state.parentImage?.id).toBe('root');
    expect(state.adoptableImages.map((asset) => asset.id)).toEqual(['same-root-ns']);
    expect(state.reassignParentOptions.map((option) => option.value)).toEqual(['', 'root', 'same-root-ns']);
  });

  it('classifies already-assigned assets as unavailable candidates with parent context', () => {
    const current = makeImage({
      id: 'current',
      filename: 'current.png',
      uploaded: '2026-04-18T23:00:00.000Z',
      namespace: 'alpha',
    });
    const otherParent = makeImage({
      id: 'other-parent',
      filename: 'other-parent.png',
      uploaded: '2026-04-18T23:01:00.000Z',
      namespace: 'alpha',
    });
    const assignedChild = makeImage({
      id: 'assigned-child',
      filename: 'assigned-child.png',
      uploaded: '2026-04-18T23:02:00.000Z',
      namespace: 'alpha',
      parentId: otherParent.id,
    });

    const state = buildParentReassignmentState({
      currentImage: current,
      excludeId: current.id,
      allImages: [current, otherParent, assignedChild],
    });

    expect(state.adoptableImages.map((asset) => asset.id)).toEqual(['other-parent']);
    expect(state.assignmentCandidates).toEqual([
      expect.objectContaining({
        asset: expect.objectContaining({ id: 'other-parent' }),
        availability: 'available',
      }),
      expect.objectContaining({
        asset: expect.objectContaining({ id: 'assigned-child' }),
        availability: 'unavailable',
        unavailableReason: 'already-assigned',
        parentAsset: expect.objectContaining({ id: 'other-parent' }),
      }),
    ]);
  });

  it('excludes current family members from assignment candidates', () => {
    const current = makeImage({
      id: 'current',
      filename: 'current.png',
      uploaded: '2026-04-18T23:00:00.000Z',
      namespace: 'alpha',
    });
    const existingChild = makeImage({
      id: 'existing-child',
      filename: 'existing-child.png',
      uploaded: '2026-04-18T23:01:00.000Z',
      namespace: 'alpha',
      parentId: current.id,
    });
    const available = makeImage({
      id: 'available',
      filename: 'available.png',
      uploaded: '2026-04-18T23:02:00.000Z',
      namespace: 'alpha',
    });

    const state = buildParentReassignmentState({
      currentImage: current,
      excludeId: current.id,
      allImages: [current, existingChild, available],
    });

    expect(state.assignmentCandidates.map((candidate) => candidate.asset.id)).toEqual(['available']);
  });
});
