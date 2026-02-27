import type { ComfyParamMap, ComfyPromptTexts, ComfyWorkflowRecord } from '@/components/image-detail/comfy/types';

const MODE_FLAG_RULES: Array<{ label: string; test: (s: string) => boolean }> = [
  { label: 'img2img', test: (s) => s.includes('img2img') || s.includes('vaeencode') },
  { label: 'inpaint', test: (s) => s.includes('inpaint') },
  { label: 'controlnet', test: (s) => s.includes('controlnet') },
  { label: 'upscale', test: (s) => s.includes('upscale') || s.includes('esrgan') },
];

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseNumberish(value: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function isNumericOnlyText(value: string): boolean {
  return /^[\d.\-+]+$/.test(value.trim());
}

function looksLikePromptPhrase(value: string): boolean {
  const text = value.trim();
  if (text.length < 4) return false;
  if (isNumericOnlyText(text)) return false;
  if (!/[a-zA-Z]/.test(text)) return false;
  const hasPhraseShape = /[\s,;:()]/.test(text) || text.split(/\s+/).length >= 2;
  return hasPhraseShape || text.length >= 12;
}

function firstRegexValue(lines: string[], patterns: RegExp[]): string | undefined {
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      const value = match?.[1]?.trim();
      if (value) return value;
    }
  }
  return undefined;
}

function deriveModeFlags(nodeTypes: string[]): string[] {
  const lowered = nodeTypes.map((v) => v.toLowerCase());
  const joined = lowered.join(' | ');
  return MODE_FLAG_RULES.filter((rule) => rule.test(joined)).map((rule) => rule.label);
}

function walkObject(
  value: unknown,
  visitor: (key: string, value: unknown) => void,
  depth = 0
) {
  if (depth > 8 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => walkObject(item, visitor, depth + 1));
    return;
  }
  for (const [key, next] of Object.entries(value as Record<string, unknown>)) {
    visitor(key, next);
    walkObject(next, visitor, depth + 1);
  }
}

function fallbackFromWorkflowJson(workflowJson: unknown): Partial<ComfyParamMap> {
  let checkpoint: string | undefined;
  let sampler: string | undefined;
  let scheduler: string | undefined;
  let steps: number | undefined;
  let cfg: number | undefined;
  let seed: number | undefined;
  let denoise: number | undefined;
  let width: number | undefined;
  let height: number | undefined;

  walkObject(workflowJson, (key, rawValue) => {
    const k = key.toLowerCase();
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number') return;
    const text = String(rawValue).trim();
    if (!text) return;
    const num = parseNumberish(text);

    if (!checkpoint && (k === 'ckpt_name' || k === 'checkpoint' || k === 'model')) checkpoint = text;
    if (!sampler && (k === 'sampler_name' || k === 'sampler')) sampler = text;
    if (!scheduler && k === 'scheduler') scheduler = text;
    if (steps === undefined && k === 'steps' && num !== undefined) steps = num;
    if (cfg === undefined && (k === 'cfg' || k === 'cfg_scale') && num !== undefined) cfg = num;
    if (seed === undefined && k === 'seed' && num !== undefined) seed = num;
    if (denoise === undefined && (k === 'denoise' || k === 'denoise_strength') && num !== undefined) denoise = num;
    if (width === undefined && k === 'width' && num !== undefined) width = num;
    if (height === undefined && k === 'height' && num !== undefined) height = num;
  });

  return { checkpoint, sampler, scheduler, steps, cfg, seed, denoise, width, height };
}

export function selectComfyParams(record: ComfyWorkflowRecord | null): ComfyParamMap {
  const nodeTypes = Array.isArray(record?.nodeTypeSignatures) ? record!.nodeTypeSignatures.filter(Boolean) : [];
  const nodeSettings = Array.isArray(record?.nodeSettingSignatures) ? record!.nodeSettingSignatures.filter(Boolean) : [];

  const checkpoint = firstRegexValue(nodeSettings, [
    /(?:ckpt_name|checkpoint|model)\s*[:=]\s*([^\|]+)/i,
  ]);
  const sampler = firstRegexValue(nodeSettings, [/sampler(?:_name)?\s*[:=]\s*([^\|]+)/i]);
  const scheduler = firstRegexValue(nodeSettings, [/scheduler\s*[:=]\s*([^\|]+)/i]);
  const stepsText = firstRegexValue(nodeSettings, [/steps\s*[:=]\s*([0-9.]+)/i]);
  const cfgText = firstRegexValue(nodeSettings, [/(?:cfg|cfg_scale)\s*[:=]\s*([0-9.]+)/i]);
  const seedText = firstRegexValue(nodeSettings, [/seed\s*[:=]\s*([0-9]+)/i]);
  const denoiseText = firstRegexValue(nodeSettings, [/denoise(?:_strength)?\s*[:=]\s*([0-9.]+)/i]);
  const widthText = firstRegexValue(nodeSettings, [/width\s*[:=]\s*([0-9]+)/i]);
  const heightText = firstRegexValue(nodeSettings, [/height\s*[:=]\s*([0-9]+)/i]);

  const fallback = fallbackFromWorkflowJson(record?.workflowJson);

  return {
    checkpoint: checkpoint || fallback.checkpoint,
    sampler: sampler || fallback.sampler,
    scheduler: scheduler || fallback.scheduler,
    steps: parseNumberish(stepsText || '') ?? fallback.steps,
    cfg: parseNumberish(cfgText || '') ?? fallback.cfg,
    seed: parseNumberish(seedText || '') ?? fallback.seed,
    denoise: parseNumberish(denoiseText || '') ?? fallback.denoise,
    width: parseNumberish(widthText || '') ?? fallback.width,
    height: parseNumberish(heightText || '') ?? fallback.height,
    modeFlags: deriveModeFlags(nodeTypes),
  };
}

export function selectPromptCandidates(record: ComfyWorkflowRecord | null): string[] {
  const raw = Array.isArray(record?.promptCandidates) ? record!.promptCandidates : [];
  const unique = new Set<string>();
  for (const item of raw) {
    const text = normalizeText(item);
    if (!text) continue;
    unique.add(text);
  }
  return Array.from(unique);
}

type ClipPromptCandidate = { text: string; role: 'positive' | 'negative' | 'other' };

function detectNegativeRole(nodeLabel: string, text: string): boolean {
  const hay = `${nodeLabel} ${text}`.toLowerCase();
  return hay.includes('negative');
}

function extractClipTextEncodePrompts(workflowJson: unknown): ClipPromptCandidate[] {
  const found: ClipPromptCandidate[] = [];
  const push = (nodeLabel: string, textValue: unknown) => {
    const text = normalizeText(textValue);
    if (!text) return;
    if (!looksLikePromptPhrase(text)) return;
    found.push({
      text,
      role: detectNegativeRole(nodeLabel, text) ? 'negative' : 'positive',
    });
  };

  walkObject(workflowJson, (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const obj = value as Record<string, unknown>;
    const classType = normalizeText(obj.class_type || obj.type || obj.class || obj.title);
    if (!classType.toLowerCase().includes('cliptextencode')) return;

    const nodeLabel = classType;
    const inputs = obj.inputs;
    if (inputs && typeof inputs === 'object' && !Array.isArray(inputs)) {
      const inputText = (inputs as Record<string, unknown>).text;
      push(nodeLabel, inputText);
    }

    const widgets = obj.widgets_values;
    if (Array.isArray(widgets)) {
      for (const w of widgets) {
        if (typeof w === 'string') push(nodeLabel, w);
      }
    }
  });

  const deduped = new Map<string, ClipPromptCandidate>();
  for (const item of found) {
    const key = item.text.trim();
    if (!key) continue;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }
    // Prefer negative label if any occurrence signals negative.
    if (existing.role !== 'negative' && item.role === 'negative') {
      deduped.set(key, item);
    }
  }
  return Array.from(deduped.values());
}

function derivePromptTextsFromStoredCandidates(promptCandidates: string[]): ComfyPromptTexts {
  const filtered = promptCandidates.filter(looksLikePromptPhrase);
  const deduped = Array.from(new Set(filtered));
  const negatives = deduped.filter((text) => text.toLowerCase().includes('negative'));
  const positiveLike = deduped.filter((text) => !negatives.includes(text));
  const primary = positiveLike[0] || deduped[0] || null;
  const negative = negatives[0] || null;
  const others = deduped.filter((text) => text !== primary && text !== negative);
  return {
    primary,
    negative,
    others,
    totalPromptLikeCount: [primary, negative, ...others].filter(Boolean).length,
    rawExtractedCount: promptCandidates.length,
    source: deduped.length ? 'storedCandidates' : 'none',
  };
}

export function selectPromptTexts(record: ComfyWorkflowRecord | null): ComfyPromptTexts {
  const storedCandidates = selectPromptCandidates(record);
  const clipPrompts = extractClipTextEncodePrompts(record?.workflowJson);

  if (clipPrompts.length > 0) {
    const negative = clipPrompts.find((p) => p.role === 'negative')?.text || null;
    const primary = clipPrompts.find((p) => p.role === 'positive')?.text || clipPrompts[0]?.text || null;
    const others = clipPrompts
      .map((p) => p.text)
      .filter((text) => text !== primary && text !== negative);
    return {
      primary,
      negative,
      others,
      totalPromptLikeCount: [primary, negative, ...others].filter(Boolean).length,
      rawExtractedCount: storedCandidates.length,
      source: 'cliptextencode',
    };
  }

  return derivePromptTextsFromStoredCandidates(storedCandidates);
}

export function safePrettyJson(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}
