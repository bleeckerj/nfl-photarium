import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

function mockSpawnResult(exitCode = 0, stdout = '', stderr = '') {
  spawnMock.mockImplementationOnce(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();

    queueMicrotask(() => {
      if (stdout) child.stdout.write(stdout);
      if (stderr) child.stderr.write(stderr);
      child.stdout.end();
      child.stderr.end();
      child.emit('close', exitCode);
    });

    return child;
  });
}

describe('Photarium MCP Instagram command wrappers', async () => {
  const commands = await import('../mcp-server/src/runtime/instagram/commands.js');

  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('builds the single URL ingest command with Instagram defaults', async () => {
    mockSpawnResult(0, 'ok');

    const result = await commands.runInstagramSingleUrlIngest({
      url: 'https://www.instagram.com/p/abc123/',
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('ok');
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/scripts\/instagram-ingest\.mjs$/),
        'single-url',
        '--url',
        'https://www.instagram.com/p/abc123/',
        '--namespace',
        'cf-instagram',
        '--push-cloudflare',
      ]),
    );
    expect(args).not.toContain('--username');
    expect(options.cwd).toMatch(/cloud-flare-image-handler$/);
  });

  it('builds profile ingest with explicit upload options', async () => {
    mockSpawnResult(0);

    await commands.runInstagramProfileIngest({
      username: 'demo',
      namespace: 'ig-archive',
      count: 24,
      maxPages: 2,
      pushCloudflare: true,
      aiDisplayName: true,
      noResume: true,
      noColor: true,
    });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining([
        'ingest',
        '--username',
        'demo',
        '--namespace',
        'ig-archive',
        '--count',
        '24',
        '--max-pages',
        '2',
        '--push-cloudflare',
        '--ai-display-name',
        '--no-resume',
        '--no-color',
      ]),
    );
  });

  it('builds recovery dry-run commands without executing nested Instagram work', async () => {
    mockSpawnResult(0);

    await commands.runInstagramVideoRecovery({
      input: 'data/instagram/demo.ndjson',
      namespace: 'ig-videos',
      limit: 3,
      skipReplay: true,
      dryRun: true,
      verbose: true,
    });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/scripts\/instagram-video-recover\.mjs$/),
        '--input',
        'data/instagram/demo.ndjson',
        '--namespace',
        'ig-videos',
        '--limit',
        '3',
        '--skip-replay',
        '--dry-run',
        '--verbose',
      ]),
    );
  });
});
