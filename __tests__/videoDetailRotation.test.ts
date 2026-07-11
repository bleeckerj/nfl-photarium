import { describe, expect, it } from 'vitest';
import { normalizeRotationPreview } from '@/components/video-detail/useVideoRotation';

describe('video detail rotation preview', () => {
  it('normalizes repeated left and right turns', () => {
    expect(normalizeRotationPreview(-90)).toBe(270);
    expect(normalizeRotationPreview(90)).toBe(90);
    expect(normalizeRotationPreview(180)).toBe(180);
    expect(normalizeRotationPreview(360)).toBe(0);
    expect(normalizeRotationPreview(450)).toBe(90);
  });
});
