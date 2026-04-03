import type { AppState } from '@client/domain/types';

interface LightboxKeyboardOptions {
  getState: () => AppState;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
};

export const bindLightboxKeyboardNavigation = (
  options: LightboxKeyboardOptions
): (() => void) => {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (!options.getState().lightboxAssetId) return;
    if (isEditableTarget(event.target)) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      options.onClose();
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      options.onPrevious();
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      options.onNext();
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
};
