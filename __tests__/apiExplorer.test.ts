import { describe, expect, it } from 'vitest';
import { listApiEndpoints } from '@/server/apiExplorer';

describe('API Explorer', () => {
  it('discovers API endpoints and includes known routes', async () => {
    const endpoints = await listApiEndpoints();

    expect(endpoints.length).toBeGreaterThan(10);

    const paths = new Set(endpoints.map(e => e.apiPath));
    expect(paths.has('/api/images')).toBe(true);
    expect(paths.has('/api/images/:id/embeddings')).toBe(true);
    expect(paths.has('/api/images/embeddings/batch')).toBe(true);

    const embeddings = endpoints.find(e => e.apiPath === '/api/images/:id/embeddings');
    expect(embeddings?.methods).toContain('POST');
    expect(embeddings?.methods).toContain('GET');
  });
});
