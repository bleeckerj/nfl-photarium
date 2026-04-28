import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type VideoContainerMetadata = {
  formatTags: Record<string, string>;
  streamTags: Array<Record<string, string>>;
};

type FfprobeJson = {
  format?: {
    tags?: Record<string, unknown>;
  };
  streams?: Array<{
    tags?: Record<string, unknown>;
  }>;
};

const VIDEO_EXTENSION_BY_MIME: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
};

function normalizeTags(input: Record<string, unknown> | undefined): Record<string, string> {
  if (!input) return {};

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    normalized[key] = trimmed;
  }
  return normalized;
}

function resolveTempExtension(mimeType?: string): string {
  if (!mimeType) return '.mp4';
  return VIDEO_EXTENSION_BY_MIME[mimeType.toLowerCase()] ?? '.mp4';
}

async function runFfprobe(filePath: string): Promise<FfprobeJson> {
  const args = [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  return await new Promise<FfprobeJson>((resolve, reject) => {
    const child = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr || stdout}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as FfprobeJson);
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function readVideoContainerMetadataFromBuffer(
  buffer: Buffer,
  mimeType?: string
): Promise<VideoContainerMetadata | null> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'photarium-video-metadata-'));
  const tempFile = path.join(tempDir, `input${resolveTempExtension(mimeType)}`);

  try {
    await writeFile(tempFile, buffer);
    const probe = await runFfprobe(tempFile);
    return {
      formatTags: normalizeTags(probe.format?.tags),
      streamTags: Array.isArray(probe.streams)
        ? probe.streams.map((stream) => normalizeTags(stream.tags))
        : [],
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
