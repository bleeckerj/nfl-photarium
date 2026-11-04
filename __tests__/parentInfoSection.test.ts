import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VariantLockedState } from '@/components/image-detail/ParentInfoSection';

const props = {
  parentActionLoading: false,
  reassignParentId: 'missing-parent',
  setReassignParentId: () => {},
  reassignParentOptions: [{ value: '', label: 'No parent (make canonical)' }],
  currentParentId: 'missing-parent',
  onDetach: () => {},
  onUpdateParent: () => {},
  getCloudflareImageUrl: (id: string) => `https://example.com/${id}`,
  onThumbMouseMove: () => {},
  onThumbMouseLeave: () => {},
};

describe('variant parent information', () => {
  it('keeps detach and reassignment available when the parent cannot be loaded', () => {
    const markup = renderToStaticMarkup(React.createElement(VariantLockedState, { ...props, parentImage: null }));
    expect(markup).toContain('Parent image is unavailable.');
    expect(markup).toContain('missing-parent');
    expect(markup).toContain('Detach');
    expect(markup).toContain('Update parent');
    expect(markup).toContain('Unavailable parent');
  });

  it('links to an available parent', () => {
    const markup = renderToStaticMarkup(React.createElement(VariantLockedState, {
      ...props,
      parentImage: { id: 'missing-parent', filename: 'parent.jpg' },
    }));
    expect(markup).toContain('/images/missing-parent');
    expect(markup).toContain('parent.jpg');
    expect(markup).toContain('Detach');
  });
});
