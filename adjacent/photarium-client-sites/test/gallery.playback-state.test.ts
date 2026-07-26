import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientAsset } from '../src/client/domain/types';

vi.mock('@client/rendering/video-player', () => ({
  attachResolvedVideoPlayback: vi.fn(),
}));

import { attachResolvedVideoPlayback } from '@client/rendering/video-player';
import { syncGalleryPlaybackState } from '../src/client/rendering/gallery-playback-state';

class FakeClassList {
  private readonly values = new Set<string>();

  reset(value: string): void {
    this.values.clear();
    value
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => this.values.add(entry));
  }

  toggle(value: string, force?: boolean): boolean {
    if (force === true) {
      this.values.add(value);
      return true;
    }
    if (force === false) {
      this.values.delete(value);
      return false;
    }
    if (this.values.has(value)) {
      this.values.delete(value);
      return false;
    }
    this.values.add(value);
    return true;
  }

  contains(value: string): boolean {
    return this.values.has(value);
  }

  toString(): string {
    return Array.from(this.values).join(' ');
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList();
  readonly listeners = new Map<string, Array<() => void>>();
  readonly attributes = new Map<string, string>();
  textContent = '';
  disabled = false;
  hidden = false;
  type = '';
  controls = false;
  playsInline = false;
  preload = '';
  muted = false;
  loop = false;
  paused = true;
  poster = '';
  src = '';
  loading = '';
  alt = '';

  constructor(readonly tagName: string) {}

  set className(value: string) {
    this.classList.reset(value);
  }

  get className(): string {
    return this.classList.toString();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, handler: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  removeEventListener(type: string, handler: () => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== handler)
    );
  }

  emit(type: string): void {
    [...(this.listeners.get(type) ?? [])].forEach((handler) => handler());
  }

  play(): Promise<void> {
    this.paused = false;
    this.emit('play');
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
    this.emit('pause');
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  querySelector<T extends FakeElement>(selector: string): T | null {
    return (this.querySelectorAll<T>(selector)[0] ?? null) as T | null;
  }

  querySelectorAll<T extends FakeElement>(selector: string): T[] {
    const matches: T[] = [];
    this.children.forEach((child) => {
      if (child.matches(selector)) {
        matches.push(child as T);
      }
      matches.push(...child.querySelectorAll<T>(selector));
    });
    return matches;
  }

  private matches(selector: string): boolean {
    if (selector.startsWith('[') && selector.endsWith(']')) {
      const attribute = selector.slice(1, -1);
      return this.attributes.has(attribute);
    }
    return this.tagName === selector;
  }
}

const createVideoAsset = (id: string): ClientAsset => ({
  id,
  assetType: 'video',
  filename: `${id}.mp4`,
  displayName: `Video ${id}`,
  description: '',
  visibleTags: ['motion'],
  fileSizeBytes: null,
  aspectRatio: null,
  dimensions: null,
  isCanonical: true,
  hasEmbedding: false,
  clusterId: null,
  clusterLabel: null,
  previewVariant: null,
  videoPlaybackUrl: null,
  videoHlsUrl: `https://cdn.example.com/${id}/manifest/video.m3u8`,
  videoThumbnailUrl: `https://cdn.example.com/${id}/thumb.jpg`,
  videoPreviewUrl: null,
  videoDownloadUrl: null,
  preferredVideoPlaybackUrl: `https://cdn.example.com/${id}/manifest/video.m3u8`,
  preferredVideoPlaybackKind: 'hls',
  hasDownloadableVideo: false,
  videoDurationSeconds: 4,
  sortOrder: 0,
});

// Mirrors the DOM built by renderGalleryCard: the badge and overlay controls
// live inside the media frame, next to the media slot.
const createVideoCard = (assetId: string): {
  card: FakeElement;
  frame: FakeElement;
  slot: FakeElement;
  badge: FakeElement;
  toggle: FakeElement;
  pauseToggle: FakeElement;
} => {
  const card = new FakeElement('article');
  card.setAttribute('data-gallery-asset-id', assetId);

  const frame = new FakeElement('div');
  frame.setAttribute('data-gallery-media-frame', '');

  const slot = new FakeElement('div');
  slot.setAttribute('data-gallery-media-slot', '');
  slot.setAttribute('data-inline-playing', 'false');
  const imageButton = new FakeElement('button');
  slot.append(imageButton);

  const badge = new FakeElement('span');
  badge.className = 'asset-card__badge';
  badge.textContent = 'Video';

  const overlayControls = new FakeElement('div');
  overlayControls.className = 'asset-card__overlay-controls';

  const pauseToggle = new FakeElement('button');
  pauseToggle.setAttribute('data-gallery-pause-toggle', '');
  pauseToggle.className = 'asset-card__play-toggle';
  pauseToggle.textContent = 'Pause';
  pauseToggle.hidden = true;

  const toggle = new FakeElement('button');
  toggle.setAttribute('data-gallery-play-toggle', '');
  toggle.className = 'asset-card__play-toggle';
  toggle.textContent = 'Play';

  overlayControls.append(pauseToggle, toggle);
  frame.append(slot, badge, overlayControls);
  card.append(frame);
  return { card, frame, slot, badge, toggle, pauseToggle };
};

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('syncGalleryPlaybackState', () => {
  const originalDocument = globalThis.document;

  beforeEach(() => {
    globalThis.document = {
      createElement: (tagName: string) => new FakeElement(tagName),
    } as unknown as Document;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    vi.clearAllMocks();
  });

  it('updates playback in place and cleans up when switching and stopping', async () => {
    const firstAsset = createVideoAsset('video-1');
    const secondAsset = createVideoAsset('video-2');
    const firstCard = createVideoCard(firstAsset.id);
    const secondCard = createVideoCard(secondAsset.id);
    const root = new FakeElement('div');
    root.append(firstCard.card, secondCard.card);

    const cleanupSpies: Array<ReturnType<typeof vi.fn>> = [];
    vi.mocked(attachResolvedVideoPlayback).mockImplementation(async () => {
      const cleanup = vi.fn();
      cleanupSpies.push(cleanup);
      return cleanup;
    });

    syncGalleryPlaybackState(root as unknown as HTMLElement, {
      assets: [firstAsset, secondAsset],
      inlinePlayingAssetId: firstAsset.id,
      onOpenLightbox: vi.fn(),
      onStopInlinePlayback: vi.fn(),
    });
    await flushPromises();

    expect(root.children[0]).toBe(firstCard.card);
    expect(root.children[1]).toBe(secondCard.card);
    expect(firstCard.toggle.textContent).toBe('Stop');
    expect(firstCard.toggle.classList.contains('asset-card__play-toggle--active')).toBe(true);
    expect(firstCard.slot.querySelector('video')).not.toBeNull();
    expect(firstCard.pauseToggle.hidden).toBe(false);
    expect(secondCard.slot.querySelector('video')).toBeNull();
    expect(secondCard.pauseToggle.hidden).toBe(true);

    // The badge and overlay controls survive the media swap.
    expect(firstCard.frame.children).toContain(firstCard.badge);
    expect(firstCard.frame.querySelector('[data-gallery-play-toggle]')).toBe(firstCard.toggle);
    expect(firstCard.frame.querySelector('[data-gallery-pause-toggle]')).toBe(firstCard.pauseToggle);

    syncGalleryPlaybackState(root as unknown as HTMLElement, {
      assets: [firstAsset, secondAsset],
      inlinePlayingAssetId: secondAsset.id,
      onOpenLightbox: vi.fn(),
      onStopInlinePlayback: vi.fn(),
    });
    await flushPromises();

    expect(cleanupSpies[0]).toHaveBeenCalledTimes(1);
    expect(firstCard.toggle.textContent).toBe('Play');
    expect(firstCard.toggle.classList.contains('asset-card__play-toggle--active')).toBe(false);
    expect(firstCard.slot.querySelector('video')).toBeNull();
    expect(firstCard.pauseToggle.hidden).toBe(true);
    expect(secondCard.toggle.textContent).toBe('Stop');
    expect(secondCard.toggle.classList.contains('asset-card__play-toggle--active')).toBe(true);
    expect(secondCard.slot.querySelector('video')).not.toBeNull();
    expect(secondCard.pauseToggle.hidden).toBe(false);

    syncGalleryPlaybackState(root as unknown as HTMLElement, {
      assets: [firstAsset, secondAsset],
      inlinePlayingAssetId: null,
      onOpenLightbox: vi.fn(),
      onStopInlinePlayback: vi.fn(),
    });
    await flushPromises();

    expect(cleanupSpies[1]).toHaveBeenCalledTimes(1);
    expect(secondCard.toggle.textContent).toBe('Play');
    expect(secondCard.toggle.classList.contains('asset-card__play-toggle--active')).toBe(false);
    expect(secondCard.slot.querySelector('video')).toBeNull();
    expect(secondCard.pauseToggle.hidden).toBe(true);
    expect(vi.mocked(attachResolvedVideoPlayback)).toHaveBeenCalledTimes(2);
  });

  it('pause toggle controls the video and tracks play/pause events', async () => {
    const asset = createVideoAsset('video-1');
    const { card, slot, pauseToggle } = createVideoCard(asset.id);
    const root = new FakeElement('div');
    root.append(card);

    vi.mocked(attachResolvedVideoPlayback).mockResolvedValue(vi.fn());

    syncGalleryPlaybackState(root as unknown as HTMLElement, {
      assets: [asset],
      inlinePlayingAssetId: asset.id,
      onOpenLightbox: vi.fn(),
      onStopInlinePlayback: vi.fn(),
    });
    await flushPromises();

    const video = slot.querySelector('video');
    expect(video).not.toBeNull();
    expect(pauseToggle.hidden).toBe(false);
    // Playback attach is mocked, so no play event has fired yet.
    expect(pauseToggle.textContent).toBe('Play');

    pauseToggle.emit('click');
    await flushPromises();
    expect(video?.paused).toBe(false);
    expect(pauseToggle.textContent).toBe('Pause');

    pauseToggle.emit('click');
    expect(video?.paused).toBe(true);
    expect(pauseToggle.textContent).toBe('Play');

    // Pausing/resuming via the native controls updates the label too.
    void video?.play();
    expect(pauseToggle.textContent).toBe('Pause');
    video?.pause();
    expect(pauseToggle.textContent).toBe('Play');

    // Stopping playback hides the pause toggle and unbinds its listeners.
    syncGalleryPlaybackState(root as unknown as HTMLElement, {
      assets: [asset],
      inlinePlayingAssetId: null,
      onOpenLightbox: vi.fn(),
      onStopInlinePlayback: vi.fn(),
    });
    await flushPromises();

    expect(pauseToggle.hidden).toBe(true);
    expect(pauseToggle.listeners.get('click') ?? []).toHaveLength(0);
  });
});
