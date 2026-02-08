export const WORKFLOW_INTENT_TEXT_VERSION = 'v1';

const PROMPT_INPUT_KEYS = new Set([
  'text',
  'prompt',
  'positive',
  'negative',
  'caption',
  'description',
  'instructions',
  'conditioning',
]);

const IMPORTANT_SETTING_KEYS = [
  'steps',
  'cfg',
  'seed',
  'sampler_name',
  'scheduler',
  'denoise',
  'width',
  'height',
  'ckpt_name',
  'model',
] as const;

const MAX_PROMPT_CANDIDATE_LENGTH = 1_200;
const DEFAULT_INTENT_TEXT_MAX_LENGTH = 2_000;

type JsonRecord = Record<string, unknown>;

export type WorkflowImageDescription = {
  altText?: string;
  description?: string;
  aiCaption?: string;
};

export type NormalizedWorkflowNode = {
  id: string;
  classType: string;
  inputs: JsonRecord;
};

export type WorkflowIntentAnalysis = {
  normalizedNodes: NormalizedWorkflowNode[];
  promptCandidates: string[];
  nodeTypeSignatures: string[];
  nodeSettingSignatures: string[];
  workflowIntentText: string;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sanitizePromptCandidate(value: string): string | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return null;
  if (normalized.length > MAX_PROMPT_CANDIDATE_LENGTH) {
    return normalized.slice(0, MAX_PROMPT_CANDIDATE_LENGTH).trim();
  }
  return normalized;
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
}

function stableNodeIdSort(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);

  const leftIsNumeric = Number.isFinite(leftNumber);
  const rightIsNumeric = Number.isFinite(rightNumber);
  if (leftIsNumeric && rightIsNumeric) return leftNumber - rightNumber;
  if (leftIsNumeric) return -1;
  if (rightIsNumeric) return 1;
  return left.localeCompare(right);
}

function isObjectRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeApiNode(node: unknown): node is JsonRecord {
  if (!isObjectRecord(node)) return false;
  return typeof node.class_type === 'string' && isObjectRecord(node.inputs);
}

function isApiNodeMap(value: unknown): value is JsonRecord {
  if (!isObjectRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length === 0) return false;
  return entries.some(([, node]) => looksLikeApiNode(node));
}

function normalizeUiNode(node: unknown): NormalizedWorkflowNode | null {
  if (!isObjectRecord(node)) return null;

  const rawId = node.id;
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
  if (!id) return null;

  const classTypeCandidate = node.class_type ?? node.type;
  const classType = typeof classTypeCandidate === 'string' ? classTypeCandidate : 'UnknownNode';

  const normalizedInputs: JsonRecord = {};
  if (isObjectRecord(node.inputs)) {
    Object.assign(normalizedInputs, node.inputs);
  }

  if (Array.isArray(node.widgets_values) && node.widgets_values.length > 0) {
    normalizedInputs.widgets_values = node.widgets_values;
  }

  return {
    id,
    classType,
    inputs: normalizedInputs,
  };
}

export function normalizeWorkflowNodes(workflowJson: unknown): NormalizedWorkflowNode[] {
  if (isApiNodeMap(workflowJson)) {
    return Object.entries(workflowJson)
      .filter(([, node]) => looksLikeApiNode(node))
      .sort(([leftId], [rightId]) => stableNodeIdSort(leftId, rightId))
      .map(([id, node]) => {
        const typedNode = node as JsonRecord;
        return {
          id,
          classType: String(typedNode.class_type),
          inputs: isObjectRecord(typedNode.inputs) ? typedNode.inputs : {},
        };
      });
  }

  if (isObjectRecord(workflowJson)) {
    if (isApiNodeMap(workflowJson.prompt)) {
      return normalizeWorkflowNodes(workflowJson.prompt);
    }

    if (isObjectRecord(workflowJson.workflow)) {
      const nestedNodes = normalizeWorkflowNodes(workflowJson.workflow);
      if (nestedNodes.length > 0) return nestedNodes;
    }

    if (Array.isArray(workflowJson.nodes)) {
      return workflowJson.nodes
        .map((node) => normalizeUiNode(node))
        .filter((node): node is NormalizedWorkflowNode => Boolean(node))
        .sort((left, right) => stableNodeIdSort(left.id, right.id));
    }
  }

  return [];
}

function collectPromptLikeStrings(value: unknown, output: string[], depth = 0): void {
  if (depth > 3 || value === null || value === undefined) return;

  if (typeof value === 'string') {
    const sanitized = sanitizePromptCandidate(value);
    if (sanitized) output.push(sanitized);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 64)) {
      collectPromptLikeStrings(entry, output, depth + 1);
    }
    return;
  }

  if (isObjectRecord(value)) {
    const preferredKeys = ['text', 'prompt', 'positive', 'negative', 'caption', 'description'];
    for (const key of preferredKeys) {
      if (!(key in value)) continue;
      collectPromptLikeStrings(value[key], output, depth + 1);
    }
  }
}

export function extractPromptCandidates(nodes: NormalizedWorkflowNode[]): string[] {
  const candidates: string[] = [];

  for (const node of nodes) {
    const inputEntries = Object.entries(node.inputs).sort(([left], [right]) => left.localeCompare(right));

    for (const [inputKey, inputValue] of inputEntries) {
      const normalizedKey = inputKey.toLowerCase();
      const isPromptField =
        PROMPT_INPUT_KEYS.has(normalizedKey) ||
        node.classType.toLowerCase().includes('cliptextencode');

      if (!isPromptField) continue;
      collectPromptLikeStrings(inputValue, candidates);
    }
  }

  return dedupeCaseInsensitive(candidates);
}

function summarizeScalarValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = normalizeWhitespace(value);
    if (!normalized) return null;
    return normalized.length > 64 ? `${normalized.slice(0, 61)}...` : normalized;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    return value.length ? `[${value.length}]` : null;
  }

  return null;
}

export function extractNodeTypeSignatures(nodes: NormalizedWorkflowNode[]): string[] {
  const signatures = nodes
    .map((node) => normalizeWhitespace(node.classType))
    .filter(Boolean);

  return dedupeCaseInsensitive(signatures).sort((left, right) => left.localeCompare(right));
}

export function extractNodeSettingSignatures(nodes: NormalizedWorkflowNode[]): string[] {
  const signatures: string[] = [];

  for (const node of nodes) {
    const settingTokens: string[] = [];

    for (const key of IMPORTANT_SETTING_KEYS) {
      if (!(key in node.inputs)) continue;
      const summarized = summarizeScalarValue(node.inputs[key]);
      if (!summarized) continue;
      settingTokens.push(`${key}=${summarized}`);
    }

    if (settingTokens.length === 0) continue;
    signatures.push(`${node.classType}(${settingTokens.join(',')})`);
  }

  return dedupeCaseInsensitive(signatures).sort((left, right) => left.localeCompare(right));
}

export function buildImageDescriptionText(imageDescription?: WorkflowImageDescription): string {
  if (!imageDescription) return '';

  const parts = [imageDescription.altText, imageDescription.description, imageDescription.aiCaption]
    .map((part) => (typeof part === 'string' ? normalizeWhitespace(part) : ''))
    .filter(Boolean);

  return dedupeCaseInsensitive(parts).join(' | ');
}

function clampText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export function buildWorkflowIntentText(params: {
  promptCandidates: string[];
  imageDescription?: WorkflowImageDescription;
  nodeTypeSignatures: string[];
  nodeSettingSignatures: string[];
  maxLength?: number;
}): string {
  const maxLength = params.maxLength ?? DEFAULT_INTENT_TEXT_MAX_LENGTH;
  const lines: string[] = [];

  const promptText = params.promptCandidates.join(' | ');
  if (promptText) lines.push(`prompt_candidates: ${promptText}`);

  const imageDescriptionText = buildImageDescriptionText(params.imageDescription);
  if (imageDescriptionText) lines.push(`image_description: ${imageDescriptionText}`);

  if (params.nodeTypeSignatures.length > 0) {
    lines.push(`node_types: ${params.nodeTypeSignatures.join(', ')}`);
  }

  if (params.nodeSettingSignatures.length > 0) {
    lines.push(`node_settings: ${params.nodeSettingSignatures.join(' | ')}`);
  }

  const joined = lines.join('\n');
  return clampText(joined, maxLength);
}

export function analyzeWorkflowIntent(params: {
  workflowJson: unknown;
  imageDescription?: WorkflowImageDescription;
  maxLength?: number;
}): WorkflowIntentAnalysis {
  const normalizedNodes = normalizeWorkflowNodes(params.workflowJson);
  const promptCandidates = extractPromptCandidates(normalizedNodes);
  const nodeTypeSignatures = extractNodeTypeSignatures(normalizedNodes);
  const nodeSettingSignatures = extractNodeSettingSignatures(normalizedNodes);
  const workflowIntentText = buildWorkflowIntentText({
    promptCandidates,
    imageDescription: params.imageDescription,
    nodeTypeSignatures,
    nodeSettingSignatures,
    maxLength: params.maxLength,
  });

  return {
    normalizedNodes,
    promptCandidates,
    nodeTypeSignatures,
    nodeSettingSignatures,
    workflowIntentText,
  };
}
