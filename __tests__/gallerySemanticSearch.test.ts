import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GallerySemanticSearchContent } from '@/components/gallery/GallerySemanticSearch';

vi.mock('next/image', () => ({
  default: () => null,
}));

describe('gallery semantic search', () => {
  it('renders a compact semantic-search row by default', () => {
    const markup = renderToStaticMarkup(
      React.createElement(GallerySemanticSearchContent, {
        mode: 'collapsed',
        onExpand: vi.fn(),
      })
    );

    expect(markup).toContain('Semantic Search');
    expect(markup).toContain('Show');
    expect(markup).not.toContain("Describe what you&#x27;re looking for");
  });

  it('renders the full search UI when expanded', () => {
    const markup = renderToStaticMarkup(
      React.createElement(GallerySemanticSearchContent, {
        mode: 'expanded',
        namespace: 'cf-default',
        onCollapse: vi.fn(),
        onImageClick: vi.fn(),
      })
    );

    expect(markup).toContain('Semantic Search');
    expect(markup).toContain('Hide');
    expect(markup).toContain("Describe what you&#x27;re looking for");
  });

  it('renders the compact disabled row when semantic search is unavailable', () => {
    const markup = renderToStaticMarkup(
      React.createElement(GallerySemanticSearchContent, {
        mode: 'unavailable',
        onShowRedisInfo: vi.fn(),
      })
    );

    expect(markup).toContain('Semantic Search');
    expect(markup).toContain('Disabled');
    expect(markup).not.toContain("Describe what you&#x27;re looking for");
  });
});
