import {
  createEffectsApi,
  createPhotariumEightBitReinterpretationManifest,
} from 'nfl-grainrad-clone';

import { getImageExtrasRecord, patchImageExtrasRecord } from '@/server/imageExtras';
import { uploadImageToolArtifactToPhotarium } from '@/server/image-tools/artifactUpload';
import { downloadSourceImage } from '@/server/image-tools/sourceDownloader';
import { renderEightBitWorkflowArtifact } from '@/server/image-tools/eightBitWorkflow';
import type {
  ImageToolAdapter,
  ImageToolControl,
  ImageToolPreviewResult,
  ImageToolRunResult,
} from '@/server/image-tools/types';

const STILL_OUTPUT_FORMATS = new Set(['png', 'webp', 'jpg', 'jpeg']);

const EIGHT_BIT_VARIATION_CONTROLS: ImageToolControl[] = [
  {
    id: 'workflow.colorDepth',
    label: 'Color Depth',
    type: 'select',
    defaultValue: 'classic',
    group: 'workflow',
    effectIds: ['eight-bit'],
    helpText: 'Palette size guidance for the generated pixel-art pass and final Grainrad constraint pass.',
    options: [
      { value: 'minimal', label: 'Minimal', helpText: 'About 8-10 colors with sparse ramps.' },
      { value: 'classic', label: 'Classic', helpText: 'About 12-14 colors with controlled ramps.' },
      { value: 'rich', label: 'Rich', helpText: 'About 14-16 colors with broader color families.' },
      { value: 'expanded', label: 'Expanded', helpText: 'About 18-24 colors while keeping a pixel-art palette.' },
    ],
  },
  {
    id: 'workflow.pixelScale',
    label: 'Pixel Size',
    type: 'select',
    defaultValue: 'medium',
    group: 'workflow',
    effectIds: ['eight-bit'],
    helpText: 'Controls perceived block size by guiding the prompt and Grainrad working bitmap.',
    options: [
      { value: 'fine', label: 'Fine', helpText: 'Smaller blocks with more shape detail.' },
      { value: 'medium', label: 'Medium', helpText: 'Balanced home-console pixel size.' },
      { value: 'chunky', label: 'Chunky', helpText: 'Larger blocks and more simplified silhouettes.' },
      { value: 'blocky', label: 'Blocky', helpText: 'Very low working resolution with large visible tiles.' },
    ],
  },
];

const filterStillOutputFormatOptions = (control: ImageToolControl): ImageToolControl => {
  if (control.id !== 'output.format') return control;
  return {
    ...control,
    options: control.options?.filter((option) => STILL_OUTPUT_FORMATS.has(String(option.value).toLowerCase())),
  };
};

const createManifest = () => {
  const manifest = createPhotariumEightBitReinterpretationManifest({
    api: createEffectsApi(),
    presentation: {
      thumbnailUrl: '/image-tools/grainrad-preview.svg',
      previewUrl: '/image-tools/grainrad-preview.svg',
      previewMimeType: 'image/svg+xml',
    },
  }) as ImageToolAdapter['manifest'];

  return {
    ...manifest,
    controls: manifest.controls
      .flatMap((control) => (
        control.id === 'workflow.promptHint'
          ? [...EIGHT_BIT_VARIATION_CONTROLS, control]
          : [control]
      ))
      .map(filterStillOutputFormatOptions),
  };
};

const manifest = createManifest();

const assertOutputFormat = (format: string) => {
  const normalized = format.toLowerCase();
  if (!STILL_OUTPUT_FORMATS.has(normalized)) {
    throw new Error(`8-bit reinterpretation exports do not support ${format}`);
  }
};

export const eightBitAdapter: ImageToolAdapter = {
  manifest,
  async preview({ imageId, request, updatePreview, addEvent }): Promise<ImageToolPreviewResult> {
    assertOutputFormat(request.output.format);

    addEvent({ phase: 'source.download', message: 'Downloading source image for 8-bit preview' });
    updatePreview({ message: 'Downloading source image', percent: 0.1 });
    const source = await downloadSourceImage(imageId);

    addEvent({ phase: 'grainrad-eight-bit.render', message: 'Running 8-bit reinterpretation workflow preview' });
    const artifact = await renderEightBitWorkflowArtifact(source.buffer, request, {
      sourceImageId: imageId,
      onProgress: (progress) => {
        addEvent({
          phase: `grainrad-eight-bit.${progress.phase}`,
          message: progress.message,
          details: progress.details,
        });
        updatePreview({
          message: progress.message,
          percent: progress.percent,
        });
      },
    });

    addEvent({
      phase: 'preview.ready',
      message: '8-bit preview artifact ready',
      details: {
        contentType: artifact.contentType,
        filename: artifact.filename,
        bytes: artifact.buffer.byteLength,
      },
    });
    return { artifact };
  },
  async run({ imageId, request, updateRun, addEvent }): Promise<ImageToolRunResult> {
    assertOutputFormat(request.output.format);

    addEvent({ phase: 'source.download', message: 'Downloading source image for 8-bit workflow' });
    updateRun({ message: 'Downloading source image', percent: 0.1 });
    const source = await downloadSourceImage(imageId);

    addEvent({ phase: 'grainrad-eight-bit.render', message: 'Running 8-bit reinterpretation workflow' });
    const artifact = await renderEightBitWorkflowArtifact(source.buffer, request, {
      sourceImageId: imageId,
      onProgress: (progress) => {
        addEvent({
          phase: `grainrad-eight-bit.${progress.phase}`,
          message: progress.message,
          details: progress.details,
        });
        updateRun({
          message: progress.message,
          percent: progress.percent,
        });
      },
    });

    addEvent({
      phase: 'photarium.upload',
      message: 'Uploading generated 8-bit asset to Photarium',
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
      message: 'Writing 8-bit image tool provenance',
      details: { generatedAssetId: uploadedAsset.id },
    });
    const sourceExtras = await getImageExtrasRecord(imageId);
    await patchImageExtrasRecord(uploadedAsset.id, {
      imageToolRun: {
        toolId: manifest.id,
        adapterKind: manifest.adapterKind,
        sourceImageId: imageId,
        effectId: request.effectId,
        paramPreset: request.workflow?.styleStrength ?? request.paramPreset,
        params: request.params,
        output: request.output,
        createdAt: new Date().toISOString(),
      },
      promptThis: sourceExtras?.promptThis,
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
