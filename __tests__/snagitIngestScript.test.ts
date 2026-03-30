import { describe, expect, it, vi } from 'vitest';

describe('snagit ingest script helpers', async () => {
  const script = await import('../scripts/snagit-ingest.mjs');

  it('parses probe defaults and repeated roots', () => {
    const options = script.parseArgs([
      'probe',
      '--root', '/tmp/snagit-a',
      '--root', '/tmp/snagit-b',
    ]);

    expect(options.command).toBe('probe');
    expect(options.namespace).toBe('cf-snagit-archive');
    expect(options.providerMode).toBe('auto');
    expect(options.probeMaxFiles).toBe(10);
    expect(options.probeMaxBytes).toBe(1024 * 1024 * 1024);
    expect(options.roots).toEqual(['/tmp/snagit-a', '/tmp/snagit-b']);
  });

  it('assigns a default checkpoint path for ingest', () => {
    const options = script.parseArgs([
      'ingest',
      '--root', '/tmp/snagit-a',
      '--namespace', 'cf-snagit-archive',
    ]);

    expect(options.checkpointFile).toContain('data/snagit-ingest/checkpoints');
  });

  it('builds snagit source records for snagx and media files', () => {
    const snagx = script.buildSnagitSourceRecord({
      item: {
        sourceType: 'snagx',
        absolutePath: '/tmp/Capture.snagx',
      },
      captureDate: '2026-03-25T10:11:12Z',
      metadata: { Application: 'Snagit' },
      extractedFilename: 'Capture.png',
    });

    const media = script.buildSnagitSourceRecord({
      item: {
        sourceType: 'video',
        absolutePath: '/tmp/Capture.mp4',
      },
    });

    expect(snagx).toEqual(expect.objectContaining({
      sourceType: 'snagx',
      originalFileName: 'Capture.snagx',
      originalExtension: '.snagx',
      captureDate: '2026-03-25T10:11:12Z',
      extractedFilename: 'Capture.png',
    }));
    expect(media).toEqual(expect.objectContaining({
      sourceType: 'video',
      originalFileName: 'Capture.mp4',
      originalExtension: '.mp4',
    }));
  });

  it('classifies probe verdicts', () => {
    expect(script.classifyProbeCapability([])).toBeNull();

    expect(script.classifyProbeCapability([
      { hydrated: true, placeholderAfterEvict: true },
      { hydrated: true, placeholderAfterEvict: true },
    ])).toBe('automated_hydrate_and_evict_supported');

    expect(script.classifyProbeCapability([
      { hydrated: true, placeholderAfterEvict: false },
    ])).toBe('hydrate_supported_evict_unreliable');

    expect(script.classifyProbeCapability([
      { hydrated: false, placeholderAfterEvict: false },
    ])).toBe('hydrate_unsupported_manual_stage_required');
  });

  it('treats Dropbox xattrs as the primary placeholder determinant', () => {
    expect(script.deriveProviderFileState({
      filePath: '/Users/julian/OMATA Dropbox/Julian Bleecker/Snagit/example.snagx',
      stat: { size: 0 },
      xattrNames: ['com.dropbox.attrs', 'com.dropbox.placeholder'],
    })).toEqual({
      providerHint: true,
      placeholderLikely: true,
    });

    expect(script.deriveProviderFileState({
      filePath: '/tmp/example.snagx',
      stat: { size: 1234 },
      xattrNames: ['com.dropbox.attrs'],
    })).toEqual({
      providerHint: true,
      placeholderLikely: false,
    });

    expect(script.deriveProviderFileState({
      filePath: '/Users/julian/OMATA Dropbox/Julian Bleecker/Snagit/example.snagx',
      stat: { size: 0 },
      xattrNames: [],
    })).toEqual({
      providerHint: true,
      placeholderLikely: true,
    });
  });

  it('determines the next pending ingest phase for resumable runs', () => {
    const entry = {
      phases: {
        upload: { status: 'uploaded' },
        extras: { status: 'failed' },
        embeddings: { status: 'pending' },
      },
    };

    expect(script.nextPendingIngestPhase(entry, {
      assetKind: 'image',
      ensureEmbeddings: true,
    })).toBe('extras');

    expect(script.nextPendingIngestPhase({
      phases: {
        upload: { status: 'uploaded' },
        extras: { status: 'done' },
        embeddings: { status: 'pending' },
      },
    }, {
      assetKind: 'image',
      ensureEmbeddings: true,
    })).toBe('embeddings');

    expect(script.nextPendingIngestPhase({
      phases: {
        upload: { status: 'uploaded' },
        extras: { status: 'skipped' },
        embeddings: { status: 'done' },
      },
    }, {
      assetKind: 'video',
      ensureEmbeddings: true,
    })).toBeNull();
  });

  it('stops when tranche thresholds are reached', () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      expect(script.shouldStopForTranche({
        startedAt: now - 5 * 60 * 1000,
        actionedFiles: 10,
        actionedBytes: 10_000,
      }, {
        trancheMaxFiles: 10,
        trancheMaxBytes: Infinity,
        trancheMaxMinutes: Infinity,
      })).toBe('tranche-max-files=10');

      expect(script.shouldStopForTranche({
        startedAt: now - 5 * 60 * 1000,
        actionedFiles: 2,
        actionedBytes: 2048,
      }, {
        trancheMaxFiles: Infinity,
        trancheMaxBytes: 2048,
        trancheMaxMinutes: Infinity,
      })).toBe('tranche-max-bytes=2048');

      expect(script.shouldStopForTranche({
        startedAt: now - 31 * 60 * 1000,
        actionedFiles: 1,
        actionedBytes: 1,
      }, {
        trancheMaxFiles: Infinity,
        trancheMaxBytes: Infinity,
        trancheMaxMinutes: 30,
      })).toBe('tranche-max-minutes=30');
    } finally {
      vi.useRealTimers();
    }
  });
});
