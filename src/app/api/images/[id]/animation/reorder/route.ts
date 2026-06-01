import { NextRequest, NextResponse } from 'next/server';
import { fetchCloudflareImage, getCloudflareCredentials } from '@/server/cloudflareClient';
import { deleteCloudflareImageWithArtifacts } from '@/server/cloudflareImageDeletion';
import {
  fetchOriginalImageBlob,
  reverseAnimatedWebpBuffer,
} from '@/server/animatedWebpService';
import { patchImageExtrasRecord } from '@/server/imageExtras';
import { uploadImageBuffer } from '@/server/uploadService';
import { parseCloudflareMetadata } from '@/utils/cloudflareMetadata';

const normalizeFilename = (value: string) => value.replace(/[^a-zA-Z0-9-_\.]/g, '_');

const buildReversedFilename = (filename?: string) => {
  const base = (filename || 'animated-webp').replace(/\.webp$/i, '');
  return `${normalizeFilename(base)}-reversed.webp`;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    if (body?.mode !== 'reverse') {
      return NextResponse.json({ error: 'Only reverse animation reorder is supported' }, { status: 400 });
    }
    const replaceOriginal = body?.replaceOriginal === true;

    const credentials = getCloudflareCredentials();
    const sourceImage = await fetchCloudflareImage(imageId, credentials);
    const sourceMeta = parseCloudflareMetadata(sourceImage.meta);
    const { buffer: originalBuffer } = await fetchOriginalImageBlob(imageId);
    const reversed = await reverseAnimatedWebpBuffer(originalBuffer);
    const tags = Array.from(new Set([
      ...(Array.isArray(sourceMeta.tags) ? sourceMeta.tags : []),
      'animated-webp',
    ]));

    const upload = await uploadImageBuffer({
      buffer: reversed.buffer,
      originalBuffer: reversed.buffer,
      fileName: buildReversedFilename(sourceImage.filename),
      fileType: 'image/webp',
      fileSize: reversed.bytes,
      context: {
        accountId: credentials.accountId,
        apiToken: credentials.apiToken,
        tags,
        namespace: typeof sourceMeta.namespace === 'string' ? sourceMeta.namespace : undefined,
        parentId: replaceOriginal
          ? (typeof sourceMeta.variationParentId === 'string' ? sourceMeta.variationParentId : undefined)
          : imageId,
      },
    });

    if (!upload.ok) {
      return NextResponse.json({ error: upload.error }, { status: upload.status });
    }

    await patchImageExtrasRecord(upload.data.id, {
      animatedWebp: {
        sourceImageIds: [imageId],
        sourceFilenames: [sourceImage.filename || imageId],
        orderMode: 'reverse',
        generatedAt: new Date().toISOString(),
        repairedFromImageId: imageId,
        replacedImageId: replaceOriginal ? imageId : undefined,
        repairMode: 'reverse',
      },
    });

    if (replaceOriginal) {
      try {
        await deleteCloudflareImageWithArtifacts(imageId);
      } catch (error) {
        console.error('[AnimationReorder] replacement upload succeeded but old image delete failed', error);
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : 'Failed to delete original image',
            replacement: upload.data,
            warning:
              'A reversed replacement was uploaded, but the original Cloudflare image could not be deleted.',
          },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      image: upload.data,
      replaceOriginal,
      replacedImageId: replaceOriginal ? imageId : undefined,
      warning: replaceOriginal
        ? 'Cloudflare image IDs cannot be reused. The original image was deleted and this reversed animation has a fresh ID.'
        : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reorder animation';
    const status = message.toLowerCase().includes('not animated') ? 400 : 500;
    console.error('[AnimationReorder] failed', error);
    return NextResponse.json({ error: message }, { status });
  }
}
