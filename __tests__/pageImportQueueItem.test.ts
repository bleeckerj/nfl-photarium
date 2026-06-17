import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PageImportQueueItem } from '@/features/page-import/components/PageImportQueueItem';
import type { UploaderQueueItem } from '@/features/page-import/types';

const renderQueueItem = (item: UploaderQueueItem) =>
  renderToStaticMarkup(
    React.createElement(PageImportQueueItem, {
      item,
      isUploading: false,
      previewFailed: false,
      reducing: false,
      metadataExpanded: false,
      selectedFolder: '',
      newFolder: '',
      tags: '',
      description: '',
      originalUrl: '',
      sourceUrl: '',
      updateQueuedFile: vi.fn(),
      resolveTagInput: (_globalTags: string, itemTags?: string) => itemTags || '',
      buildMetadataEstimate: vi.fn(() => 0),
      onPreviewLoadError: vi.fn(),
      onReduceSize: vi.fn(),
      onRemove: vi.fn(),
      onToggleMetadata: vi.fn(),
    })
  );

describe('PageImportQueueItem', () => {
  it('uses a dimension-specific small-asset badge for dimension review items', () => {
    const markup = renderQueueItem({
      id: 'queue-1',
      assetType: 'image',
      filename: 'icon.png',
      remoteUrl: 'https://example.com/icon.png',
      selected: false,
      metadata: {
        status: 'resolved',
        fileSizeBytes: 130000,
        dimensions: { width: 32, height: 32 },
      },
      smallAssetReview: {
        thresholdBytes: 50000,
        reason: 'dimensions',
      },
    });

    expect(markup).toContain('Below 50 px dimension threshold');
    expect(markup).not.toContain('Below 0.05 MB threshold');
  });
});
