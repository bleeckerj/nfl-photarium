import { getCloudflareCredentials } from '@/server/cloudflareClient';
import { getCachedImage } from '@/server/cloudflareImageCache';
import { getImageExtrasRecord, patchImageExtrasRecord } from '@/server/imageExtras';
import { getUserVisibleTags } from '@/utils/systemTags';
import { uploadImageBuffer } from '@/server/uploadService';
import { uploadVideoBuffer } from '@/server/videoUploadService';
import { renderGrainradArtifact, type GrainradArtifact } from '@/server/image-tools/grainradEngine';
import { downloadSourceImage } from '@/server/image-tools/sourceDownloader';
import { createGrainradManifest } from '@/server/image-tools/grainradManifest';
import type {
  ImageToolAdapter,
  ImageToolOutputMode,
  ImageToolRequest,
  ImageToolPreviewResult,
  ImageToolRunResult,
} from '@/server/image-tools/types';

const manifest = createGrainradManifest();

const assertOutputFormat = (mode: ImageToolOutputMode, format: string) => {
  const normalized = format.toLowerCase();
  const stillFormats = new Set(['png', 'webp', 'jpg', 'jpeg']);
  const animatedFormats = new Set(['gif', 'webp', 'mp4']);
  if (mode === 'still' && !stillFormats.has(normalized)) {
    throw new Error(`Still Grainrad exports do not support ${format}`);
  }
  if (mode === 'animated' && !animatedFormats.has(normalized)) {
    throw new Error(`Animated Grainrad exports do not support ${format}`);
  }
};

const buildOutputFilename = (sourceFilename: string, request: ImageToolRequest, artifactFilename: string) => {
  const extension = artifactFilename.includes('.') ? artifactFilename.split('.').pop() : request.output.format;
  const stem = sourceFilename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '_') || 'image';
  return `${stem}-grainrad-${request.effectId}.${extension || request.output.format}`;
};

const uploadArtifactToPhotarium = async (params: {
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

export const grainradAdapter: ImageToolAdapter = {
  manifest,
  async preview({ imageId, request, updatePreview, addEvent }): Promise<ImageToolPreviewResult> {
    assertOutputFormat(request.output.mode, request.output.format);

    addEvent({ phase: 'source.download', message: 'Downloading source image for preview' });
    updatePreview({ message: 'Downloading source image', percent: 0.1 });
    const source = await downloadSourceImage(imageId);

    addEvent({ phase: 'source.decode', message: 'Decoding source image' });
    addEvent({
      phase: 'grainrad.render',
      message: request.output.mode === 'animated'
        ? 'Rendering Grainrad animated preview in-process'
        : 'Rendering Grainrad preview in-process',
    });
    updatePreview({ message: 'Rendering Grainrad preview', percent: 0.5 });
    const artifact = await renderGrainradArtifact(source.buffer, request);

    addEvent({
      phase: 'preview.ready',
      message: 'Preview artifact ready',
      details: {
        contentType: artifact.contentType,
        filename: artifact.filename,
        bytes: artifact.buffer.byteLength,
      },
    });

    return { artifact };
  },
  async run({ imageId, request, updateRun, addEvent }): Promise<ImageToolRunResult> {
    assertOutputFormat(request.output.mode, request.output.format);

    addEvent({ phase: 'source.download', message: 'Downloading source image' });
    updateRun({ message: 'Downloading source image', percent: 0.1 });
    const source = await downloadSourceImage(imageId);

    addEvent({ phase: 'source.decode', message: 'Decoding source image' });
    addEvent({
      phase: 'grainrad.render',
      message: request.output.mode === 'animated'
        ? 'Rendering Grainrad animated export in-process'
        : 'Rendering Grainrad still in-process',
    });
    updateRun({ message: 'Rendering Grainrad effect', percent: 0.5 });
    const artifact = await renderGrainradArtifact(source.buffer, request);

    addEvent({
      phase: 'photarium.upload',
      message: 'Uploading generated asset to Photarium',
      details: {
        contentType: artifact.contentType,
        filename: artifact.filename,
        bytes: artifact.buffer.byteLength,
      },
    });
    updateRun({ message: 'Uploading generated asset to Photarium', percent: 0.9 });
    const uploadedAsset = await uploadArtifactToPhotarium({
      sourceImageId: imageId,
      sourceFilename: source.filename,
      sourceBuffer: source.buffer,
      artifact,
      request,
    });

    addEvent({
      phase: 'extras.patch',
      message: 'Writing image tool provenance',
      details: { generatedAssetId: uploadedAsset.id },
    });
    await patchImageExtrasRecord(uploadedAsset.id, {
      imageToolRun: {
        toolId: manifest.id,
        adapterKind: manifest.adapterKind,
        sourceImageId: imageId,
        effectId: request.effectId,
        paramPreset: request.paramPreset,
        params: request.params,
        output: request.output,
        createdAt: new Date().toISOString(),
      },
    });

    return {
      uploadedAsset,
      artifact: {
        filename: artifact.filename,
        contentType: artifact.contentType,
      },
    };
  },
};
