import {
  createEffectsApi,
  createPhotariumImageToolManifest,
  type EffectsApi,
} from 'nfl-grainrad-clone';

import type { ImageToolControl, ImageToolControlOption, ImageToolManifest } from '@/server/image-tools/types';

const PHOTARIUM_GRAINRAD_EFFECT_IDS = [
  'vhs',
  'threshold',
  'dithering',
  'halftone',
  'bit-glitch',
  'rgb-subpixel-display',
];

const BASE_CONTROL_IDS = new Set([
  'effectId',
  'paramPreset',
  'output.mode',
  'output.format',
  'output.preset',
  'timeline.durationMs',
  'timeline.fps',
  'timeline.loop',
  'renderContext.seed',
]);

const ADVANCED_GROUPS = new Set([
  'glow',
  'signal-wave',
  'vertical-hold',
  'tracking-skew',
  'diagonal-tear',
  'rgb-mask',
  'snow',
  'timing',
]);

type GrainradParameter = {
  group?: string;
};

type GrainradDescription = {
  id: string;
  parameters?: Record<string, GrainradParameter>;
};

const isGrainradDescription = (value: unknown): value is GrainradDescription => (
  Boolean(value)
    && typeof value === 'object'
    && typeof (value as { id?: unknown }).id === 'string'
);

const optionEffectIds = (options?: ImageToolControlOption[]) =>
  Array.from(new Set(
    (options ?? [])
      .map((option) => option.effectId)
      .filter((effectId): effectId is string => Boolean(effectId))
  ));

const normalizePhotariumManifest = (value: unknown): ImageToolManifest => value as ImageToolManifest;

const buildParameterIndex = (api: EffectsApi) => {
  const index = new Map<string, { effectIds: Set<string>; groups: Set<string> }>();

  for (const effectId of PHOTARIUM_GRAINRAD_EFFECT_IDS) {
    const description = api.describeEffect(effectId);
    if (!isGrainradDescription(description)) continue;

    for (const [name, parameter] of Object.entries(description.parameters ?? {})) {
      const current = index.get(name) ?? { effectIds: new Set<string>(), groups: new Set<string>() };
      current.effectIds.add(effectId);
      if (parameter.group) current.groups.add(parameter.group);
      index.set(name, current);
    }
  }

  return index;
};

const annotateControl = (
  control: ImageToolControl,
  parameterIndex: Map<string, { effectIds: Set<string>; groups: Set<string> }>
): ImageToolControl => {
  if (control.id === 'paramPreset') {
    const effectIds = optionEffectIds(control.options);
    return {
      ...control,
      group: 'presets',
      effectIds,
      advanced: false,
    };
  }

  if (BASE_CONTROL_IDS.has(control.id)) {
    return {
      ...control,
      group: control.id.startsWith('timeline.') ? 'animation' : 'output',
      advanced: false,
    };
  }

  if (!control.id.startsWith('params.')) return control;

  const paramName = control.id.slice('params.'.length);
  const metadata = parameterIndex.get(paramName);
  const groups = Array.from(metadata?.groups ?? []);
  const group = groups[0] ?? 'general';
  return {
    ...control,
    group,
    effectIds: Array.from(metadata?.effectIds ?? []),
    advanced: ADVANCED_GROUPS.has(group),
  };
};

export const createGrainradManifest = (): ImageToolManifest => {
  const api = createEffectsApi();
  const manifest = normalizePhotariumManifest(createPhotariumImageToolManifest({
    api,
    defaultEffectId: 'vhs',
    effectIds: PHOTARIUM_GRAINRAD_EFFECT_IDS,
    presentation: {
      thumbnailUrl: '/image-tools/grainrad-preview.svg',
      previewUrl: '/image-tools/grainrad-preview.svg',
      previewMimeType: 'image/svg+xml',
      shortDescription: 'Analog VHS, threshold, dithering, halftone, bit-glitch, and RGB display passes.',
    },
  }));
  const parameterIndex = buildParameterIndex(api);

  return {
    ...manifest,
    controls: manifest.controls.map((control) => annotateControl(control, parameterIndex)),
    defaultRequest: {
      ...manifest.defaultRequest,
      effectId: 'vhs',
      paramPreset: undefined,
    },
  };
};

