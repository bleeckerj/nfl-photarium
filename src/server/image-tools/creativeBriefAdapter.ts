import type {
  ImageToolAdapter,
  ImageToolPreviewResult,
  ImageToolRequest,
  ImageToolRunResult,
} from '@/server/image-tools/types';
import type { CreativeBriefGenerationPlan } from '@/server/creativeBrief';

const sourceRelationships = [
  { value: 'brief_led', label: 'Follow brief' },
  { value: 'faithful_adaptation', label: 'Faithful adaptation' },
  { value: 'related_design', label: 'Related design' },
  { value: 'inspired_concept', label: 'Inspired concept' },
];

const providers = [
  { value: 'codex_imagegen', label: 'Codex imagegen' },
  { value: 'comfyui', label: 'ComfyUI' },
  { value: 'photarium_openai', label: 'Photarium OpenAI' },
];

const manifest = {
  id: 'creative-brief',
  label: 'Creative Brief',
  description: 'Derive a transformation prompt and provider handoff plan from this image.',
  adapterKind: 'creative-brief' as const,
  inputAssetTypes: ['image' as const],
  outputModes: ['still' as const],
  resultKinds: ['prompt' as const],
  supportsAsync: false,
  presentation: {
    thumbnailUrl: '/image-tools/grainrad-preview.svg',
    shortDescription: 'Rebrand, restyle, re-era, or reinterpret a catalog image through a freeform brief.',
  },
  controls: [
    {
      id: 'params.creativeBrief',
      label: 'Creative brief',
      type: 'textarea' as const,
      required: true,
      group: 'brief',
      helpText: 'Describe the transformation direction, source traits to preserve, and changes to introduce.',
      defaultValue: '',
    },
    {
      id: 'params.sourceRelationship',
      label: 'Source relationship',
      type: 'select' as const,
      group: 'brief',
      defaultValue: 'brief_led',
      options: sourceRelationships,
    },
    {
      id: 'params.aspectRatio',
      label: 'Aspect ratio',
      type: 'text' as const,
      group: 'output',
      helpText: 'Optional target such as 1:1, 4:5, 16:9, or 9:16.',
      defaultValue: '',
    },
    {
      id: 'params.provider',
      label: 'Provider handoff',
      type: 'select' as const,
      group: 'provider',
      defaultValue: 'codex_imagegen',
      options: providers,
    },
    {
      id: 'params.saveAsCurrent',
      label: 'Save as current Prompt This',
      type: 'switch' as const,
      group: 'output',
      defaultValue: false,
      helpText: 'Keep this off to preserve the canonical recreation prompt.',
    },
  ],
  defaultRequest: {
    effectId: 'creative-brief',
    params: {
      creativeBrief: '',
      sourceRelationship: 'brief_led',
      aspectRatio: '',
      provider: 'codex_imagegen',
      saveAsCurrent: false,
    },
    output: { mode: 'still' as const, format: 'png' },
  },
};

function readParams(request: ImageToolRequest): {
  creativeBrief: string;
  sourceRelationship?: string;
  aspectRatio?: string;
  provider?: string;
  saveAsCurrent?: boolean;
} {
  const params = request.params;
  const creativeBrief = typeof params.creativeBrief === 'string' ? params.creativeBrief.trim() : '';
  if (!creativeBrief) throw new Error('Creative brief is required');
  return {
    creativeBrief,
    sourceRelationship: typeof params.sourceRelationship === 'string' ? params.sourceRelationship : undefined,
    aspectRatio: typeof params.aspectRatio === 'string' ? params.aspectRatio.trim() || undefined : undefined,
    provider: typeof params.provider === 'string' ? params.provider : undefined,
    saveAsCurrent: Boolean(params.saveAsCurrent),
  };
}

async function prepare(imageId: string, request: ImageToolRequest): Promise<{
  prompt: string;
  plan: CreativeBriefGenerationPlan;
}> {
  const params = readParams(request);
  const baseUrl = process.env.PHOTARIUM_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const response = await fetch(new URL(`/api/images/${encodeURIComponent(imageId)}/prompt`, baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Creative brief prompt generation failed');
  if (typeof payload.prompt !== 'string' || !payload.plan) throw new Error('Creative brief prompt generation returned no plan');
  return { prompt: payload.prompt, plan: payload.plan as CreativeBriefGenerationPlan };
}

export const creativeBriefAdapter: ImageToolAdapter = {
  manifest,
  async run({ imageId, request, updateRun, addEvent }): Promise<ImageToolRunResult> {
    addEvent({ phase: 'creative-brief.prepare', message: 'Deriving creative-brief prompt' });
    updateRun({ message: 'Deriving creative-brief prompt', percent: 0.5 });
    const result = await prepare(imageId, request);
    addEvent({ phase: 'creative-brief.handoff', message: 'Provider handoff plan ready' });
    updateRun({ message: 'Provider handoff plan ready', percent: 1 });
    return { kind: 'prompt', prompt: result.prompt, plan: result.plan };
  },
  async preview({ imageId, request, updatePreview, addEvent }): Promise<ImageToolPreviewResult> {
    addEvent({ phase: 'creative-brief.prepare', message: 'Deriving creative-brief prompt' });
    updatePreview({ message: 'Deriving creative-brief prompt', percent: 0.5 });
    const result = await prepare(imageId, request);
    addEvent({ phase: 'creative-brief.handoff', message: 'Provider handoff plan ready' });
    updatePreview({ message: 'Provider handoff plan ready', percent: 1 });
    return { kind: 'prompt', prompt: result.prompt, plan: result.plan };
  },
};
