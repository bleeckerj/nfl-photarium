import { NextRequest, NextResponse } from 'next/server';
import {
  convertVideoToAnimatedWebp,
  type VideoAnimatedWebpOptions,
} from '@/server/videoAnimatedWebpService';
import {
  getVideoAssetRecordWithSync,
  updateVideoAssetRecord,
} from '@/server/videoCatalogStorage';
import { uploadImageBuffer } from '@/server/uploadService';
import { buildVideoAnimatedWebpImageTags } from '@/server/videoAnimatedWebpImageTags';

type AnimatedWebpVariationInput = {
  maxWidth?: number;
  maxHeight?: number;
  maxOutputBytes?: number;
  fps?: number;
  timeoutMs?: number;
  loop?: boolean;
  filename?: string;
};

type AnimatedWebpRequestBody = AnimatedWebpVariationInput & {
  variations?: AnimatedWebpVariationInput[];
};

type NormalizedVariation = {
  options: VideoAnimatedWebpOptions;
  filename?: string;
};

const MAX_VARIATIONS_PER_REQUEST = Math.max(
  1,
  Number(process.env.VIDEO_ANIMATED_WEBP_MAX_VARIATIONS_PER_REQUEST ?? 8)
);

const parseBody = async (request: NextRequest): Promise<AnimatedWebpRequestBody> => {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') return {};
    return body as AnimatedWebpRequestBody;
  } catch {
    return {};
  }
};

const cleanFilename = (value?: string, fallback = 'animated-video.webp') => {
  if (!value || typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const normalized = trimmed.replace(/[^a-zA-Z0-9-_.]/g, '_');
  if (!normalized) return fallback;
  if (normalized.toLowerCase().endsWith('.webp')) return normalized;
  return `${normalized}.webp`;
};

const withoutExtension = (value: string) => value.replace(/\.[^.]+$/, '');

const deriveOutputName = (filename?: string) => {
  const cleaned = (filename || '').trim();
  if (!cleaned) return undefined;
  return cleaned.replace(/\.[^.]+$/, '') + '.webp';
};

const buildInlineOriginalImageUrl = (imageId: string) =>
  `/api/images/${encodeURIComponent(imageId)}/download?variant=original&disposition=inline`;

const buildOptions = (variation: AnimatedWebpVariationInput): VideoAnimatedWebpOptions => ({
  maxWidth: variation.maxWidth,
  maxHeight: variation.maxHeight,
  maxOutputBytes: variation.maxOutputBytes,
  fps: variation.fps,
  timeoutMs: variation.timeoutMs,
  loop: variation.loop,
});

const buildTroubleshootingHints = (message: string): string[] => {
  const hints: string[] = [];
  const lowered = message.toLowerCase();
  if (lowered.includes('ffmpeg is not installed') || lowered.includes('not available on path')) {
    hints.push('Install FFmpeg and ensure it is on PATH for the server process.');
  }
  if (lowered.includes('webp encoder') || lowered.includes('libwebp') || lowered.includes('unknown encoder')) {
    hints.push('Your FFmpeg build is missing WebP encoder support; the service can fall back to Sharp-based encoding.');
    hints.push('If failures continue, verify FFmpeg can decode the source and that disk/temp space is available.');
  }
  if (lowered.includes('timed out')) {
    hints.push('Try reducing max width or FPS, or increase timeoutMs.');
  }
  if (lowered.includes('max output size')) {
    hints.push('Lower max width and/or FPS, or increase maxOutputBytes.');
  }
  return hints;
};

const collectVariations = (body: AnimatedWebpRequestBody): NormalizedVariation[] => {
  const rawVariations = Array.isArray(body.variations) && body.variations.length > 0
    ? body.variations
    : [body];

  return rawVariations.slice(0, MAX_VARIATIONS_PER_REQUEST).map((variation) => ({
    options: buildOptions(variation),
    filename: variation.filename,
  }));
};

const resolveOutputFilename = ({
  explicitFilename,
  baseFilename,
  index,
  total,
}: {
  explicitFilename?: string;
  baseFilename: string;
  index: number;
  total: number;
}) => {
  if (explicitFilename) {
    return cleanFilename(explicitFilename, baseFilename);
  }

  if (total <= 1) {
    return cleanFilename(baseFilename, 'animated-video.webp');
  }

  return cleanFilename(
    `${withoutExtension(baseFilename)}-v${index + 1}.webp`,
    `animated-video-v${index + 1}.webp`
  );
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      return NextResponse.json(
        { error: 'Cloudflare credentials not configured. Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables.' },
        { status: 500 }
      );
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    const video = await getVideoAssetRecordWithSync(id);
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    if (!video.namespace) {
      return NextResponse.json(
        { error: 'Video is missing namespace metadata and cannot be uploaded as an animated WebP derivative.' },
        { status: 400 }
      );
    }

    if (video.videoStatus !== 'ready') {
      return NextResponse.json(
        { error: `Video is not ready for conversion (status: ${video.videoStatus}).` },
        { status: 409 }
      );
    }

    const sourceUrl = video.hlsUrl;
    if (!sourceUrl) {
      return NextResponse.json(
        { error: 'Video does not have an HLS URL available for conversion.' },
        { status: 409 }
      );
    }

    const body = await parseBody(request);
    const variations = collectVariations(body);
    if (variations.length === 0) {
      return NextResponse.json({ error: 'No variation settings provided.' }, { status: 400 });
    }

    await updateVideoAssetRecord(video.id, {
      animatedWebpStatus: 'pending',
      animatedWebpError: undefined,
      animatedWebpUpdatedAt: new Date().toISOString(),
    });

    const baseOutputName = deriveOutputName(video.filename) || 'animated-video.webp';

    const created: Array<{
      imageId: string;
      url: string;
      filename: string;
      bytes: number;
      width?: number;
      height?: number;
      fps: number;
      loop: boolean;
      quality: number;
      attempts: number;
      maxWidth: number;
      maxHeight: number;
      maxOutputBytes: number;
      timeoutMs: number;
      encoder: string;
      createdAt: string;
    }> = [];

    const errors: Array<{ index: number; filename: string; error: string }> = [];

    for (let index = 0; index < variations.length; index += 1) {
      const variation = variations[index];
      const filename = resolveOutputFilename({
        explicitFilename: variation.filename,
        baseFilename: baseOutputName,
        index,
        total: variations.length,
      });

      try {
        const generated = await convertVideoToAnimatedWebp(sourceUrl, variation.options);
        const uploadOutcome = await uploadImageBuffer({
          buffer: generated.buffer,
          originalBuffer: generated.buffer,
          fileName: filename,
          fileType: 'image/webp',
          fileSize: generated.bytes,
          context: {
            accountId,
            apiToken,
            folder: video.folder,
            tags: buildVideoAnimatedWebpImageTags(video.tags),
            description: video.description,
            originalUrl: video.originalUrl,
            sourceUrl: video.sourceUrl || sourceUrl,
            namespace: video.namespace,
            generatedBy: video.generatedBy,
            comfyMetadataDetected: video.comfyMetadataDetected,
            comfyMetadataSource: video.comfyMetadataSource,
          },
        });

        if (!uploadOutcome.ok) {
          errors.push({
            index,
            filename,
            error: uploadOutcome.error,
          });
          continue;
        }

        created.push({
          imageId: uploadOutcome.data.id,
          url: buildInlineOriginalImageUrl(uploadOutcome.data.id),
          filename,
          bytes: generated.bytes,
          width: generated.width,
          height: generated.height,
          fps: generated.fps,
          loop: generated.loop,
          quality: generated.quality,
          attempts: generated.attempts,
          maxWidth: generated.maxWidth,
          maxHeight: generated.maxHeight,
          maxOutputBytes: generated.maxOutputBytes,
          timeoutMs: generated.timeoutMs,
          encoder: generated.encoder,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        errors.push({
          index,
          filename,
          error: error instanceof Error ? error.message : 'Failed to create animated WebP variation',
        });
      }
    }

    if (created.length === 0) {
      const message = errors[0]?.error || 'Failed to create animated WebP from video';
      const hints = buildTroubleshootingHints(message);
      await updateVideoAssetRecord(video.id, {
        animatedWebpStatus: 'error',
        animatedWebpError: message,
        animatedWebpUpdatedAt: new Date().toISOString(),
      });
      return NextResponse.json(
        {
          error: message,
          createdCount: 0,
          failedCount: errors.length,
          errors,
          hints: hints.length > 0 ? hints : undefined,
        },
        { status: 502 }
      );
    }

    const latest = created[created.length - 1];
    const nextVariants = [
      ...created.map((entry) => ({
        imageId: entry.imageId,
        url: entry.url,
        filename: entry.filename,
        bytes: entry.bytes,
        width: entry.width,
        height: entry.height,
        fps: entry.fps,
        loop: entry.loop,
        maxWidth: entry.maxWidth,
        maxHeight: entry.maxHeight,
        maxOutputBytes: entry.maxOutputBytes,
        timeoutMs: entry.timeoutMs,
        encoder: entry.encoder,
        createdAt: entry.createdAt,
      })),
      ...(video.animatedWebpVariants || []),
    ].slice(0, 30);

    const updatedVideo = await updateVideoAssetRecord(video.id, {
      animatedWebpImageId: latest.imageId,
      animatedWebpUrl: latest.url,
      animatedWebpStatus: 'ready',
      animatedWebpError:
        errors.length > 0
          ? `${errors.length} variation${errors.length === 1 ? '' : 's'} failed during generation.`
          : undefined,
      animatedWebpUpdatedAt: new Date().toISOString(),
      animatedWebpBytes: latest.bytes,
      animatedWebpWidth: latest.width,
      animatedWebpHeight: latest.height,
      animatedWebpVariants: nextVariants,
    });

    return NextResponse.json({
      success: true,
      partial: errors.length > 0,
      createdCount: created.length,
      failedCount: errors.length,
      animatedWebp: latest,
      variations: created,
      errors: errors.length > 0 ? errors : undefined,
      hints:
        errors.length > 0
          ? buildTroubleshootingHints(errors[0]?.error || '')
          : undefined,
      video: updatedVideo,
    });
  } catch (error) {
    console.error('[video animated-webp] conversion failed', error);
    return NextResponse.json({ error: 'Failed to create animated WebP from video' }, { status: 500 });
  }
}

