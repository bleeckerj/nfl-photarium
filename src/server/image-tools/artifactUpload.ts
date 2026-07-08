import { getCloudflareCredentials } from '@/server/cloudflareClient';
import { getCachedImage } from '@/server/cloudflareImageCache';
import { getImageExtrasRecord } from '@/server/imageExtras';
import { getUserVisibleTags } from '@/utils/systemTags';
import { uploadImageBuffer } from '@/server/uploadService';
import { uploadVideoBuffer } from '@/server/videoUploadService';
import type { GrainradArtifact } from '@/server/image-tools/grainradEngine';
import type { ImageToolRequest } from '@/server/image-tools/types';

const buildOutputFilename = (sourceFilename: string, request: ImageToolRequest, artifactFilename: string) => {
  const extension = artifactFilename.includes('.') ? artifactFilename.split('.').pop() : request.output.format;
  const stem = sourceFilename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '_') || 'image';
  return `${stem}-grainrad-${request.effectId}.${extension || request.output.format}`;
};

export const uploadImageToolArtifactToPhotarium = async (params: {
  sourceImageId: string;
  sourceFilename: string;
  sourceBuffer: Buffer;
  artifact: GrainradArtifact;
  request: ImageToolRequest;
}) => {
  const source = await getCachedImage(params.sourceImageId);
  if (!source) {
    throw new Error('Source image was not found in Photarium');
  }
  const extras = await getImageExtrasRecord(params.sourceImageId);
  const namespace = source.namespace;
  if (!namespace) {
    throw new Error('Source image is missing namespace metadata');
  }
  const { accountId, apiToken } = getCloudflareCredentials();

  const outputFilename = buildOutputFilename(params.sourceFilename, params.request, params.artifact.filename);
  const commonContext = {
    accountId,
    apiToken,
    folder: extras?.folder ?? source.folder,
    tags: Array.from(new Set([
      ...getUserVisibleTags(source.tags),
      'grainrad',
      'image-tool',
      params.request.effectId,
    ])),
    description: `Generated with Grainrad ${params.request.effectId}`,
    displayName: outputFilename,
    namespace,
    parentId: params.sourceImageId,
  };

  if (params.artifact.contentType === 'video/mp4') {
    const outcome = await uploadVideoBuffer({
      buffer: params.artifact.buffer,
      fileName: outputFilename,
      fileType: params.artifact.contentType,
      fileSize: params.artifact.buffer.byteLength,
      context: commonContext,
    });
    if (!outcome.ok) {
      throw new Error(outcome.error);
    }
    return outcome.data;
  }

  const outcome = await uploadImageBuffer({
    buffer: params.artifact.buffer,
    originalBuffer: params.sourceBuffer,
    fileName: outputFilename,
    fileType: params.artifact.contentType,
    fileSize: params.artifact.buffer.byteLength,
    context: {
      ...commonContext,
      duplicateAction: 'family',
    },
  });
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
  return outcome.data;
};
