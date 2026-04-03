import { describe, expect, it } from 'vitest';
import { isOutputFormatAllowed, resolveDownloadPreset, resolveViewPreset } from '../src/worker/delivery/policy';

const policy = {
  viewPresets: [{ name: 'grid', label: 'Grid', sourceVariant: 'public' }],
  downloadPresets: [{ name: 'web', label: 'Web', width: 1600 }],
  allowedOutputFormats: ['jpg', 'webp'] as const,
};

describe('delivery policy helpers', () => {
  it('resolves named presets', () => {
    expect(resolveViewPreset(policy, 'grid')?.label).toBe('Grid');
    expect(resolveDownloadPreset(policy, 'web')?.label).toBe('Web');
  });

  it('checks output format allow-lists', () => {
    expect(isOutputFormatAllowed(policy, 'jpg')).toBe(true);
    expect(isOutputFormatAllowed(policy, 'png')).toBe(false);
  });
});
