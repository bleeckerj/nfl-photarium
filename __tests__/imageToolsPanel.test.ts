import { describe, expect, it } from 'vitest';

import { ImageToolsPanel } from '@/components/image-detail/image-tools/ImageToolsPanel';

describe('ImageToolsPanel', () => {
  it('exports the image tools catalog component', () => {
    expect(typeof ImageToolsPanel).toBe('function');
  });
});
