import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import {
  extractInstagramMediaUrl,
  runInstagramIngest,
  TELEGRAM_INGEST_NAMESPACE,
} from '../scripts/telegram-listener/instagram-ingest.mjs';

describe('Telegram Instagram ingestion', () => {
  it('uses the cf-instagram namespace for every Telegram ingestion path', () => {
    expect(TELEGRAM_INGEST_NAMESPACE).toBe('cf-instagram');
  });

  it('extracts and canonicalizes Instagram post and reel URLs from message text or captions', () => {
    expect(extractInstagramMediaUrl({
      text: 'Please ingest https://www.instagram.com/reel/ABC123/?igsh=tracking.',
    })).toBe('https://www.instagram.com/reel/ABC123/');

    expect(extractInstagramMediaUrl({
      caption: 'Image: https://instagram.com/p/xyz_789/ and notes',
    })).toBe('https://www.instagram.com/p/xyz_789/');
  });

  it('ignores Instagram profile URLs and unrelated URLs', () => {
    expect(extractInstagramMediaUrl({
      text: 'https://www.instagram.com/example/ https://example.com/reel/ABC123/',
    })).toBeNull();
  });

  it('runs the canonical single-url ingest against the listener Photarium base URL', async () => {
    const child = new EventEmitter();
    const spawnImpl = vi.fn(() => child);
    const promise = runInstagramIngest({
      instagramUrl: 'https://www.instagram.com/reel/ABC123/',
      apiBase: 'http://localhost:3000',
      cwd: '/repo',
      spawnImpl,
    });

    child.emit('exit', 0, null);
    await promise;

    expect(spawnImpl).toHaveBeenCalledWith(
      process.execPath,
      [
        '/repo/scripts/instagram-ingest.mjs',
        'single-url',
        '--url',
        'https://www.instagram.com/reel/ABC123/',
        '--api-base',
        'http://localhost:3000',
      ],
      expect.objectContaining({ cwd: '/repo', stdio: 'inherit' }),
    );
  });

  it('rejects when the ingest process fails', async () => {
    const child = new EventEmitter();
    const promise = runInstagramIngest({
      instagramUrl: 'https://www.instagram.com/p/ABC123/',
      apiBase: 'http://localhost:3000',
      spawnImpl: vi.fn(() => child),
    });

    child.emit('exit', 1, null);
    await expect(promise).rejects.toThrow('Instagram ingest exited with code 1');
  });
});
