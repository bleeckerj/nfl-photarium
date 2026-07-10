import { spawn } from 'node:child_process';
import path from 'node:path';

const INSTAGRAM_HOST_PATTERN = /(^|\.)instagram\.com$/i;
const SUPPORTED_MEDIA_KINDS = new Set(['p', 'reel', 'reels', 'tv']);

export function extractInstagramMediaUrl(message) {
  const text = [message?.text, message?.caption]
    .filter((value) => typeof value === 'string')
    .join(' ');

  for (const match of text.matchAll(/https?:\/\/[^\s<>]+/giu)) {
    const candidate = match[0].replace(/[),.;!?]+$/u, '');
    try {
      const parsed = new URL(candidate);
      const [kind, shortcode] = parsed.pathname.split('/').filter(Boolean);
      if (!INSTAGRAM_HOST_PATTERN.test(parsed.hostname)) continue;
      if (!SUPPORTED_MEDIA_KINDS.has(kind?.toLowerCase()) || !shortcode) continue;
      return `https://www.instagram.com/${kind.toLowerCase()}/${shortcode}/`;
    } catch {
      // Ignore malformed URL-looking text and keep looking for a valid media URL.
    }
  }

  return null;
}

export function runInstagramIngest({ instagramUrl, apiBase, cwd = process.cwd(), spawnImpl = spawn }) {
  const scriptPath = path.resolve(cwd, 'scripts/instagram-ingest.mjs');
  const args = [scriptPath, 'single-url', '--url', instagramUrl, '--api-base', apiBase];

  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, args, {
      cwd,
      env: process.env,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Instagram ingest exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}
