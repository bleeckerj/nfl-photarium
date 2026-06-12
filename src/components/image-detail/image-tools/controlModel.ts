import type {
  ImageToolControl,
  ImageToolManifest,
  ImageToolRequest,
} from '@/services/imageToolsService';

export type ToolValues = Record<string, string | number | boolean>;

export type ControlGroup = {
  id: string;
  label: string;
  advanced: boolean;
  controls: ImageToolControl[];
};

const GROUP_LABELS: Record<string, string> = {
  output: 'Output',
  presets: 'Presets',
  animation: 'Animation',
  general: 'General',
  tone: 'Tone',
  color: 'Color',
  signal: 'Signal',
  glow: 'Glow',
  'signal-wave': 'Signal Wave',
  'vertical-hold': 'Vertical Hold',
  'tracking-skew': 'Tracking Skew',
  'diagonal-tear': 'Diagonal Tear',
  'rgb-mask': 'RGB Mask',
  blocks: 'Blocks',
  timing: 'Timing',
  tearing: 'Tearing',
  dropout: 'Dropout',
  snow: 'Snow',
  scanlines: 'Scanlines',
};

const GROUP_ORDER = [
  'output',
  'presets',
  'general',
  'tone',
  'color',
  'signal',
  'scanlines',
  'animation',
  'blocks',
  'tearing',
  'dropout',
  'glow',
  'signal-wave',
  'vertical-hold',
  'tracking-skew',
  'diagonal-tear',
  'rgb-mask',
  'timing',
  'snow',
];

const STILL_OUTPUT_FORMATS = new Set(['png', 'webp', 'jpg', 'jpeg']);
const ANIMATED_OUTPUT_FORMATS = new Set(['gif', 'webp', 'mp4']);

const pathGroupFallback = (path: string) => {
  if (path === 'effectId') return 'output';
  if (path === 'paramPreset') return 'presets';
  if (path.startsWith('output.')) return 'output';
  if (path.startsWith('timeline.')) return 'animation';
  if (path.startsWith('renderContext.')) return 'animation';
  return 'general';
};

export const valueFromRequest = (request: ImageToolRequest, path: string) => {
  const parts = path.split('.');
  let current: unknown = request;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

export const buildInitialValues = (tool: ImageToolManifest): ToolValues => {
  const values: ToolValues = {};
  tool.controls.forEach((control) => {
    const existing = valueFromRequest(tool.defaultRequest, control.id);
    const value = existing ?? control.defaultValue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      values[control.id] = value;
    }
  });
  return values;
};

const assignPath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const parts = path.split('.');
  let current = target;
  parts.slice(0, -1).forEach((part) => {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  });
  current[parts[parts.length - 1]] = value;
};

export const buildRequest = (tool: ImageToolManifest, values: ToolValues): ImageToolRequest => {
  const request = {
    ...(JSON.parse(JSON.stringify(tool.defaultRequest)) as ImageToolRequest),
    params: {},
  };
  const controls = groupVisibleControls(tool, values).flatMap((group) => group.controls);
  const hasParamPreset = typeof values.paramPreset === 'string' && values.paramPreset.trim().length > 0;

  controls.forEach((control) => {
    const value = values[control.id] ?? control.defaultValue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return;
    if (hasParamPreset && control.id.startsWith('params.') && Object.is(value, control.defaultValue)) return;
    assignPath(request as unknown as Record<string, unknown>, control.id, value);
  });

  if (typeof request.paramPreset === 'string' && !request.paramPreset.trim()) {
    delete request.paramPreset;
  }
  return request;
};

export const normalizeControlValue = (control: ImageToolControl, value: string | boolean) => {
  if (control.type === 'switch') return Boolean(value);
  if (control.type === 'number' || control.type === 'slider') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number(control.defaultValue ?? 0);
  }
  return String(value);
};

const selectedEffectId = (tool: ImageToolManifest, values: ToolValues) => {
  const value = values.effectId ?? tool.defaultRequest.effectId;
  return typeof value === 'string' && value.trim() ? value : tool.defaultRequest.effectId;
};

const filterControlOptions = (control: ImageToolControl, effectId: string): ImageToolControl => {
  if (control.id !== 'paramPreset') return control;
  const options = (control.options ?? []).filter((option) => !option.effectId || option.effectId === effectId);
  return { ...control, options };
};

const isVisibleForEffect = (control: ImageToolControl, effectId: string) => {
  if (control.id === 'paramPreset') {
    return (control.options ?? []).some((option) => option.effectId === effectId);
  }
  if (!control.effectIds?.length) return true;
  return control.effectIds.includes(effectId);
};

export const updateToolValues = (
  tool: ImageToolManifest,
  values: ToolValues,
  control: ImageToolControl,
  rawValue: string | boolean
): ToolValues => {
  const next = {
    ...values,
    [control.id]: normalizeControlValue(control, rawValue),
  };

  if (control.id === 'effectId') {
    next.paramPreset = '';
  }

  if (control.id === 'output.mode') {
    const currentFormat = String(next['output.format'] ?? tool.defaultRequest.output.format);
    if (next['output.mode'] === 'animated' && !ANIMATED_OUTPUT_FORMATS.has(currentFormat)) {
      next['output.format'] = 'webp';
    }
    if (next['output.mode'] === 'still' && !STILL_OUTPUT_FORMATS.has(currentFormat)) {
      next['output.format'] = 'png';
    }
  }

  return next;
};

export const groupVisibleControls = (tool: ImageToolManifest, values: ToolValues): ControlGroup[] => {
  const effectId = selectedEffectId(tool, values);
  const groupMap = new Map<string, ControlGroup>();

  for (const control of tool.controls) {
    const filteredControl = filterControlOptions(control, effectId);
    if (!isVisibleForEffect(filteredControl, effectId)) continue;

    const groupId = filteredControl.group ?? pathGroupFallback(filteredControl.id);
    const group = groupMap.get(groupId) ?? {
      id: groupId,
      label: GROUP_LABELS[groupId] ?? groupId,
      advanced: Boolean(filteredControl.advanced),
      controls: [],
    };
    group.advanced = group.advanced || Boolean(filteredControl.advanced);
    group.controls.push(filteredControl);
    groupMap.set(groupId, group);
  }

  return Array.from(groupMap.values()).sort((a, b) => {
    const aIndex = GROUP_ORDER.indexOf(a.id);
    const bIndex = GROUP_ORDER.indexOf(b.id);
    return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex)
      - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
  });
};
