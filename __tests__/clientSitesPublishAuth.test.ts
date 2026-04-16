import { describe, expect, it } from 'vitest';
import {
  buildPublishHeaders,
  isLocalPublishTarget,
  resolvePublishSecret,
} from '@/features/client-sites-publishing/publishAuth';

describe('client site publish auth helpers', () => {
  it('treats localhost-style targets as local publish destinations', () => {
    expect(isLocalPublishTarget('http://127.0.0.1:8788')).toBe(true);
    expect(isLocalPublishTarget('http://localhost:8788')).toBe(true);
    expect(isLocalPublishTarget('https://photos.example.com')).toBe(false);
  });

  it('prefers publishSecret over the legacy adminApiToken field', () => {
    expect(
      resolvePublishSecret({
        targetBaseUrl: 'https://photos.example.com',
        publishSecret: 'publish-secret',
        adminApiToken: 'legacy-secret',
        project: { title: 'Review set' },
        selection: { imageIds: ['img-1'] },
      })
    ).toBe('publish-secret');
  });

  it('omits authorization headers when no publish secret is provided', () => {
    expect(buildPublishHeaders(undefined)).toEqual({
      'Content-Type': 'application/json',
    });
  });
});
