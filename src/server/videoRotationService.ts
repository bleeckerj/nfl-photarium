import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { QuarterTurn } from '@/server/imageRotationService';
import { getVideoAssetRecord } from '@/server/videoCatalogStorage';
import {
  fetchVideoDownloadCandidate,
  resolveVideoDownloadCandidates,
} from '@/server/videoDownloadSourceService';
import { MAX_VIDEO_BYTES, uploadVideoBuffer } from '@/server/videoUploadService';
import { sanitizeFilename } from '@/utils/filename';

const VIDEO_ROTATION_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.VIDEO_ROTATION_TIMEOUT_MS ?? 120_000)
);
const MAX_STDERR_CHARS = 256 * 1024;

export class VideoRotationError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'VideoRotationError';
  }
}

export const buildVideoRotationFilter = (degrees: QuarterTurn) => {
  if (degrees === 90) return 'transpose=clock';
  if (degrees === 270) return 'transpose=cclock';
  return 'hflip,vflip';
};

export const buildVideoRotationArgs = (
  inputPath: string,
  outputPath: string,
  degrees: QuarterTurn
) => [
  '-hide_banner',
  '-loglevel', 'error',
  '-y',
  '-i', inputPath,
  '-map', '0:v:0',
  '-map', '0:a?',
  '-vf', buildVideoRotationFilter(degrees),
  '-map_metadata', '0',
  '-metadata:s:v:0', 'rotate=0',
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-crf', '18',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-b:a', '192k',
  '-movflags', '+faststart',
  outputPath,
];

const runFfmpeg = async (args: string[], timeoutMs = VIDEO_ROTATION_TIMEOUT_MS) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args);
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new VideoRotationError(`FFmpeg timed out after ${timeoutMs}ms`, 504));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_STDERR_CHARS) {
        stderr += chunk.toString().slice(0, MAX_STDERR_CHARS - stderr.length);
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      const code = (error as NodeJS.ErrnoException).code;
      reject(new VideoRotationError(
        code === 'ENOENT' ? 'FFmpeg is not installed or not available on PATH.' : error.message,
        500
      ));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new VideoRotationError(`FFmpeg exited with code ${code}: ${stderr}`, 500));
    });
  });
};

const buildRotatedFilename = (filename: string, degrees: QuarterTurn) => {
  const base = sanitizeFilename(filename).replace(/\.[^.]+$/, '') || 'video';
  return sanitizeFilename(`${base}-rotated-${degrees}.mp4`);
};

export async function rotateVideoAsset(videoId: string, degrees: QuarterTurn) {
  const video = await getVideoAssetRecord(videoId);
  if (!video) throw new VideoRotationError('Video not found', 404);
  if (!video.namespace) throw new VideoRotationError('Video must have a namespace before rotation', 400);

  const candidates = await resolveVideoDownloadCandidates(video);
  if (!candidates.urls.length) {
    if (candidates.streamDownloadStatus === 'inprogress') {
      throw new VideoRotationError('Video download is being prepared. Retry rotation in a few seconds.', 409);
    }
    throw new VideoRotationError('No downloadable video URL is available for this asset.', 404);
  }
  const fetched = await fetchVideoDownloadCandidate(candidates);
  if (!fetched.response) {
    if (candidates.streamDownloadStatus === 'inprogress') {
      throw new VideoRotationError('Video download is being prepared. Retry rotation in a few seconds.', 409);
    }
    throw new VideoRotationError(`Failed to fetch video from upstream (${fetched.lastStatus})`, 502);
  }

  const workspace = join(tmpdir(), `photarium-video-rotate-${randomUUID()}`);
  const inputPath = join(workspace, 'input.mp4');
  const outputPath = join(workspace, 'output.mp4');
  try {
    await mkdir(workspace, { recursive: true });
    await writeFile(inputPath, Buffer.from(await fetched.response.arrayBuffer()));
    await runFfmpeg(buildVideoRotationArgs(inputPath, outputPath, degrees));
    const output = await readFile(outputPath);
    if (output.byteLength > MAX_VIDEO_BYTES) {
      throw new VideoRotationError(
        `Rotated video exceeds limit of ${(MAX_VIDEO_BYTES / 1024 / 1024).toFixed(0)}MB`,
        413
      );
    }

    const rotatedAt = new Date().toISOString();
    const filename = buildRotatedFilename(video.filename, degrees);
    const displayName = `${video.displayName || video.filename} rotated ${degrees}°`;
    const upload = await uploadVideoBuffer({
      buffer: output,
      fileName: filename,
      fileType: 'video/mp4',
      fileSize: output.byteLength,
      context: {
        folder: video.folder,
        tags: video.tags,
        description: video.description,
        displayName,
        originalUrl: video.originalUrl,
        sourceUrl: video.sourceUrl,
        namespace: video.namespace,
        parentId: video.parentId,
        rotatedFromId: video.id,
        rotatedAt,
        rotationDegrees: degrees,
      },
    });
    if (!upload.ok) throw new VideoRotationError(upload.error, upload.status);
    return {
      ...upload.data,
      rotatedFromId: video.id,
      rotatedAt,
      rotationDegrees: degrees,
      animatedWebpImageId: undefined,
      animatedWebpVariants: undefined,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}
