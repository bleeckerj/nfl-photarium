import { patchImageExtrasRecord } from '@/server/imageExtras';
import {
  renderGrainradArtifact,
  type GrainradRenderProgress,
} from '@/server/image-tools/grainradEngine';
import { uploadImageToolArtifactToPhotarium } from '@/server/image-tools/artifactUpload';
import { downloadSourceImage } from '@/server/image-tools/sourceDownloader';
import { createGrainradManifest } from '@/server/image-tools/grainradManifest';
import type {
  ImageToolDiagnosticEventInput,
  ImageToolAdapter,
  ImageToolOutputMode,
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

const cleanProgressDetails = (progress: GrainradRenderProgress): ImageToolDiagnosticEventInput['details'] => {
  if (!progress.details) return undefined;
  return Object.fromEntries(
    Object.entries(progress.details).filter((entry): entry is [string, string | number | boolean | null] => (
      entry[1] !== undefined
    ))
  );
};

const buildProgressEvent = (progress: GrainradRenderProgress): ImageToolDiagnosticEventInput => ({
  phase: `grainrad.${progress.phase}`,
  message: progress.message,
  details: cleanProgressDetails(progress),
});

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
    const artifact = await renderGrainradArtifact(source.buffer, request, {
      onProgress: (progress) => {
        addEvent(buildProgressEvent(progress));
        updatePreview({
          message: progress.message,
          percent: progress.percent,
        });
      },
    });

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
    const artifact = await renderGrainradArtifact(source.buffer, request, {
      onProgress: (progress) => {
        addEvent(buildProgressEvent(progress));
        updateRun({
          message: progress.message,
          percent: progress.percent,
        });
      },
    });

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
    const uploadedAsset = await uploadImageToolArtifactToPhotarium({
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
