import { verifyDemarkHostedOriginal } from './noAiDemarkHostedVerification';
import path from 'node:path';

import { getCachedImage } from '@/server/cloudflareImageCache';
import { getCloudflareCredentials } from '@/server/cloudflareClient';
import { getImageExtrasRecord, patchImageExtrasRecord } from '@/server/imageExtras';
import { downloadSourceImage } from '@/server/image-tools/sourceDownloader';
import {
  runNoAiDemark,
  type NoAiDemarkDevice,
  type NoAiDemarkMode,
  type NoAiDemarkModelProfile,
  type NoAiDemarkSettings,
} from '@/server/image-tools/noAiDemarkRunner';
import type { ImageToolAdapter, ImageToolControl, ImageToolRunResult } from '@/server/image-tools/types';
import { sanitizeFilename, uploadImageBuffer } from '@/server/uploadService';

const DEMARK_MODES = new Set<NoAiDemarkMode>(['demark', 'metadata']);
const MODEL_PROFILES = new Set<NoAiDemarkModelProfile>(['default', 'ctrlregen']);
const DEVICES = new Set<NoAiDemarkDevice>(['auto', 'cpu', 'mps', 'cuda']);

const DEMARK_CONTROLS: ImageToolControl[] = [
  {
    id: 'effectId',
    label: 'Process',
    type: 'select',
    defaultValue: 'demark',
    options: [
      { value: 'demark', label: 'Demark', helpText: 'Run local CtrlRegen and verify the finished file.' },
      { value: 'metadata', label: 'Metadata only', helpText: 'Strip AI metadata without regenerating pixels.' },
    ],
  },
  {
    id: 'params.strength',
    label: 'Strength',
    type: 'slider',
    defaultValue: 0.04,
    min: 0,
    max: 1,
    step: 0.01,
    group: 'general',
    effectIds: ['demark'],
    helpText: 'Low values retain the original image more closely.',
  },
  {
    id: 'params.steps',
    label: 'Inference Steps',
    type: 'number',
    defaultValue: 50,
    min: 1,
    max: 100,
    step: 1,
    group: 'general',
    effectIds: ['demark'],
  },
  {
    id: 'params.modelProfile',
    label: 'Model Profile',
    type: 'select',
    defaultValue: 'ctrlregen',
    group: 'general',
    effectIds: ['demark'],
    options: [
      { value: 'ctrlregen', label: 'CtrlRegen', helpText: 'Default profile; processes in chunks to reduce peak VRAM.' },
      { value: 'default', label: 'Default' },
    ],
  },
  {
    id: 'params.device',
    label: 'Device',
    type: 'select',
    defaultValue: 'auto',
    group: 'general',
    advanced: true,
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'mps', label: 'Apple Silicon' },
      { value: 'cuda', label: 'CUDA' },
      { value: 'cpu', label: 'CPU' },
    ],
  },
  {
    id: 'params.removeAllMetadata',
    label: 'Remove All Metadata',
    type: 'switch',
    defaultValue: false,
    group: 'general',
    advanced: true,
    helpText: 'Remove standard embedded metadata as well.',
  },
];

const manifest: ImageToolAdapter['manifest'] = {
  id: 'no-ai-demarker',
  label: 'No-AI Demarker',
  description: 'Clean AI metadata or regenerate pixels, with file and hosted-original verification.',
  adapterKind: 'noai-watermark',
  inputAssetTypes: ['image', 'animatedImage'],
  outputModes: ['still', 'animated'],
  supportsAsync: true,
  supportsPreview: false,
  presentation: {
    thumbnailUrl: '/image-tools/grainrad-preview.svg',
    shortDescription: 'PNG, JPEG, and WebP originals; animated WebP supports metadata cleanup.',
  },
  controls: DEMARK_CONTROLS,
  defaultRequest: {
    effectId: 'demark',
    params: {
      strength: 0.04,
      steps: 50,
      modelProfile: 'ctrlregen',
      device: 'auto',
      removeAllMetadata: false,
    },
    output: {
      mode: 'still',
      format: 'png',
    },
  },
};

const buildDemarkedFilename = (sourceFilename: string) => {
  const cleaned = sanitizeFilename(sourceFilename);
  const extension = path.extname(cleaned).toLowerCase();
  const stem = cleaned.slice(0, -extension.length).replace(/-demarked$/i, '') || 'Image';
  return `${stem}-demarked${extension}`;
};

const buildDisplayName = (sourceDisplayName: string | undefined, sourceFilename: string) => {
  const fallback = sourceFilename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Image';
  const base = (sourceDisplayName?.trim() || fallback).replace(/\s*[—-]\s*Demarked$/i, '').trim();
  return `${base} — Demarked`;
};

const mergeDemarkedTags = (sourceTags: string[]) => {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...sourceTags, 'demarked']) {
    const clean = tag.trim();
    const key = clean.toLocaleLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    merged.push(clean);
  }
  return merged;
};

const numberParam = (value: unknown, fallback: number, field: string, valid: (candidate: number) => boolean) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || !valid(value)) {
    throw new Error(`${field} has an invalid value`);
  }
  return value;
};

const stringParam = <T extends string>(value: unknown, fallback: T, values: Set<T>, field: string): T => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !values.has(value as T)) {
    throw new Error(`${field} must be one of: ${Array.from(values).join(', ')}`);
  }
  return value as T;
};

const settingsFromRequest = (effectId: string, params: Record<string, unknown>): NoAiDemarkSettings => {
  const mode = stringParam(effectId, 'demark', DEMARK_MODES, 'Process');
  const removeAllMetadata = params.removeAllMetadata === true;
  if (params.removeAllMetadata !== undefined && typeof params.removeAllMetadata !== 'boolean') {
    throw new Error('Remove All Metadata must be a boolean');
  }
  return {
    mode,
    strength: numberParam(params.strength, 0.04, 'Strength', (value) => value >= 0 && value <= 1),
    steps: numberParam(params.steps, 50, 'Inference Steps', (value) => Number.isInteger(value) && value >= 1),
    modelProfile: stringParam(params.modelProfile, 'ctrlregen', MODEL_PROFILES, 'Model Profile'),
    device: stringParam(params.device, 'auto', DEVICES, 'Device'),
    removeAllMetadata,
  };
};

const verifyUploadedChild = async (params: {
  childId: string;
  parentId: string;
  namespace: string;
  folder?: string;
  dimensions: { width: number; height: number };
}) => {
  const child = await getCachedImage(params.childId);
  if (!child) throw new Error(`Uploaded no-AI child ${params.childId} could not be read back`);
  if (child.parentId !== params.parentId) {
    throw new Error(`Uploaded no-AI child ${params.childId} is not linked to ${params.parentId}`);
  }
  if (child.namespace !== params.namespace) {
    throw new Error(`Uploaded no-AI child ${params.childId} is not in namespace ${params.namespace}`);
  }
  if (child.folder !== params.folder) {
    throw new Error(`Uploaded no-AI child ${params.childId} is not in folder ${params.folder || '(root)'}`);
  }
  if (child.dimensions?.width !== params.dimensions.width || child.dimensions?.height !== params.dimensions.height) {
    throw new Error(`Uploaded no-AI child ${params.childId} has invalid dimensions`);
  }
};

export const noAiDemarkAdapter: ImageToolAdapter = {
  manifest,
  async run({ imageId, request, updateRun, addEvent }): Promise<ImageToolRunResult> {
    const settings = settingsFromRequest(request.effectId, request.params);
    addEvent({ phase: 'source.download', message: 'Downloading source image for no-AI processing' });
    updateRun({ message: 'Downloading source image', percent: 0.1 });
    const source = await downloadSourceImage(imageId, { requireOriginal: true });
    const sourceRecord = await getCachedImage(imageId);
    if (!sourceRecord) throw new Error('Source image was not found in Photarium');
    if (!sourceRecord.namespace) throw new Error('Source image is missing namespace metadata');

    let outputFilename = buildDemarkedFilename(sourceRecord.filename || source.filename);
    const displayName = buildDisplayName(sourceRecord.displayName, sourceRecord.filename || source.filename);
    const sourceExtras = await getImageExtrasRecord(imageId);
    const parentId = sourceRecord.parentId || imageId;

    addEvent({
      phase: 'noai.process',
      message: settings.mode === 'demark'
        ? 'Running local no-AI demarker and verification'
        : 'Removing AI metadata and verifying the output',
      details: { mode: settings.mode, modelProfile: settings.modelProfile, steps: settings.steps },
    });
    updateRun({ message: 'Running local no-AI processing; this may take several minutes', percent: 0.45 });
    const artifact = await runNoAiDemark({
      imageId,
      sourceFilename: sourceRecord.filename || source.filename,
      sourceBuffer: source.buffer,
      outputFilename,
      settings,
    });

    outputFilename = artifact.filename;
    const description = sourceExtras?.description ?? sourceRecord.description;
    addEvent({
      phase: 'photarium.upload',
      message: 'Uploading processed child variant to Photarium',
      details: { filename: outputFilename, width: artifact.width, height: artifact.height },
    });
    updateRun({ message: 'Uploading processed child variant', percent: 0.82 });
    const { accountId, apiToken } = getCloudflareCredentials();
    const upload = await uploadImageBuffer({
      buffer: artifact.buffer,
      originalBuffer: source.buffer,
      fileName: outputFilename,
      fileType: artifact.contentType,
      fileSize: artifact.buffer.byteLength,
      context: {
        accountId,
        apiToken,
        folder: sourceExtras?.folder ?? sourceRecord.folder,
        tags: mergeDemarkedTags(sourceRecord.tags),
        displayName,
        altTag: sourceExtras?.altText ?? sourceRecord.altTag,
        description,
        originalUrl: sourceRecord.originalUrl ?? sourceExtras?.originalUrl,
        sourceUrl: sourceRecord.sourceUrl ?? sourceExtras?.sourceUrl,
        namespace: sourceRecord.namespace,
        parentId,
        // A requested run creates a new child even when cleanup produces identical bytes.
        duplicateAction: 'override',
      },
    });
    if (!upload.ok) throw new Error(upload.error);

    addEvent({ phase: 'photarium.verify', message: 'Verifying uploaded child metadata and original bytes' });
    updateRun({ message: 'Verifying uploaded child metadata', percent: 0.91 });
    await verifyUploadedChild({
      childId: upload.data.id,
      parentId,
      namespace: sourceRecord.namespace,
      folder: sourceExtras?.folder ?? sourceRecord.folder,
      dimensions: { width: artifact.width, height: artifact.height },
    });

    const hostedOriginalSha256 = await verifyDemarkHostedOriginal(upload.data.id, artifact.buffer);
    const output = { mode: artifact.frames > 1 ? 'animated' as const : 'still' as const, format: artifact.contentType.slice(6) };

    addEvent({ phase: 'extras.patch', message: 'Writing no-AI processing provenance', details: { generatedAssetId: upload.data.id } });
    updateRun({ message: 'Recording no-AI provenance', percent: 0.95 });
    await patchImageExtrasRecord(upload.data.id, {
      imageToolRun: {
        toolId: manifest.id,
        adapterKind: manifest.adapterKind,
        sourceImageId: imageId,
        effectId: settings.mode,
        params: {
          strength: settings.strength,
          steps: settings.steps,
          modelProfile: settings.modelProfile,
          device: settings.device,
          removeAllMetadata: settings.removeAllMetadata,
          aiMetadataPresent: artifact.verification.ai_metadata_present,
          verification: artifact.verification,
          hostedOriginalSha256,
          hostedOriginalMatches: true,
          dimensions: { width: artifact.width, height: artifact.height },
          parentId,
        },
        output,
        createdAt: new Date().toISOString(),
      },
      altText: sourceExtras?.altText ?? sourceRecord.altTag,
    });

    return {
      uploadedAsset: upload.data,
      artifact: { filename: outputFilename, contentType: artifact.contentType },
      metadata: {
        mode: settings.mode,
        modelProfile: settings.modelProfile,
        strength: settings.strength,
        steps: settings.steps,
        device: settings.device,
        removeAllMetadata: settings.removeAllMetadata,
        aiMetadataPresent: artifact.verification.ai_metadata_present,
          verification: artifact.verification,
          hostedOriginalSha256,
          hostedOriginalMatches: true,
        dimensions: { width: artifact.width, height: artifact.height },
        parentId,
      },
    };
  },
};
