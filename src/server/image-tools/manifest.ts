import type {
  ImageToolControl,
  ImageToolControlType,
  ImageToolManifest,
  ImageToolOutputMode,
  ImageToolRequest,
} from '@/server/image-tools/types';

const CONTROL_TYPES = new Set<ImageToolControlType>([
  'text',
  'number',
  'slider',
  'switch',
  'select',
  'color',
]);

const OUTPUT_MODES = new Set<ImageToolOutputMode>(['still', 'animated']);

export class ImageToolManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageToolManifestError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const assertNonEmptyString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ImageToolManifestError(`Image tool manifest requires ${field}`);
  }
};

const validateControl = (control: ImageToolControl, toolId: string) => {
  assertNonEmptyString(control.id, `${toolId}.controls[].id`);
  assertNonEmptyString(control.label, `${toolId}.controls[${control.id}].label`);
  if (!CONTROL_TYPES.has(control.type)) {
    throw new ImageToolManifestError(`Image tool ${toolId} has unsupported control type: ${control.type}`);
  }
  if (control.type === 'select' && (!Array.isArray(control.options) || control.options.length === 0)) {
    throw new ImageToolManifestError(`Image tool ${toolId} select control ${control.id} requires options`);
  }
};

export const validateImageToolManifest = (manifest: ImageToolManifest): ImageToolManifest => {
  assertNonEmptyString(manifest.id, 'id');
  assertNonEmptyString(manifest.label, `${manifest.id}.label`);
  assertNonEmptyString(manifest.description, `${manifest.id}.description`);
  assertNonEmptyString(manifest.adapterKind, `${manifest.id}.adapterKind`);
  if (!isRecord(manifest.presentation)) {
    throw new ImageToolManifestError(`Image tool ${manifest.id} requires presentation`);
  }
  assertNonEmptyString(manifest.presentation.thumbnailUrl, `${manifest.id}.presentation.thumbnailUrl`);

  if (!Array.isArray(manifest.inputAssetTypes) || manifest.inputAssetTypes.length === 0) {
    throw new ImageToolManifestError(`Image tool ${manifest.id} requires inputAssetTypes`);
  }

  if (!Array.isArray(manifest.outputModes) || manifest.outputModes.length === 0) {
    throw new ImageToolManifestError(`Image tool ${manifest.id} requires outputModes`);
  }
  manifest.outputModes.forEach((mode) => {
    if (!OUTPUT_MODES.has(mode)) {
      throw new ImageToolManifestError(`Image tool ${manifest.id} has unsupported output mode: ${mode}`);
    }
  });

  if (!Array.isArray(manifest.controls)) {
    throw new ImageToolManifestError(`Image tool ${manifest.id} requires controls`);
  }
  manifest.controls.forEach((control) => validateControl(control, manifest.id));

  const request = manifest.defaultRequest;
  if (!isRecord(request)) {
    throw new ImageToolManifestError(`Image tool ${manifest.id} requires defaultRequest`);
  }
  assertNonEmptyString((request as ImageToolRequest).effectId, `${manifest.id}.defaultRequest.effectId`);
  if (!isRecord((request as ImageToolRequest).params)) {
    throw new ImageToolManifestError(`Image tool ${manifest.id} requires defaultRequest.params`);
  }
  if (!isRecord((request as ImageToolRequest).output)) {
    throw new ImageToolManifestError(`Image tool ${manifest.id} requires defaultRequest.output`);
  }
  const output = (request as ImageToolRequest).output;
  if (!OUTPUT_MODES.has(output.mode)) {
    throw new ImageToolManifestError(`Image tool ${manifest.id} has unsupported default output mode: ${output.mode}`);
  }
  assertNonEmptyString(output.format, `${manifest.id}.defaultRequest.output.format`);

  return manifest;
};

export const mergeImageToolRequest = (
  defaults: ImageToolRequest,
  incoming: {
    effectId?: string;
    paramPreset?: string;
    params?: Record<string, unknown>;
    output?: Partial<ImageToolRequest['output']>;
    timeline?: ImageToolRequest['timeline'];
    renderContext?: ImageToolRequest['renderContext'];
    workflow?: ImageToolRequest['workflow'];
  }
): ImageToolRequest => {
  const mode = incoming.output?.mode ?? defaults.output.mode;
  if (!OUTPUT_MODES.has(mode)) {
    throw new ImageToolManifestError(`Unsupported output mode: ${mode}`);
  }

  return {
    effectId: typeof incoming.effectId === 'string' && incoming.effectId.trim()
      ? incoming.effectId.trim()
      : defaults.effectId,
    paramPreset: typeof incoming.paramPreset === 'string'
      ? incoming.paramPreset.trim() || undefined
      : defaults.paramPreset,
    params: {
      ...defaults.params,
      ...(isRecord(incoming.params) ? incoming.params : {}),
    },
    output: {
      ...defaults.output,
      ...(isRecord(incoming.output) ? incoming.output : {}),
      mode,
      format: typeof incoming.output?.format === 'string' && incoming.output.format.trim()
        ? incoming.output.format.trim().toLowerCase()
        : defaults.output.format,
    },
    timeline: {
      ...defaults.timeline,
      ...(isRecord(incoming.timeline) ? incoming.timeline : {}),
    },
    renderContext: {
      ...defaults.renderContext,
      ...(isRecord(incoming.renderContext) ? incoming.renderContext : {}),
    },
    workflow: isRecord(defaults.workflow) || isRecord(incoming.workflow)
      ? {
          ...(isRecord(defaults.workflow) ? defaults.workflow : {}),
          ...(isRecord(incoming.workflow) ? incoming.workflow : {}),
        }
      : undefined,
  };
};
