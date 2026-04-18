export type GalleryChromeManualMode = 'auto' | 'shown' | 'hidden';

export interface GalleryChromeState {
  controlsVisible: boolean;
  compactMode: boolean;
  manualMode: GalleryChromeManualMode;
}

export interface GalleryChromeScrollInput {
  currentScrollY: number;
  lastScrollY: number;
  galleryTop: number;
  manualMode: GalleryChromeManualMode;
  controlsVisible: boolean;
}

const AUTO_COLLAPSE_OFFSET = 140;
const AUTO_TOP_LOCK_OFFSET = 120;
const AUTO_REOPEN_SCROLL_OFFSET = 196;
const TOP_RESET_OFFSET = 24;
const DIRECTION_DELTA = 18;

export function resolveGalleryChromeScrollState({
  currentScrollY,
  lastScrollY,
  galleryTop,
  manualMode,
  controlsVisible,
}: GalleryChromeScrollInput): GalleryChromeState {
  const nearGalleryTop = currentScrollY <= galleryTop + TOP_RESET_OFFSET;
  const topLockThreshold = galleryTop + AUTO_TOP_LOCK_OFFSET;
  const collapseThreshold = galleryTop + AUTO_COLLAPSE_OFFSET;
  const scrollingDown = currentScrollY - lastScrollY >= DIRECTION_DELTA;
  const scrollingUp = lastScrollY - currentScrollY >= DIRECTION_DELTA;

  if (manualMode === 'hidden') {
    return {
      controlsVisible: false,
      compactMode: true,
      manualMode,
    };
  }

  if (nearGalleryTop) {
    return {
      controlsVisible: true,
      compactMode: false,
      manualMode: manualMode === 'shown' ? 'auto' : manualMode,
    };
  }

  if (manualMode === 'shown') {
    return {
      controlsVisible: true,
      compactMode: false,
      manualMode,
    };
  }

  if (controlsVisible) {
    if (scrollingDown && currentScrollY > collapseThreshold) {
      return {
        controlsVisible: false,
        compactMode: true,
        manualMode,
      };
    }

    return {
      controlsVisible: true,
      compactMode: false,
      manualMode,
    };
  }

  if (currentScrollY <= topLockThreshold) {
    return {
      controlsVisible: true,
      compactMode: false,
      manualMode,
    };
  }

  if (scrollingUp && currentScrollY <= galleryTop + AUTO_REOPEN_SCROLL_OFFSET) {
    return {
      controlsVisible: true,
      compactMode: false,
      manualMode,
    };
  }

  return {
    controlsVisible: false,
    compactMode: true,
    manualMode,
  };
}
