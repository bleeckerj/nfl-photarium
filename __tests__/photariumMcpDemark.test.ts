import { promises as fs } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerMocks = vi.hoisted(() => ({
  createDemarkTempDirectory: vi.fn(async () => fs.mkdtemp('/tmp/photarium-demark-test-')),
  removeDemarkTempDirectory: vi.fn(async (directory: string) => fs.rm(directory, { recursive: true, force: true })),
  runDemarkWorker: vi.fn(),
}));

const discoveryMocks = vi.hoisted(() => ({
  getImage: vi.fn(),
  downloadOriginalImageById: vi.fn(),
}));

const organizationMocks = vi.hoisted(() => ({
  updateMetadata: vi.fn(),
}));

const uploadMocks = vi.hoisted(() => ({
  uploadFileBase64: vi.fn(),
}));

vi.mock('../mcp-server/src/runtime/demark/worker-runner.js', () => workerMocks);
vi.mock('../mcp-server/src/runtime/discovery/client.js', () => discoveryMocks);
vi.mock('../mcp-server/src/runtime/organization/client.js', () => organizationMocks);
vi.mock('../mcp-server/src/runtime/upload/client.js', () => uploadMocks);

import { buildDemarkedDisplayName, buildDemarkedFilename, mergeDemarkedTags } from '../mcp-server/src/runtime/demark/naming.js';
import { processDemarkImages } from '../mcp-server/src/runtime/demark/service.js';
import { RUNTIME_TOOLS } from '../mcp-server/src/runtime/index.js';

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452',
  'hex',
);

function sourceImage(id: string) {
  return {
    id,
    filename: `${id}.png`,
    displayName: id === 'source-a' ? 'Source A' : 'Source B',
    namespace: 'studio',
    folder: 'references',
    tags: ['reference', 'demarked'],
    originalUrl: 'https://example.com/original.png',
    sourceUrl: 'https://example.com/page',
    altTag: 'Source alt text',
    dimensions: { width: 1, height: 1 },
  };
}

describe('Photarium demarked MCP tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    discoveryMocks.getImage.mockImplementation(async (imageId: string) => {
      if (imageId === 'source-a') return sourceImage(imageId);
      if (imageId === 'source-b') return sourceImage(imageId);
      if (imageId === 'child-a') return {
        ...sourceImage(imageId),
        id: imageId,
        parentId: 'source-a',
        filename: 'source-a-demarked.png',
        displayName: 'Source A — Demarked',
        url: 'https://cdn.example.com/child-a/public',
      };
      if (imageId === 'child-b') return {
        ...sourceImage(imageId),
        id: imageId,
        parentId: 'source-b',
        filename: 'source-b-demarked.png',
        displayName: 'Source B — Demarked',
        url: 'https://cdn.example.com/child-b/public',
      };
      return null;
    });
    discoveryMocks.downloadOriginalImageById.mockImplementation(async (imageId: string) => ({
      base64: TINY_PNG.toString('base64'),
      filename: `${imageId}.png`,
      contentType: 'image/png',
      variantUsed: 'original',
      fallbackUsed: false,
    }));
    workerMocks.runDemarkWorker.mockImplementation(async ({ items, settings }) => {
      expect(settings.modelProfile).toBe('ctrlregen');
      for (const item of items) await fs.writeFile(item.outputPath, TINY_PNG);
      return {
        ok: true,
        version: '0.1.29',
        items: items.map((item: { imageId: string }) => ({
          imageId: item.imageId,
          ok: true,
          width: 1,
          height: 1,
          aiMetadataPresent: false,
        })),
      };
    });
    uploadMocks.uploadFileBase64.mockImplementation(async (_endpoint: string, payload: { filename: string }) => ({
      id: payload.filename.startsWith('source-b') ? 'child-b' : 'child-a',
      url: payload.filename.startsWith('source-b')
        ? 'https://cdn.example.com/child-b/public'
        : 'https://cdn.example.com/child-a/public',
    }));
    organizationMocks.updateMetadata.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the demarked naming convention and preserves an existing demarked tag once', () => {
    expect(buildDemarkedFilename('source-a.png')).toBe('source-a-demarked.png');
    expect(buildDemarkedFilename('source-a-demarked.png')).toBe('source-a-demarked.png');
    expect(buildDemarkedDisplayName('Source A', 'source-a.png')).toBe('Source A — Demarked');
    expect(mergeDemarkedTags(['Reference', 'demarked'])).toEqual(['Reference', 'demarked']);
  });

  it('registers ctrlregen as the default model profile', () => {
    const tool = RUNTIME_TOOLS.find((candidate) => candidate.name === 'photarium_demark_images');
    expect(tool).toBeDefined();
    const schema = tool?.inputSchema as { properties?: Record<string, { default?: unknown }> };
    expect(schema.properties?.modelProfile?.default).toBe('ctrlregen');
  });

  it('processes a batch sequentially and uploads a parent-linked child with preserved metadata', async () => {
    const result = await processDemarkImages(['source-a', 'source-a'], {
      mode: 'demark',
      strength: 0.04,
      steps: 50,
      modelProfile: 'ctrlregen',
      device: 'auto',
      removeAllMetadata: false,
    });

    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
    expect(workerMocks.runDemarkWorker).toHaveBeenCalledTimes(1);
    expect(uploadMocks.uploadFileBase64).toHaveBeenCalledWith('/api/upload', expect.objectContaining({
      filename: 'source-a-demarked.png',
      namespace: 'studio',
      folder: 'references',
      parentId: 'source-a',
      tags: ['reference', 'demarked'],
      originalUrl: 'https://example.com/original.png',
      sourceUrl: 'https://example.com/page',
      generateSemanticTags: false,
    }));
    expect(organizationMocks.updateMetadata).toHaveBeenCalledWith('child-a', expect.objectContaining({
      displayName: 'Source A — Demarked',
      altTag: 'Source alt text',
      parentId: 'source-a',
    }));
    expect(result.results[0]).toMatchObject({
      status: 'succeeded',
      childId: 'child-a',
      parentId: 'source-a',
      verification: {
        aiMetadataPresent: false,
        parentLinked: true,
        dimensionsValid: true,
      },
    });
  });

  it('continues after a source failure and returns a structured failure', async () => {
    const result = await processDemarkImages(['source-a', 'missing'], {
      mode: 'demark',
      strength: 0.04,
      steps: 50,
      modelProfile: 'ctrlregen',
      device: 'auto',
      removeAllMetadata: false,
    });

    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[1]).toMatchObject({
      imageId: 'missing',
      status: 'failed',
      stage: 'source',
    });
    expect(workerMocks.runDemarkWorker).toHaveBeenCalledTimes(1);
  });

  it('does not silently change the requested profile when the worker fails', async () => {
    workerMocks.runDemarkWorker.mockRejectedValueOnce(new Error('CtrlRegen dependencies unavailable'));

    const result = await processDemarkImages(['source-a'], {
      mode: 'demark',
      strength: 0.04,
      steps: 50,
      modelProfile: 'ctrlregen',
      device: 'auto',
      removeAllMetadata: false,
    });

    expect(result.results[0]).toMatchObject({
      status: 'failed',
      stage: 'process',
      error: 'CtrlRegen dependencies unavailable',
    });
    expect(uploadMocks.uploadFileBase64).not.toHaveBeenCalled();
  });

  it('continues after an upload failure and reports partial success', async () => {
    uploadMocks.uploadFileBase64.mockImplementation(async (_endpoint: string, payload: { filename: string }) => {
      if (payload.filename === 'source-b-demarked.png') throw new Error('Upload failed for source-b');
      return { id: 'child-a', url: 'https://cdn.example.com/child-a/public' };
    });

    const result = await processDemarkImages(['source-a', 'source-b'], {
      mode: 'demark',
      strength: 0.04,
      steps: 50,
      modelProfile: 'ctrlregen',
      device: 'auto',
      removeAllMetadata: false,
    });

    expect(result).toMatchObject({ processed: 2, succeeded: 1, failed: 1 });
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ imageId: 'source-a', status: 'succeeded' }),
      expect.objectContaining({ imageId: 'source-b', status: 'failed', stage: 'upload' }),
    ]));
    expect(workerMocks.runDemarkWorker).toHaveBeenCalledTimes(1);
    expect(workerMocks.runDemarkWorker.mock.calls[0]?.[0].items).toHaveLength(2);
  });

  it('passes metadata-only cleanup and explicit full metadata removal to the worker', async () => {
    const result = await processDemarkImages(['source-a'], {
      mode: 'metadata',
      strength: 0.04,
      steps: 50,
      modelProfile: 'ctrlregen',
      device: 'auto',
      removeAllMetadata: true,
    });

    expect(result.succeeded).toBe(1);
    expect(workerMocks.runDemarkWorker.mock.calls[0]?.[0].settings).toEqual({
      mode: 'metadata',
      strength: 0.04,
      steps: 50,
      modelProfile: 'ctrlregen',
      device: 'auto',
      removeAllMetadata: true,
    });
  });
});
