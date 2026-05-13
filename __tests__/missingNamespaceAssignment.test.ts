import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  applyAssignmentPlan,
  assertValidAssignmentPlan,
  buildFamilyAwareAssignmentPlan,
  buildAssignmentPlan,
  buildMissingNamespaceReport,
  formatAssignmentLogEntry,
  findMissingNamespaceImages,
  isMissingNamespace,
  parseMetadata,
  prepareNamespaceMetadataUpdate,
  selectAssignmentCandidates,
  upsertNamespaceRegistryFile,
} from '../scripts/lib/missingNamespaceAssignment.mjs';

const image = ({
  filename,
  id,
  meta,
  uploaded,
}: {
  filename?: string;
  id: string;
  meta?: unknown;
  uploaded: string;
}) => ({
  id,
  filename,
  meta,
  uploaded,
});

describe('missing namespace assignment helpers', () => {
  it('formats assignment logs with namespace movement, reason, and evidence', () => {
    const line = formatAssignmentLogEntry({
      entry: {
        id: 'image-1',
        filename: 'asset.png',
        uploaded: '2026-05-13T00:00:00.000Z',
        action: 'repair-to-family-namespace',
        reason: 'missing namespace repaired from single family namespace',
        familyRootId: 'parent-1',
        metadataSummary: { keys: ['updatedAt', 'variationParentId'] },
        familyNamespaceEvidence: [
          { id: 'parent-1', assetType: 'image', namespace: 'cf-artifacts' },
        ],
      },
      status: 'verified',
      currentNamespace: '',
      targetNamespace: 'cf-artifacts',
    });

    expect(line).toContain('VERIFIED');
    expect(line).toContain('namespace:');
    expect(line).toContain('[missing]');
    expect(line).toContain('cf-artifacts');
    expect(line).toContain('family root: parent-1');
    expect(line).toContain('why: missing namespace repaired from single family namespace');
    expect(line).toContain('evidence: cf-artifacts from image:parent-1');
  });

  it('builds a read-only missing namespace report for images and videos', () => {
    const report = buildMissingNamespaceReport({
      images: [
        image({ id: 'image-missing', uploaded: '2026-05-02T00:00:00.000Z', meta: {} }),
        image({ id: 'image-present', uploaded: '2026-05-01T00:00:00.000Z', meta: { namespace: 'cf-default' } }),
      ],
      videos: [
        {
          id: 'video-missing',
          assetType: 'video',
          filename: 'clip.mp4',
          uploaded: '2026-05-03T00:00:00.000Z',
          parentId: 'image-present',
        },
      ],
    });

    expect(report.missingImages.map((asset) => asset.id)).toEqual(['image-missing']);
    expect(report.missingVideos.map((asset) => asset.id)).toEqual(['video-missing']);
    expect(report.presentAssets.map((asset) => asset.id)).toEqual(['image-present']);
  });

  it('can inspect exact IDs and report present namespace or not-found status', () => {
    const report = buildMissingNamespaceReport({
      ids: ['image-present', 'missing-id'],
      images: [
        image({ id: 'image-present', uploaded: '2026-05-01T00:00:00.000Z', meta: { namespace: 'cf-default' } }),
        image({ id: 'image-missing', uploaded: '2026-05-02T00:00:00.000Z', meta: {} }),
      ],
    });

    expect(report.missingImages).toEqual([]);
    expect(report.presentAssets.map((asset) => [asset.id, asset.namespace])).toEqual([
      ['image-present', 'cf-default'],
    ]);
    expect(report.notFoundIds).toEqual(['missing-id']);
  });

  it('selects every missing-namespace image with --all semantics', () => {
    const missing = findMissingNamespaceImages([
      image({ id: 'has-namespace', uploaded: '2026-05-01T00:00:00.000Z', meta: { namespace: 'cf-artifacts' } }),
      image({ id: 'empty-namespace', uploaded: '2026-05-02T00:00:00.000Z', meta: { namespace: '' } }),
      image({ id: 'no-namespace', uploaded: '2026-05-03T00:00:00.000Z', meta: { displayName: 'Orphan' } }),
      image({ id: 'whitespace-namespace', uploaded: '2026-05-04T00:00:00.000Z', meta: { namespace: '   ' } }),
      image({ id: 'malformed-json', uploaded: '2026-05-05T00:00:00.000Z', meta: '{not json' }),
    ]);

    const { selected } = selectAssignmentCandidates({ all: true, missing });

    expect(selected.map(({ image }) => image.id)).toEqual([
      'malformed-json',
      'whitespace-namespace',
      'no-namespace',
      'empty-namespace',
    ]);
  });

  it('treats empty, missing, malformed, and whitespace namespace values as missing', () => {
    expect(isMissingNamespace(parseMetadata({ namespace: '' }))).toBe(true);
    expect(isMissingNamespace(parseMetadata({}))).toBe(true);
    expect(isMissingNamespace(parseMetadata('{bad json'))).toBe(true);
    expect(isMissingNamespace(parseMetadata({ namespace: '   ' }))).toBe(true);
    expect(isMissingNamespace(parseMetadata({ namespace: 'cf-default' }))).toBe(false);
  });

  it('keeps selected images sorted by uploaded date descending for review', () => {
    const missing = findMissingNamespaceImages([
      image({ id: 'old', uploaded: '2026-05-01T00:00:00.000Z', meta: {} }),
      image({ id: 'new', uploaded: '2026-05-03T00:00:00.000Z', meta: {} }),
      image({ id: 'middle', uploaded: '2026-05-02T00:00:00.000Z', meta: {} }),
    ]);

    expect(missing.map(({ image }) => image.id)).toEqual(['new', 'middle', 'old']);
  });

  it('detects assignment plan tampering for namespace and selected IDs', () => {
    const selected = findMissingNamespaceImages([
      image({ id: 'orphan-1', uploaded: '2026-05-01T00:00:00.000Z', meta: {} }),
    ]);
    const plan = buildAssignmentPlan({
      generatedAt: '2026-05-13T00:00:00.000Z',
      missingCount: 1,
      scanned: 1,
      selected,
      targetNamespace: 'cf-orphan',
    });

    expect(() => assertValidAssignmentPlan(plan)).not.toThrow();
    expect(() => assertValidAssignmentPlan({ ...plan, targetNamespace: 'cf-artifacts' })).toThrow(/checksum/i);
    expect(() =>
      assertValidAssignmentPlan({
        ...plan,
        entries: [{ ...plan.entries[0], id: 'orphan-2' }],
      })
    ).toThrow(/checksum/i);
  });

  it('applies a plan by patching only planned IDs and preserving existing metadata', async () => {
    const selected = findMissingNamespaceImages([
      image({
        id: 'orphan-1',
        filename: 'one.jpg',
        uploaded: '2026-05-01T00:00:00.000Z',
        meta: { displayName: 'One', tags: ['triage'] },
      }),
      image({
        id: 'orphan-2',
        filename: 'two.jpg',
        uploaded: '2026-05-02T00:00:00.000Z',
        meta: { folder: 'uploads' },
      }),
    ]);
    const plan = buildAssignmentPlan({
      generatedAt: '2026-05-13T00:00:00.000Z',
      missingCount: 2,
      scanned: 2,
      selected,
      targetNamespace: 'cf-orphan',
    });
    const liveMetadataById = new Map<string, unknown>([
      ['orphan-1', { displayName: 'One', tags: ['triage'] }],
      ['orphan-2', { folder: 'uploads' }],
    ]);
    const fetchImageById = vi.fn(async (id: string) =>
      image({
        id,
        filename: `${id}.jpg`,
        uploaded: '2026-05-01T00:00:00.000Z',
        meta: liveMetadataById.get(id),
      })
    );
    const patchMetadata = vi.fn(async (id: string, metadata: unknown) => {
      liveMetadataById.set(id, metadata);
    });

    const result = await applyAssignmentPlan({
      fetchImageById,
      logger: { log: vi.fn(), warn: vi.fn() },
      patchMetadata,
      plan,
    });

    expect(result).toMatchObject({ updated: 2, alreadyTarget: 0, skipped: 0, failed: 0 });
    expect(fetchImageById).toHaveBeenCalledTimes(4);
    expect(patchMetadata).toHaveBeenCalledTimes(2);
    expect(patchMetadata).toHaveBeenCalledWith(
      'orphan-2',
      expect.objectContaining({ folder: 'uploads', namespace: 'cf-orphan' })
    );
    expect(patchMetadata).toHaveBeenCalledWith(
      'orphan-1',
      expect.objectContaining({ displayName: 'One', namespace: 'cf-orphan', tags: ['triage'] })
    );
  });

  it('skips planned images that gained a namespace after plan generation', async () => {
    const selected = findMissingNamespaceImages([
      image({ id: 'orphan-1', uploaded: '2026-05-01T00:00:00.000Z', meta: {} }),
    ]);
    const plan = buildAssignmentPlan({
      generatedAt: '2026-05-13T00:00:00.000Z',
      missingCount: 1,
      scanned: 1,
      selected,
      targetNamespace: 'cf-orphan',
    });
    const fetchImageById = vi.fn(async () =>
      image({ id: 'orphan-1', uploaded: '2026-05-01T00:00:00.000Z', meta: { namespace: 'cf-artifacts' } })
    );
    const patchMetadata = vi.fn(async () => undefined);

    const result = await applyAssignmentPlan({
      fetchImageById,
      logger: { log: vi.fn(), warn: vi.fn() },
      patchMetadata,
      plan,
    });

    expect(result).toMatchObject({ updated: 0, skipped: 1, failed: 0 });
    expect(patchMetadata).not.toHaveBeenCalled();
  });

  it('counts already-target images separately from updates', async () => {
    const selected = findMissingNamespaceImages([
      image({ id: 'orphan-1', uploaded: '2026-05-01T00:00:00.000Z', meta: {} }),
    ]);
    const plan = buildAssignmentPlan({
      generatedAt: '2026-05-13T00:00:00.000Z',
      missingCount: 1,
      scanned: 1,
      selected,
      targetNamespace: 'cf-orphan',
    });
    const fetchImageById = vi.fn(async () =>
      image({ id: 'orphan-1', uploaded: '2026-05-01T00:00:00.000Z', meta: { namespace: 'cf-orphan' } })
    );
    const patchMetadata = vi.fn(async () => undefined);

    const result = await applyAssignmentPlan({
      fetchImageById,
      logger: { log: vi.fn(), warn: vi.fn() },
      patchMetadata,
      plan,
    });

    expect(result).toMatchObject({ updated: 0, alreadyTarget: 1, skipped: 0, failed: 0 });
    expect(patchMetadata).not.toHaveBeenCalled();
  });

  it('fails when post-patch verification does not show the target namespace', async () => {
    const selected = findMissingNamespaceImages([
      image({ id: 'orphan-1', uploaded: '2026-05-01T00:00:00.000Z', meta: {} }),
    ]);
    const plan = buildAssignmentPlan({
      generatedAt: '2026-05-13T00:00:00.000Z',
      missingCount: 1,
      scanned: 1,
      selected,
      targetNamespace: 'cf-orphan',
    });
    const fetchImageById = vi
      .fn()
      .mockResolvedValueOnce(image({ id: 'orphan-1', uploaded: '2026-05-01T00:00:00.000Z', meta: {} }))
      .mockResolvedValueOnce(image({ id: 'orphan-1', uploaded: '2026-05-01T00:00:00.000Z', meta: {} }));
    const patchMetadata = vi.fn(async () => undefined);

    const result = await applyAssignmentPlan({
      fetchImageById,
      logger: { log: vi.fn(), warn: vi.fn() },
      patchMetadata,
      plan,
    });

    expect(result).toMatchObject({ updated: 0, alreadyTarget: 0, skipped: 0, failed: 1 });
    expect(result.details[0]).toMatchObject({
      id: 'orphan-1',
      status: 'failed',
      reason: 'post-patch verification found namespace=[missing]',
    });
  });

  it('allows apply to repair cf-orphan to a planned family namespace', async () => {
    const plan = buildFamilyAwareAssignmentPlan({
      fallbackNamespace: 'cf-orphan',
      scanned: 2,
      images: [
        image({ id: 'parent', uploaded: '2026-05-01T00:00:00.000Z', meta: { namespace: 'cf-artifacts' } }),
        image({ id: 'child', uploaded: '2026-05-02T00:00:00.000Z', meta: { namespace: 'cf-orphan', variationParentId: 'parent' } }),
      ],
    });
    let liveMetadata: unknown = { namespace: 'cf-orphan', variationParentId: 'parent' };
    const fetchImageById = vi.fn(async () =>
      image({ id: 'child', uploaded: '2026-05-02T00:00:00.000Z', meta: liveMetadata })
    );
    const patchMetadata = vi.fn(async (_id: string, metadata: unknown) => {
      liveMetadata = metadata;
    });

    const result = await applyAssignmentPlan({
      fetchImageById,
      logger: { log: vi.fn(), warn: vi.fn() },
      patchMetadata,
      plan,
    });

    expect(result).toMatchObject({ updated: 1, alreadyTarget: 0, skipped: 0, failed: 0 });
    expect(patchMetadata).toHaveBeenCalledWith('child', expect.objectContaining({ namespace: 'cf-artifacts' }));
  });

  it('repairs a missing parent from a namespaced variant', () => {
    const plan = buildFamilyAwareAssignmentPlan({
      fallbackNamespace: 'cf-orphan',
      scanned: 2,
      images: [
        image({ id: 'parent', uploaded: '2026-05-01T00:00:00.000Z', meta: {} }),
        image({
          id: 'child',
          uploaded: '2026-05-02T00:00:00.000Z',
          meta: { namespace: 'cf-artifacts', variationParentId: 'parent' },
        }),
      ],
    });

    expect(plan.entries).toEqual([
      expect.objectContaining({
        id: 'parent',
        targetNamespace: 'cf-artifacts',
        action: 'repair-to-family-namespace',
        familyRootId: 'parent',
      }),
    ]);
    expect(plan.ambiguousFamilies).toEqual([]);
  });

  it('repairs a missing variant from a namespaced parent', () => {
    const plan = buildFamilyAwareAssignmentPlan({
      fallbackNamespace: 'cf-orphan',
      scanned: 2,
      images: [
        image({ id: 'parent', uploaded: '2026-05-01T00:00:00.000Z', meta: { namespace: 'cf-editorial' } }),
        image({
          id: 'child',
          uploaded: '2026-05-02T00:00:00.000Z',
          meta: { variationParentId: 'parent' },
        }),
      ],
    });

    expect(plan.entries).toEqual([
      expect.objectContaining({
        id: 'child',
        targetNamespace: 'cf-editorial',
        action: 'repair-to-family-namespace',
      }),
    ]);
  });

  it('falls back to cf-orphan when the whole family has no namespace evidence', () => {
    const plan = buildFamilyAwareAssignmentPlan({
      fallbackNamespace: 'cf-orphan',
      scanned: 2,
      images: [
        image({ id: 'parent', uploaded: '2026-05-01T00:00:00.000Z', meta: {} }),
        image({ id: 'child', uploaded: '2026-05-02T00:00:00.000Z', meta: { variationParentId: 'parent' } }),
      ],
    });

    expect(plan.entries.map((entry) => [entry.id, entry.targetNamespace, entry.action])).toEqual([
      ['child', 'cf-orphan', 'repair-to-fallback'],
      ['parent', 'cf-orphan', 'repair-to-fallback'],
    ]);
  });

  it('marks mixed-namespace families ambiguous and does not plan patches', () => {
    const plan = buildFamilyAwareAssignmentPlan({
      fallbackNamespace: 'cf-orphan',
      scanned: 3,
      images: [
        image({ id: 'parent', uploaded: '2026-05-01T00:00:00.000Z', meta: { namespace: 'alpha' } }),
        image({ id: 'child-a', uploaded: '2026-05-02T00:00:00.000Z', meta: { namespace: 'beta', variationParentId: 'parent' } }),
        image({ id: 'child-b', uploaded: '2026-05-03T00:00:00.000Z', meta: { variationParentId: 'parent' } }),
      ],
    });

    expect(plan.entries).toEqual([]);
    expect(plan.ambiguousFamilies).toEqual([
      expect.objectContaining({
        familyRootId: 'parent',
        namespaces: ['alpha', 'beta'],
        missingImageIds: ['child-b'],
      }),
    ]);
  });

  it('repairs cf-orphan images back to a single clear family namespace', () => {
    const plan = buildFamilyAwareAssignmentPlan({
      fallbackNamespace: 'cf-orphan',
      scanned: 2,
      images: [
        image({ id: 'parent', uploaded: '2026-05-01T00:00:00.000Z', meta: { namespace: 'cf-artifacts' } }),
        image({ id: 'child', uploaded: '2026-05-02T00:00:00.000Z', meta: { namespace: 'cf-orphan', variationParentId: 'parent' } }),
      ],
    });

    expect(plan.entries).toEqual([
      expect.objectContaining({
        id: 'child',
        currentNamespace: 'cf-orphan',
        targetNamespace: 'cf-artifacts',
        action: 'repair-from-fallback-to-family-namespace',
      }),
    ]);
  });

  it('uses video records as namespace evidence without planning video mutation', () => {
    const plan = buildFamilyAwareAssignmentPlan({
      fallbackNamespace: 'cf-orphan',
      scanned: 1,
      images: [
        image({ id: 'image-child', uploaded: '2026-05-02T00:00:00.000Z', meta: { variationParentId: 'video-parent' } }),
      ],
      videos: [
        {
          id: 'video-parent',
          assetType: 'video',
          filename: 'parent.mp4',
          uploaded: '2026-05-01T00:00:00.000Z',
          namespace: 'video-space',
        },
      ],
    });

    expect(plan.videoEvidenceCount).toBe(1);
    expect(plan.entries).toEqual([
      expect.objectContaining({
        id: 'image-child',
        targetNamespace: 'video-space',
        familyRootId: 'video-parent',
      }),
    ]);
  });

  it('does not overwrite existing real namespaces in family-aware plans', () => {
    const plan = buildFamilyAwareAssignmentPlan({
      fallbackNamespace: 'cf-orphan',
      scanned: 2,
      images: [
        image({ id: 'parent', uploaded: '2026-05-01T00:00:00.000Z', meta: { namespace: 'alpha' } }),
        image({ id: 'child', uploaded: '2026-05-02T00:00:00.000Z', meta: { namespace: 'alpha', variationParentId: 'parent' } }),
      ],
    });

    expect(plan.entries).toEqual([]);
    expect(plan.alreadyOkCount).toBe(2);
  });

  it('never removes namespace while trimming oversized metadata', () => {
    const prepared = prepareNamespaceMetadataUpdate(
      {
        description: 'x'.repeat(2_000),
        displayName: 'Large Metadata',
        namespace: '',
        sourceUrl: 'https://example.com/asset.jpg',
      },
      'cf-orphan'
    );

    expect(prepared.ok).toBe(true);
    expect(prepared.metadata.namespace).toBe('cf-orphan');
    expect(prepared.dropped).toContain('description');
  });

  it('registers the target namespace for UI dropdown discovery', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'missing-namespace-registry-'));
    const registryPath = path.join(dir, 'namespace-registry.json');
    try {
      await fs.writeFile(
        registryPath,
        `${JSON.stringify({
          namespaces: [{ name: 'cf-default', description: 'Default' }],
          updatedAt: '2026-05-13T00:00:00.000Z',
        })}\n`,
        'utf8'
      );

      const result = await upsertNamespaceRegistryFile({
        namespace: 'cf-orphan',
        description: 'Utility namespace',
        registryPath,
      });
      const payload = JSON.parse(await fs.readFile(registryPath, 'utf8'));

      expect(result.didChange).toBe(true);
      expect(payload.namespaces).toEqual([
        { name: 'cf-default', description: 'Default' },
        { name: 'cf-orphan', description: 'Utility namespace' },
      ]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
