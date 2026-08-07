/** @vitest-environment jsdom */

import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { useImageMetadataDraft } from '@/hooks/useImageMetadataDraft';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const image = {
  id: 'image-1',
  filename: 'original.jpg',
  description: 'Cloudflare description',
  altTag: 'Cloudflare alt',
};

type DraftHook = ReturnType<typeof useImageMetadataDraft<typeof image>>;

function DraftProbe({
  extrasRecord,
  onChange,
}: {
  extrasRecord: { imageId?: string; description?: string; altText?: string } | null;
  onChange: (draft: DraftHook) => void;
}) {
  const draft = useImageMetadataDraft({ image, extrasRecord });

  useEffect(() => {
    onChange(draft);
  }, [draft, onChange]);

  return null;
}

describe('useImageMetadataDraft', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it('rehydrates a pristine draft when extras arrive after the image', async () => {
    let latest: DraftHook | undefined;
    const onChange = (draft: DraftHook) => { latest = draft; };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(DraftProbe, { extrasRecord: null, onChange }));
    });
    await act(async () => {
      latest?.resetFromImage(image, null);
    });
    expect(latest?.descriptionInput).toBe('Cloudflare description');
    expect(latest?.isDirty).toBe(false);

    await act(async () => {
      root?.render(React.createElement(DraftProbe, {
        extrasRecord: { imageId: image.id, description: 'Extras description', altText: 'Extras alt' },
        onChange,
      }));
    });
    await act(async () => {
      latest?.hydratePersistedValues(image, {
        imageId: image.id,
        description: 'Extras description',
        altText: 'Extras alt',
      });
    });

    expect(latest?.descriptionInput).toBe('Extras description');
    expect(latest?.altTextInput).toBe('Extras alt');
    expect(latest?.isDirty).toBe(false);
  });

  it('keeps an operator edit when persisted extras refresh', async () => {
    let latest: DraftHook | undefined;
    const onChange = (draft: DraftHook) => { latest = draft; };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(DraftProbe, { extrasRecord: null, onChange }));
    });
    await act(async () => {
      latest?.resetFromImage(image, null);
    });
    await act(async () => {
      latest?.setDescriptionInput('Operator edit');
    });
    await act(async () => {
      latest?.hydratePersistedValues(image, { imageId: image.id, description: 'Extras description' });
    });

    expect(latest?.descriptionInput).toBe('Operator edit');
    expect(latest?.isDirty).toBe(true);
  });
});
