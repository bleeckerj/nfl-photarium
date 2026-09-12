import type {
  ImageToolAdapter,
  ImageToolPreviewResult,
  ImageToolRequest,
  ImageToolRunResult,
} from '@/server/image-tools/types';
import type { CreativeBriefGenerationPlan } from '@/server/creativeBrief';
import { generateCreativeBriefThroughMcp } from '@/server/image-tools/creativeBriefMcp';

const sourceRelationships = [
  { value: 'brief_led', label: 'Follow brief' },
  { value: 'faithful_adaptation', label: 'Faithful adaptation' },
  { value: 'related_design', label: 'Related design' },
  { value: 'inspired_concept', label: 'Inspired concept' },
];

const providers = [
  { value: 'codex_imagegen', label: 'Codex imagegen' },
  { value: 'comfyui', label: 'ComfyUI' },
  { value: 'photarium_openai', label: 'Photarium OpenAI (run now)' },
];

const openAiModels = [
  { value: 'gpt-image-2.5-sunburst', label: 'Sunburst — precise generation and editing' },
  { value: 'gpt-image-2.5-flare', label: 'Flare — faster generation' },
];

const openAiQualities = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low — quick draft' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Maximum' },
];

const manifest = {
  id: 'creative-brief',
  label: 'Creative Brief',
  description: 'Prepare a direct prompt and provider handoff plan from this image.',
  adapterKind: 'creative-brief' as const,
  inputAssetTypes: ['image' as const],
  outputModes: ['still' as const],
  resultKinds: ['prompt' as const, 'image' as const],
  supportsAsync: false,
  presentation: {
    thumbnailUrl: '/image-tools/grainrad-preview.svg',
    shortDescription: 'Generate from Prompt This while retaining the original Photarium source.',
  },
  controls: [
    {
      id: 'params.prompt',
      label: 'Prompt',
      type: 'textarea' as const,
      required: true,
      group: 'brief',
      helpText: 'The prompt is passed to the provider unchanged.',
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
      defaultValue: 'photarium_openai',
      options: providers,
    },
    {
      id: 'params.model',
      label: 'OpenAI image model',
      type: 'select' as const,
      group: 'provider',
      defaultValue: 'gpt-image-2.5-sunburst',
      options: openAiModels,
      helpText: 'Sunburst favors precise edits. Flare favors speed.',
    },
    {
      id: 'params.quality',
      label: 'Quality',
      type: 'select' as const,
      group: 'output',
      defaultValue: 'high',
      options: openAiQualities,
    },
  ],
  defaultRequest: {
    effectId: 'creative-brief',
    params: {
      prompt: '',
      sourceRelationship: 'brief_led',
      aspectRatio: '',
      provider: 'photarium_openai',
      model: 'gpt-image-2.5-sunburst',
      quality: 'high',
    },
    output: { mode: 'still' as const, format: 'png' },
  },
};

function readParams(request: ImageToolRequest): {
  prompt: string;
  sourceRelationship?: string;
  aspectRatio?: string;
  provider?: string;
  model?: string;
  quality?: string;
} {
  const params = request.params;
  const promptValue = typeof params.prompt === 'string' ? params.prompt : params.creativeBrief;
  const prompt = typeof promptValue === 'string' ? promptValue : '';
  if (!prompt.trim()) throw new Error('Prompt is required');
  return {
    prompt,
    sourceRelationship: typeof params.sourceRelationship === 'string' ? params.sourceRelationship : undefined,
    aspectRatio: typeof params.aspectRatio === 'string' ? params.aspectRatio.trim() || undefined : undefined,
    provider: typeof params.provider === 'string' ? params.provider : undefined,
    model: typeof params.model === 'string' ? params.model : undefined,
    quality: typeof params.quality === 'string' ? params.quality : undefined,
  };
}

async function prepare(imageId: string, request: ImageToolRequest): Promise<{
  prompt: string;
  plan: CreativeBriefGenerationPlan;
  generatedId?: string;
  generatedUrl?: string;
  metadataEnrichment?: unknown;
  mcpResult?: Record<string, unknown>;
}> {
  const params = readParams(request);
  if (params.provider === 'photarium_openai') {
    const result = await generateCreativeBriefThroughMcp({
      imageId,
      prompt: params.prompt,
      sourceRelationship: params.sourceRelationship,
      aspectRatio: params.aspectRatio,
      provider: 'photarium_openai',
      model: params.model,
      quality: params.quality,
      outputFormat: request.output.format,
    });
    const plan = result.plan as CreativeBriefGenerationPlan | undefined;
    const generated = result.result as Record<string, unknown> | undefined;
    const generatedId = typeof generated?.imageId === 'string' ? generated.imageId : undefined;
    const generatedUrl = typeof generated?.url === 'string' ? generated.url : undefined;
    if (!plan || !generatedId) throw new Error('Photarium MCP generation returned no uploaded child image');
    return {
      prompt: params.prompt,
      plan,
      generatedId,
      generatedUrl,
      metadataEnrichment: result.metadataEnrichment,
      mcpResult: result,
    };
  }
  const baseUrl = process.env.PHOTARIUM_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const response = await fetch(new URL(`/api/images/${encodeURIComponent(imageId)}/prompt/handoff`, baseUrl), {
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
    addEvent({ phase: 'creative-brief.prepare', message: 'Preparing image generation' });
    updateRun({ message: 'Preparing image generation', percent: 0.15 });
    const result = await prepare(imageId, request);
    if (result.generatedId) {
      addEvent({ phase: 'creative-brief.generated', message: 'Photarium image generation completed', details: { imageId: result.generatedId } });
      updateRun({ message: 'Photarium image generation completed', percent: 1 });
      return {
        kind: 'image',
        state: 'uploaded',
        prompt: result.prompt,
        plan: result.plan,
        uploadedAsset: {
          id: result.generatedId,
          filename: result.generatedId,
          url: result.generatedUrl || '',
          variants: [],
          uploaded: new Date().toISOString(),
          tags: [],
        },
        metadata: { metadataEnrichment: result.metadataEnrichment, mcpResult: result.mcpResult },
      };
    }
    addEvent({ phase: 'creative-brief.handoff', message: 'Provider handoff plan ready' });
    updateRun({ message: 'Provider handoff plan ready', percent: 1 });
    return { kind: 'prompt', state: 'handoff', prompt: result.prompt, plan: result.plan };
  },
  async preview({ imageId, request, updatePreview, addEvent }): Promise<ImageToolPreviewResult> {
    addEvent({ phase: 'creative-brief.prepare', message: 'Deriving creative-brief prompt' });
    updatePreview({ message: 'Deriving creative-brief prompt', percent: 0.5 });
    const result = await prepare(imageId, request);
    addEvent({ phase: 'creative-brief.handoff', message: 'Provider handoff plan ready' });
    updatePreview({ message: 'Provider handoff plan ready', percent: 1 });
    return { kind: 'prompt', state: 'handoff', prompt: result.prompt, plan: result.plan };
  },
};
