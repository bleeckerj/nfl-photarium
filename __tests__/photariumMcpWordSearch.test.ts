import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));
vi.mock('../mcp-server/src/runtime/shared/api-client.js', () => ({ apiRequest: apiRequestMock }));

import { metadataSearch, textSearch } from '../mcp-server/src/runtime/discovery/client';
import { discoveryTools } from '../mcp-server/src/runtime/discovery/tools';

describe('MCP whole-word search defaults', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue({ results: [], query: 'Turing', count: 0, fields: [], match: 'word' });
  });

  it.each([textSearch, metadataSearch])('requests whole words by default', async (search) => {
    await search('Turing');
    const [endpoint, options] = apiRequestMock.mock.calls[0];
    expect(endpoint).toBe('/api/images/metadata-search');
    expect(JSON.parse(options.body)).toMatchObject({ query: 'Turing', match: 'word' });
  });

  it('preserves an explicitly selected advanced mode', async () => {
    await metadataSearch('Turing', { match: 'contains' });
    expect(JSON.parse(apiRequestMock.mock.calls[0][1].body).match).toBe('contains');
  });

  it('advertises whole-word matching in the tool schema', () => {
    const tool = discoveryTools.find((entry) => entry.name === 'photarium_search_metadata');
    expect(tool?.inputSchema.properties?.match).toMatchObject({
      enum: ['word', 'contains', 'exact', 'prefix', 'regex'],
      description: expect.stringContaining('default: word'),
    });
  });
});
