#!/usr/bin/env node

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';

const usage = () => {
  console.log(`Usage:
  node scripts/video-frames.mjs --video-id <id> --selector "first,middle,last" [--base-url http://localhost:3000] [--output /tmp]

Options:
  --video-id    Required video asset id
  --selector    Required frame selector, e.g. "first,last" or "1,100"
  --base-url    API base URL (default: http://localhost:3000)
  --output      Output directory or full file path (default: ${path.join(os.tmpdir(), 'photarium-video-frames')})
`);
};

const parseArgs = (argv) => {
  const out = {
    baseUrl: 'http://localhost:3000',
    output: path.join(os.tmpdir(), 'photarium-video-frames'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--video-id') {
      out.videoId = next;
      index += 1;
    } else if (arg === '--selector') {
      out.selector = next;
      index += 1;
    } else if (arg === '--base-url') {
      out.baseUrl = next;
      index += 1;
    } else if (arg === '--output') {
      out.output = next;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return out;
};

const resolveOutputPath = async ({ output, filename }) => {
  const looksLikeFile = /\.[a-z0-9]{2,5}$/i.test(output);
  if (looksLikeFile) {
    await mkdir(path.dirname(output), { recursive: true });
    return output;
  }
  await mkdir(output, { recursive: true });
  return path.join(output, filename);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  if (!args.videoId || !args.selector) {
    usage();
    throw new Error('--video-id and --selector are required');
  }

  const response = await fetch(
    `${args.baseUrl.replace(/\/+$/, '')}/api/videos/${encodeURIComponent(args.videoId)}/frames/extract`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector: args.selector }),
    }
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  const disposition = response.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || 'video-frames.bin';
  const outputPath = await resolveOutputPath({ output: args.output, filename });
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
  console.log(outputPath);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
