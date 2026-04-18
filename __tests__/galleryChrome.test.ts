import { describe, expect, it } from 'vitest';
import { resolveGalleryChromeScrollState } from '@/components/gallery/galleryChrome';

describe('resolveGalleryChromeScrollState', () => {
  it('collapses controls after a meaningful downward scroll past the gallery top region', () => {
    const result = resolveGalleryChromeScrollState({
      currentScrollY: 220,
      lastScrollY: 180,
      galleryTop: 0,
      manualMode: 'auto',
      controlsVisible: true,
    });

    expect(result).toEqual({
      controlsVisible: false,
      compactMode: true,
      manualMode: 'auto',
    });
  });

  it('reopens controls on deliberate upward scroll in auto mode', () => {
    const result = resolveGalleryChromeScrollState({
      currentScrollY: 180,
      lastScrollY: 230,
      galleryTop: 0,
      manualMode: 'auto',
      controlsVisible: false,
    });

    expect(result).toEqual({
      controlsVisible: true,
      compactMode: false,
      manualMode: 'auto',
    });
  });

  it('keeps controls hidden when the user manually hid them', () => {
    const result = resolveGalleryChromeScrollState({
      currentScrollY: 10,
      lastScrollY: 0,
      galleryTop: 0,
      manualMode: 'hidden',
      controlsVisible: true,
    });

    expect(result).toEqual({
      controlsVisible: false,
      compactMode: true,
      manualMode: 'hidden',
    });
  });

  it('resets shown mode back to auto when returning near the top', () => {
    const result = resolveGalleryChromeScrollState({
      currentScrollY: 20,
      lastScrollY: 120,
      galleryTop: 0,
      manualMode: 'shown',
      controlsVisible: true,
    });

    expect(result).toEqual({
      controlsVisible: true,
      compactMode: false,
      manualMode: 'auto',
    });
  });

  it('keeps controls visible inside the hysteresis band when already visible', () => {
    const result = resolveGalleryChromeScrollState({
      currentScrollY: 110,
      lastScrollY: 108,
      galleryTop: 0,
      manualMode: 'auto',
      controlsVisible: true,
    });

    expect(result).toEqual({
      controlsVisible: true,
      compactMode: false,
      manualMode: 'auto',
    });
  });

  it('keeps controls hidden inside the hysteresis band when already collapsed', () => {
    const result = resolveGalleryChromeScrollState({
      currentScrollY: 130,
      lastScrollY: 132,
      galleryTop: 0,
      manualMode: 'auto',
      controlsVisible: false,
    });

    expect(result).toEqual({
      controlsVisible: false,
      compactMode: true,
      manualMode: 'auto',
    });
  });

  it('stays visible after reopening on an upward scroll instead of snapping shut on the next frame', () => {
    const reopened = resolveGalleryChromeScrollState({
      currentScrollY: 180,
      lastScrollY: 230,
      galleryTop: 0,
      manualMode: 'auto',
      controlsVisible: false,
    });

    expect(reopened).toEqual({
      controlsVisible: true,
      compactMode: false,
      manualMode: 'auto',
    });

    const stableNextFrame = resolveGalleryChromeScrollState({
      currentScrollY: 178,
      lastScrollY: 180,
      galleryTop: 0,
      manualMode: reopened.manualMode,
      controlsVisible: reopened.controlsVisible,
    });

    expect(stableNextFrame).toEqual({
      controlsVisible: true,
      compactMode: false,
      manualMode: 'auto',
    });
  });

  it('reopens automatically when a hidden toolbar enters the upper reopen zone', () => {
    const result = resolveGalleryChromeScrollState({
      currentScrollY: 110,
      lastScrollY: 113,
      galleryTop: 0,
      manualMode: 'auto',
      controlsVisible: false,
    });

    expect(result).toEqual({
      controlsVisible: true,
      compactMode: false,
      manualMode: 'auto',
    });
  });
});
