import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ColorSwatches } from '@/components/ColorSwatches';
import { ImageCard } from '@/components/gallery/ImageCard';
import { ImageListItem } from '@/components/gallery/ImageListItem';
import { normalizeColorSearchHex, resolveColorSearchAssets } from '@/components/gallery/colorSearch';

vi.mock('@/utils/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('@/utils/imageUtils')>('@/utils/imageUtils');
  return {
    ...actual,
    getCloudflareImageUrl: vi.fn(() => 'https://example.com/mock-image.jpg'),
    getCloudflareDownloadUrl: vi.fn(() => ({
      url: 'https://example.com/mock-download.jpg',
      mime: 'image/jpeg',
    })),
  };
});

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => React.createElement('img', props),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...props }, children),
}));

describe('ColorSwatches', () => {
  it('renders nothing when no colors are provided', () => {
    const markup = renderToStaticMarkup(React.createElement(ColorSwatches, {}));
    expect(markup).toBe('');
  });

  it('renders an average swatch without a dominant palette', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ColorSwatches, { averageColor: '#abcdef', showLabels: true })
    );

    expect(markup).toContain('avg #abcdef');
    expect(markup).toContain('Average color #abcdef');
  });

  it('renders a dominant palette and caps it at five swatches', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ColorSwatches, {
        dominantColors: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'],
        showLabels: true,
      })
    );

    expect(markup).toContain('palette');
    expect(markup).toContain('#111111');
    expect(markup).toContain('#555555');
    expect(markup).not.toContain('#666666');
  });

  it('de-duplicates repeated dominant colors before rendering', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ColorSwatches, {
        dominantColors: ['#f3f2ee', '  #f3f2ee  ', '#111111'],
      })
    );

    expect(markup.match(/title="#f3f2ee"/g)).toHaveLength(1);
    expect(markup).toContain('#111111');
  });

  it('emits the average color when its swatch is selected', () => {
    const onSelectColor = vi.fn();
    const tree = ColorSwatches({
      averageColor: '#abcdef',
      showLabels: true,
      onSelectColor,
    }) as any;
    const groups = React.Children.toArray(tree.props.children) as any[];
    const averageGroup = groups[0] as any;
    const averageChildren = React.Children.toArray(averageGroup.props.children) as any[];
    const averageButton = averageChildren[0] as any;

    averageButton.props.onClick();

    expect(onSelectColor).toHaveBeenCalledWith('#abcdef');
  });

  it('emits an individual dominant color when its swatch is selected', () => {
    const onSelectColor = vi.fn();
    const tree = ColorSwatches({
      dominantColors: ['#111111', '#222222'],
      onSelectColor,
    }) as any;
    const groups = React.Children.toArray(tree.props.children) as any[];
    const paletteGroup = groups[0] as any;
    const paletteChildren = React.Children.toArray(paletteGroup.props.children) as any[];
    const secondButton = paletteChildren[1] as any;

    secondButton.props.onClick();

    expect(onSelectColor).toHaveBeenCalledWith('#222222');
  });
});

describe('color search helpers', () => {
  it('normalizes uppercase six-digit hex values', () => {
    expect(normalizeColorSearchHex('a1b2c3')).toBe('#A1B2C3');
    expect(normalizeColorSearchHex('#a1b2c3')).toBe('#A1B2C3');
    expect(normalizeColorSearchHex('bad')).toBeNull();
  });

  it('resolves search results against loaded assets and falls back for missing mixed assets', () => {
    const resolved = resolveColorSearchAssets(
      [
        { imageId: 'img-1', assetType: 'image', filename: 'one.jpg' },
        {
          imageId: 'vid-2',
          assetType: 'video',
          filename: 'clip.mp4',
          videoThumbnailUrl: 'https://example.com/thumb.jpg',
          videoPlaybackUrl: 'https://example.com/play.m3u8',
        },
      ],
      [
        {
          id: 'img-1',
          filename: 'existing.jpg',
          uploaded: '2026-01-01T00:00:00.000Z',
          variants: ['https://example.com/image.jpg'],
          folder: 'folder-a',
        },
      ]
    );

    expect(resolved).toHaveLength(2);
    expect(resolved[0].filename).toBe('existing.jpg');
    expect(resolved[1].assetType).toBe('video');
    expect(resolved[1].videoThumbnailUrl).toBe('https://example.com/thumb.jpg');
    expect(resolved[1].videoPlaybackUrl).toBe('https://example.com/play.m3u8');
  });
});

describe('gallery swatch integration', () => {
  const baseImage = {
    id: 'img-1',
    filename: 'example.jpg',
    uploaded: '2026-01-01T00:00:00.000Z',
    variants: ['https://example.com/image.jpg'],
    tags: ['tag-a'],
    folder: 'folder-a',
    namespace: 'ns-a',
  };

  it('renders shared swatches in the grid card from color metadata', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ImageCard, {
        image: baseImage,
        selectedVariant: 'public',
        respectAspectRatio: false,
        isSelected: false,
        bulkSelectionMode: false,
        isDuplicate: false,
        variationChildren: [],
        colorMetadata: {
          averageColor: '#102030',
          dominantColors: ['#111111', '#222222', '#333333'],
        },
        embeddingPending: undefined,
        altLoading: false,
        displayNameLoading: false,
        onToggleSelection: vi.fn(),
        onStartEdit: vi.fn(),
        onDelete: vi.fn(),
        onGenerateAlt: vi.fn(),
        onGenerateDisplayName: vi.fn(),
        onCopyUrl: vi.fn(),
        onCopyNamespace: vi.fn(),
        onBeforeNavigate: vi.fn(),
        onMouseEnter: vi.fn(),
        onMouseMove: vi.fn(),
        onMouseLeave: vi.fn(),
      })
    );

    expect(markup).toContain('avg #102030');
    expect(markup).toContain('#333333');
  });

  it('renders shared swatches in the list item from image-level color data', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ImageListItem, {
        image: {
          ...baseImage,
          averageColor: '#405060',
          dominantColors: ['#aaaaaa', '#bbbbbb'],
        },
        selectedVariant: 'public',
        isSelected: false,
        bulkSelectionMode: false,
        isDuplicate: false,
        hrefSuffix: '',
        variationChildren: [],
        colorMetadata: undefined,
        altLoading: false,
        displayNameLoading: false,
        onToggleSelection: vi.fn(),
        onStartEdit: vi.fn(),
        onDelete: vi.fn(),
        onGenerateAlt: vi.fn(),
        onGenerateDisplayName: vi.fn(),
        onCopyUrl: vi.fn(),
        onCopyNamespace: vi.fn(),
        onBeforeNavigate: vi.fn(),
        onDragStart: vi.fn(),
        onMouseEnter: vi.fn(),
        onMouseMove: vi.fn(),
        onMouseLeave: vi.fn(),
      })
    );

    expect(markup).toContain('avg #405060');
    expect(markup).toContain('#bbbbbb');
  });
});
