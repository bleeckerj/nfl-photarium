import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { randomUUID } from 'crypto';
import { uploadImageBuffer } from '@/server/uploadService';

type AnimationItem =
  | { kind: 'file'; fileIndex: number }
  | { kind: 'url'; url: string };

const isValidUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

const isPrivateHost = (hostname: string) => {
  const lowered = hostname.toLowerCase();
  if (lowered === 'localhost') return true;
  const ipv4Match = /^(\d{1,3}\.){3}\d{1,3}$/.test(lowered);
  if (!ipv4Match) return false;
  const octets = lowered.split('.').map((part) => Number(part));
  if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return true;
  }
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
};

const getFilenameFromUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'remote-frame';
  } catch {
    return 'remote-frame';
  }
};

const resolveLoopValue = (value: string | null) => {
  if (value === null) return true;
  if (value === 'false') return false;
  if (value === '0') return false;
  return true;
};

const normalizeFilename = (value: string) => value.replace(/[^a-zA-Z0-9-_\.]/g, '_');

export async function POST(request: NextRequest) {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      return NextResponse.json(
        { error: 'Cloudflare credentials not configured. Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const itemsRaw = formData.get('items');
    if (!itemsRaw || typeof itemsRaw !== 'string') {
      return NextResponse.json({ error: 'No frames provided' }, { status: 400 });
    }

    let items: AnimationItem[] = [];
    try {
      items = JSON.parse(itemsRaw) as AnimationItem[];
    } catch {
      return NextResponse.json({ error: 'Invalid frame payload' }, { status: 400 });
    }

    if (!Array.isArray(items) || items.length < 2) {
      return NextResponse.json({ error: 'Select at least two images' }, { status: 400 });
    }

    const fpsRaw = formData.get('fps');
    const fps = fpsRaw ? Number(fpsRaw) : 1;
    if (!Number.isFinite(fps) || fps <= 0) {
      return NextResponse.json({ error: 'FPS must be greater than 0' }, { status: 400 });
    }
    const delayMs = Math.max(1, Math.round(1000 / fps));

    const loop = resolveLoopValue(formData.get('loop') as string | null);

    const folder = (formData.get('folder') as string) || undefined;
    const tagsRaw = (formData.get('tags') as string) || '';
    const description = (formData.get('description') as string) || undefined;
    const originalUrl = (formData.get('originalUrl') as string) || undefined;
    const sourceUrl = (formData.get('sourceUrl') as string) || undefined;
    const namespace = (formData.get('namespace') as string) || undefined;
    const parentId = (formData.get('parentId') as string) || undefined;
    const filenameRaw = (formData.get('filename') as string) || '';

    const cleanTags = tagsRaw
      ? tagsRaw.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];

    const fileList = formData.getAll('files') as File[];
    const frames: { buffer: Buffer; filename: string }[] = [];
    const errors: string[] = [];

    for (const item of items) {
      if (item.kind === 'file') {
        const file = fileList[item.fileIndex];
        if (!file) {
          errors.push('Missing file frame');
          continue;
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        frames.push({ buffer, filename: file.name });
      } else if (item.kind === 'url') {
        if (!isValidUrl(item.url)) {
          errors.push('Invalid frame URL');
          continue;
        }
        const parsed = new URL(item.url);
        if (isPrivateHost(parsed.hostname)) {
          errors.push('Private or localhost frame URL');
          continue;
        }
        try {
          const response = await fetch(item.url);
          if (!response.ok) {
            errors.push('Failed to fetch frame');
            continue;
          }
          const buffer = Buffer.from(await response.arrayBuffer());
          frames.push({ buffer, filename: getFilenameFromUrl(item.url) });
        } catch {
          errors.push('Failed to fetch frame');
        }
      }
    }

    if (errors.length) {
      return NextResponse.json({ error: 'Failed to build animation', details: errors }, { status: 400 });
    }

    if (frames.length < 2) {
      return NextResponse.json({ error: 'Select at least two valid images' }, { status: 400 });
    }

    const metas = await Promise.all(frames.map((frame) => sharp(frame.buffer).metadata()));
    const widths = metas.map((meta) => meta.width || 0).filter(Boolean);
    const heights = metas.map((meta) => meta.height || 0).filter(Boolean);
    const maxWidth = Math.max(...widths, 1);
    const maxHeight = Math.max(...heights, 1);

    const preparedFrames = await Promise.all(
      frames.map(async (frame) => {
        // Convert each frame to PNG (ffmpeg works best with PNG input)
        const pngBuffer = await sharp(frame.buffer)
          .resize(maxWidth, maxHeight, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 0 }
          })
          .png()
          .toBuffer();
        return pngBuffer;
      })
    );

    // Create temp directory for frames
    const tempId = randomUUID();
    const tempDir = join(tmpdir(), `animate-${tempId}`);
    await mkdir(tempDir, { recursive: true });
    
    // Write frames to temp files
    const framePaths: string[] = [];
    for (let i = 0; i < preparedFrames.length; i++) {
      const framePath = join(tempDir, `frame-${String(i).padStart(4, '0')}.png`);
      await writeFile(framePath, preparedFrames[i]);
      framePaths.push(framePath);
    }
    
    const outputPath = join(tempDir, 'output.webp');
    
    // Use ffmpeg to create animated WebP
    const ffmpegArgs = [
      '-framerate', String(fps),
      '-i', join(tempDir, 'frame-%04d.png'),
      '-loop', loop ? '0' : '1',
      '-c:v', 'libwebp',
      '-lossless', '0',
      '-q:v', '80',
      '-y',
      outputPath
    ];
    
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      let stderr = '';
      ffmpeg.stderr.on('data', (data) => { stderr += data.toString(); });
      ffmpeg.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      });
      ffmpeg.on('error', reject);
    });
    
    const animatedBuffer = await readFile(outputPath);
    
    // Cleanup temp files
    for (const framePath of framePaths) {
      await unlink(framePath).catch(() => {});
    }
    await unlink(outputPath).catch(() => {});

    const outputName = filenameRaw
      ? normalizeFilename(filenameRaw.replace(/\.webp$/i, '')) + '.webp'
      : `animated-${Date.now()}.webp`;

    const outcome = await uploadImageBuffer({
      buffer: animatedBuffer,
      originalBuffer: animatedBuffer,
      fileName: outputName,
      fileType: 'image/webp',
      fileSize: animatedBuffer.byteLength,
      context: {
        accountId,
        apiToken,
        folder: folder && folder.trim() ? folder.trim() : undefined,
        tags: cleanTags,
        description: description && description.trim() ? description.trim() : undefined,
        originalUrl: originalUrl && originalUrl.trim() ? originalUrl.trim() : undefined,
        sourceUrl: sourceUrl && sourceUrl.trim() ? sourceUrl.trim() : undefined,
        namespace: namespace && namespace.trim() ? namespace.trim() : undefined,
        parentId: parentId && parentId.trim() ? parentId.trim() : undefined
      }
    });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    return NextResponse.json(outcome.data);
  } catch (error) {
    console.error('Animate upload error:', error);
    return NextResponse.json({ error: 'Failed to create animation' }, { status: 500 });
  }
}
