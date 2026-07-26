import { patchImageExtrasRecord } from '@/server/imageExtras';
import { uploadImageToolArtifactToPhotarium } from '@/server/image-tools/artifactUpload';
import { downloadSourceImage } from '@/server/image-tools/sourceDownloader';
import {
  getImageToolPreview,
  getImageToolPreviewArtifact,
} from '@/server/image-tools/previewStore';
import { getImageToolRegistry } from '@/server/image-tools/registry';
import type { ImageToolRunResult } from '@/server/image-tools/types';

export const acceptImageToolPreviewArtifact = async (previewId: string): Promise<ImageToolRunResult & {
  preview: NonNullable<ReturnType<typeof getImageToolPreview>>;
}> => {
  const preview = getImageToolPreview(previewId);
  if (!preview) {
    throw new Error('Image tool preview was not found or has expired');
  }
  if (preview.status !== 'completed') {
    throw new Error('Only completed image tool previews can be accepted');
  }
  const artifact = getImageToolPreviewArtifact(previewId);
  if (!artifact) {
    throw new Error('Completed image tool preview does not have an artifact to accept');
  }

  const registry = getImageToolRegistry();
  const adapter = registry.getAdapter(preview.toolId);
  if (!adapter) {
    throw new Error(`Unknown image tool: ${preview.toolId}`);
  }

  const source = await downloadSourceImage(preview.imageId);
  const uploadedAsset = adapter.uploadArtifact
    ? await adapter.uploadArtifact({
        sourceImageId: preview.imageId,
        sourceFilename: source.filename,
        sourceBuffer: source.buffer,
        artifact,
        request: preview.request,
        metadata: preview.metadata,
      })
    : await uploadImageToolArtifactToPhotarium({
        sourceImageId: preview.imageId,
        sourceFilename: source.filename,
        sourceBuffer: source.buffer,
        artifact,
        request: preview.request,
      });

  const metadata = preview.metadata && typeof preview.metadata === 'object' && !Array.isArray(preview.metadata)
    ? preview.metadata
    : {};
  const metadataParams = metadata.params && typeof metadata.params === 'object' && !Array.isArray(metadata.params)
    ? metadata.params as Record<string, unknown>
    : Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== 'output'));
  const metadataOutput = metadata.output && typeof metadata.output === 'object' && !Array.isArray(metadata.output)
    ? metadata.output as Record<string, unknown>
    : {};

  await patchImageExtrasRecord(uploadedAsset.id, {
    imageToolRun: {
      toolId: adapter.manifest.id,
      adapterKind: adapter.manifest.adapterKind,
      sourceImageId: preview.imageId,
      effectId: preview.request.effectId,
      paramPreset: preview.request.workflow?.styleStrength ?? preview.request.paramPreset,
      params: { ...preview.request.params, ...metadataParams },
      output: { ...preview.request.output, ...metadataOutput },
      externalJobId: typeof metadata.externalJobId === 'string' ? metadata.externalJobId : preview.externalJobId,
      createdAt: new Date().toISOString(),
    },
  });

  return {
    preview,
    uploadedAsset,
    artifact: {
      filename: artifact.filename,
      contentType: artifact.contentType,
    },
  };
};
