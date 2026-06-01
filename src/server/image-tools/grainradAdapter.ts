import { basename } from 'node:path';

import { fetchCloudflareImage, getCloudflareCredentials } from '@/server/cloudflareClient';
import { getCachedImage } from '@/server/cloudflareImageCache';
import { getImageExtrasRecord, patchImageExtrasRecord } from '@/server/imageExtras';
import { getUserVisibleTags } from '@/utils/systemTags';
import { uploadImageBuffer } from '@/server/uploadService';
import { uploadVideoBuffer } from '@/server/videoUploadService';
import type {
  ImageToolAdapter,
  ImageToolDiagnosticEventInput,
  ImageToolManifest,
  ImageToolOutputMode,
  ImageToolRequest,
  ImageToolPreviewResult,
  ImageToolRunResult,
} from '@/server/image-tools/types';

type GrainradArtifact = {
  filename?: string;
  url?: string;
  contentType?: string;
};

type GrainradRenderResponse = {
  ok?: boolean;
  artifact?: GrainradArtifact;
  metadata?: unknown;
  error?: { message?: string } | string;
};

type GrainradJobResponse = {
  ok?: boolean;
  job?: {
    id?: string;
    status?: 'queued' | 'running' | 'completed' | 'failed';
    message?: string;
    percent?: number;
    result?: GrainradRenderResponse;
    error?: { message?: string } | string;
  };
  error?: { message?: string } | string;
};

const DEFAULT_GRAINRAD_BASE_URL = 'http://127.0.0.1:4177';
const DEFAULT_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1_000;

const manifest: ImageToolManifest = {
  id: 'grainrad',
  label: 'Grainrad Effects',
  description: 'Render Grainrad-style still and animated image effects from the selected asset.',
  adapterKind: 'grainrad-http',
  inputAssetTypes: ['image'],
  outputModes: ['still', 'animated'],
  supportsAsync: true,
  presentation: {
    thumbnailUrl: '/image-tools/grainrad-preview.svg',
    previewUrl: '/image-tools/grainrad-preview.svg',
    previewMimeType: 'image/svg+xml',
    shortDescription: 'Analog grain, scanlines, threshold, and dithering passes.',
  },
  controls: [
    {
      id: 'effectId',
      label: 'Effect',
      type: 'select',
      required: true,
      defaultValue: 'vhs',
      options: [
        { value: 'vhs', label: 'VHS' },
        { value: 'threshold', label: 'Threshold' },
        { value: 'dithering', label: 'Dithering' },
      ],
    },
    {
      id: 'output.mode',
      label: 'Output',
      type: 'select',
      required: true,
      defaultValue: 'still',
      options: [
        { value: 'still', label: 'Still image' },
        { value: 'animated', label: 'Animated export' },
      ],
    },
    {
      id: 'output.format',
      label: 'Format',
      type: 'select',
      required: true,
      defaultValue: 'png',
      options: [
        { value: 'png', label: 'PNG' },
        { value: 'webp', label: 'WebP' },
        { value: 'jpg', label: 'JPEG' },
        { value: 'gif', label: 'GIF' },
        { value: 'mp4', label: 'MP4' },
      ],
      helpText: 'Still exports support PNG, WebP, and JPEG. Animated exports support GIF, WebP, and MP4.',
    },
    {
      id: 'output.preset',
      label: 'Quality',
      type: 'select',
      defaultValue: 'balanced',
      options: [
        { value: 'preview', label: 'Preview' },
        { value: 'balanced', label: 'Balanced' },
        { value: 'high-quality', label: 'High quality' },
      ],
    },
    {
      id: 'timeline.durationMs',
      label: 'Duration',
      type: 'slider',
      defaultValue: 2400,
      min: 500,
      max: 8000,
      step: 100,
      helpText: 'Animated exports only.',
    },
    {
      id: 'timeline.fps',
      label: 'FPS',
      type: 'slider',
      defaultValue: 12,
      min: 4,
      max: 30,
      step: 1,
      helpText: 'Animated exports only.',
    },
    {
      id: 'timeline.loop',
      label: 'Loop',
      type: 'switch',
      defaultValue: true,
      helpText: 'Animated WebP/GIF exports only.',
    },
    {
      id: 'params.threshold',
      label: 'Threshold',
      type: 'slider',
      defaultValue: 128,
      min: 0,
      max: 255,
      step: 1,
      helpText: 'Used by the Threshold effect.',
    },
    {
      id: 'params.mode',
      label: 'Dither mode',
      type: 'select',
      defaultValue: 'bayer4x4',
      options: [
        { value: 'bayer2x2', label: 'Bayer 2x2' },
        { value: 'bayer4x4', label: 'Bayer 4x4' },
        { value: 'bayer8x8', label: 'Bayer 8x8' },
        { value: 'floydSteinberg', label: 'Floyd-Steinberg' },
      ],
      helpText: 'Used by the Dithering effect.',
    },
    {
      id: 'params.noiseAmount',
      label: 'Noise',
      type: 'slider',
      defaultValue: 0.3,
      min: 0,
      max: 1,
      step: 0.05,
      helpText: 'Used by the VHS effect.',
    },
    {
      id: 'params.scanlineIntensity',
      label: 'Scanlines',
      type: 'slider',
      defaultValue: 0.3,
      min: 0,
      max: 1,
      step: 0.05,
      helpText: 'Used by the VHS effect.',
    },
    {
      id: 'params.bleed',
      label: 'Color bleed',
      type: 'slider',
      defaultValue: 0.5,
      min: 0,
      max: 1,
      step: 0.05,
      helpText: 'Used by the VHS effect.',
    },
    {
      id: 'params.rgbSplit',
      label: 'RGB split',
      type: 'slider',
      defaultValue: 0,
      min: 0,
      max: 12,
      step: 1,
      helpText: 'Used by the VHS effect.',
    },
    {
      id: 'renderContext.seed',
      label: 'Seed',
      type: 'number',
      defaultValue: 1337,
      min: 0,
      step: 1,
    },
  ],
  defaultRequest: {
    effectId: 'vhs',
    params: {
      threshold: 128,
      mode: 'bayer4x4',
      noiseAmount: 0.3,
      scanlineIntensity: 0.3,
      bleed: 0.5,
      rgbSplit: 0,
    },
    output: {
      mode: 'still',
      format: 'png',
      preset: 'balanced',
    },
    timeline: {
      durationMs: 2400,
      fps: 12,
      loop: true,
    },
    renderContext: {
      seed: 1337,
    },
  },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getGrainradBaseUrl = () =>
  (process.env.GRAINRAD_BASE_URL || DEFAULT_GRAINRAD_BASE_URL).replace(/\/+$/, '');

const getErrorMessage = (value: unknown, fallback: string) => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string') {
    return (value as { message: string }).message;
  }
  return fallback;
};

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

const downloadOriginalImage = async (imageId: string) => {
  const { accountId, apiToken } = getCloudflareCredentials();
  const source = await fetchCloudflareImage(imageId, { accountId, apiToken });
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}/blob`,
    {
      headers: { Authorization: `Bearer ${apiToken}` },
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to download source image from Cloudflare (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType,
    filename: source.filename || `${imageId}.bin`,
  };
};

const postMultipart = async (url: string, fields: Record<string, unknown>, file: {
  buffer: Buffer;
  contentType: string;
  filename: string;
}) => {
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.contentType }), file.filename);
  Object.entries(fields).forEach(([key, value]) => {
    formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  });
  const response = await fetch(url, { method: 'POST', body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(getErrorMessage((payload as { error?: unknown }).error, `Grainrad request failed (${response.status})`));
  }
  return payload;
};

const waitForGrainradJob = async (
  baseUrl: string,
  jobId: string,
  updateRun: (patch: { message?: string; percent?: number; externalJobId?: string }) => void,
  addEvent: (event: ImageToolDiagnosticEventInput) => void
): Promise<GrainradRenderResponse> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DEFAULT_TIMEOUT_MS) {
    const response = await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
    const payload = (await response.json().catch(() => ({}))) as GrainradJobResponse;
    if (!response.ok) {
      throw new Error(getErrorMessage(payload.error, `Grainrad job status failed (${response.status})`));
    }
    const job = payload.job;
    updateRun({
      externalJobId: jobId,
      message: job?.message || `Grainrad job ${job?.status || 'running'}`,
      percent: typeof job?.percent === 'number' ? job.percent : undefined,
    });
    addEvent({
      phase: 'grainrad.poll',
      message: job?.message || `Grainrad job ${job?.status || 'running'}`,
      details: {
        externalJobId: jobId,
        status: job?.status || null,
        percent: typeof job?.percent === 'number' ? job.percent : null,
      },
    });
    if (job?.status === 'completed') {
      return job.result || {};
    }
    if (job?.status === 'failed') {
      throw new Error(getErrorMessage(job.error, job.message || 'Grainrad job failed'));
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Timed out waiting for Grainrad export');
};

const downloadArtifact = async (baseUrl: string, artifact: GrainradArtifact) => {
  if (!artifact.url) {
    throw new Error('Grainrad did not return an artifact URL');
  }
  const artifactUrl = artifact.url.startsWith('http')
    ? artifact.url
    : `${baseUrl}${artifact.url.startsWith('/') ? '' : '/'}${artifact.url}`;
  const response = await fetch(artifactUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to download Grainrad artifact (${response.status})`);
  }
  const contentType = response.headers.get('content-type') || artifact.contentType || 'application/octet-stream';
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType,
    filename: artifact.filename || basename(artifact.url) || 'grainrad-output.png',
  };
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
  artifact: { buffer: Buffer; contentType: string; filename: string };
  request: ImageToolRequest;
  externalJobId?: string;
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

  const outputFilename = buildOutputFilename(params.sourceFilename, params.request, params.artifact.filename);
  const commonContext = {
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
    assertOutputFormat('still', request.output.format);
    const baseUrl = getGrainradBaseUrl();
    const previewRequest: ImageToolRequest = {
      ...request,
      output: {
        ...request.output,
        mode: 'still',
        preset: 'preview',
      },
      timeline: { mode: 'still' } as ImageToolRequest['timeline'],
    };

    addEvent({ phase: 'source.download', message: 'Downloading source image for preview' });
    updatePreview({ message: 'Downloading source image', percent: 0.1 });
    const source = await downloadOriginalImage(imageId);

    const fields = {
      effectId: previewRequest.effectId,
      params: previewRequest.params,
      renderContext: previewRequest.renderContext ?? {},
      output: previewRequest.output,
      timeline: { mode: 'still' },
    };

    addEvent({ phase: 'grainrad.submit', message: 'Submitting Grainrad preview render' });
    updatePreview({ message: 'Submitting Grainrad preview', percent: 0.35 });
    const grainradResult = (await postMultipart(`${baseUrl}/api/render`, fields, source)) as GrainradRenderResponse;
    if (!grainradResult.artifact) {
      throw new Error('Grainrad did not return an artifact');
    }

    addEvent({ phase: 'artifact.download', message: 'Downloading Grainrad preview artifact' });
    updatePreview({ message: 'Downloading Grainrad preview', percent: 0.75 });
    const artifact = await downloadArtifact(baseUrl, grainradResult.artifact);
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
    const baseUrl = getGrainradBaseUrl();
    let externalJobId: string | undefined;

    addEvent({ phase: 'source.download', message: 'Downloading source image' });
    updateRun({ message: 'Downloading source image', percent: 0.05 });
    const source = await downloadOriginalImage(imageId);

    const fields = {
      effectId: request.effectId,
      params: request.params,
      renderContext: request.renderContext ?? {},
      output: request.output,
      timeline: request.output.mode === 'animated'
        ? {
            mode: 'animated',
            sourceTimeMode: 'synthetic',
            ...(request.timeline ?? {}),
          }
        : { mode: 'still' },
    };

    addEvent({
      phase: 'grainrad.submit',
      message: request.output.mode === 'animated' ? 'Submitting Grainrad export job' : 'Submitting Grainrad still render',
    });
    updateRun({ message: 'Submitting Grainrad render', percent: 0.12 });
    const grainradResult = request.output.mode === 'animated'
      ? await (async () => {
          const queued = (await postMultipart(`${baseUrl}/api/export`, fields, source)) as { jobId?: string };
          if (!queued.jobId) {
            throw new Error('Grainrad did not return a job id');
          }
          externalJobId = queued.jobId;
          addEvent({
            phase: 'grainrad.queued',
            message: 'Grainrad export job queued',
            details: { externalJobId: queued.jobId },
          });
          return waitForGrainradJob(baseUrl, queued.jobId, updateRun, addEvent);
        })()
      : (await postMultipart(`${baseUrl}/api/render`, fields, source)) as GrainradRenderResponse;

    if (!grainradResult.artifact) {
      throw new Error('Grainrad did not return an artifact');
    }

    addEvent({ phase: 'artifact.download', message: 'Downloading Grainrad artifact' });
    updateRun({ message: 'Downloading Grainrad artifact', percent: 0.84 });
    const artifact = await downloadArtifact(baseUrl, grainradResult.artifact);

    addEvent({
      phase: 'photarium.upload',
      message: 'Uploading generated asset to Photarium',
      details: {
        contentType: artifact.contentType,
        filename: artifact.filename,
        bytes: artifact.buffer.byteLength,
      },
    });
    updateRun({ message: 'Uploading generated asset to Photarium', percent: 0.92 });
    const uploadedAsset = await uploadArtifactToPhotarium({
      sourceImageId: imageId,
      sourceFilename: source.filename,
      sourceBuffer: source.buffer,
      artifact,
      request,
      externalJobId,
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
        params: request.params,
        output: request.output,
        externalJobId,
        createdAt: new Date().toISOString(),
      },
    });

    return {
      uploadedAsset,
      artifact: {
        filename: artifact.filename,
        contentType: artifact.contentType,
      },
      externalJobId,
    };
  },
};
