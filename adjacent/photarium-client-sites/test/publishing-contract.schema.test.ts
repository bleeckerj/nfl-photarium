import { describe, expect, it } from 'vitest';
import { publishedProjectManifestSchema } from '../src/worker/publishing-contract/schema';

describe('publishedProjectManifestSchema', () => {
  it('accepts a valid manifest payload', () => {
    const result = publishedProjectManifestSchema.parse({
      schemaVersion: '2026-04-01',
      project: {
        id: 'project-1',
        publicSlug: 'opaque-public-slug',
        status: 'published',
        expiresAt: null,
        title: 'Client Review',
        accessPolicy: {
          mode: 'secret-link',
          sessionTtlSeconds: 3600,
        },
        visibleTagPolicy: {
          mode: 'prefix-filter',
          hiddenPrefixes: ['x-'],
          hiddenExact: ['internal'],
        },
        downloadPresetPolicy: {
          viewPresets: [{ name: 'grid', label: 'Grid', sourceVariant: 'public' }],
          downloadPresets: [{ name: 'web', label: 'Web', width: 1600 }],
          allowedOutputFormats: ['jpg', 'webp'],
        },
      },
      delivery: {
        viewPresets: [{ name: 'grid', label: 'Grid', sourceVariant: 'public' }],
        downloadPresets: [{ name: 'web', label: 'Web', width: 1600 }],
        allowedOutputFormats: ['jpg', 'webp'],
      },
      revision: {
        projectRevisionId: 'revision-1',
        generatedAt: '2026-04-01T12:00:00.000Z',
        sourceNamespaces: ['primary'],
      },
      assets: [
        {
          projectAssetId: 'asset-1',
          sourceImageId: 'source-1',
          filename: 'hero.jpg',
          sourceTags: ['portrait'],
          uploadedAt: '2026-04-01T12:00:00.000Z',
          isCanonical: true,
          hasEmbedding: true,
        },
      ],
    });

    expect(result.project.title).toBe('Client Review');
  });
});
