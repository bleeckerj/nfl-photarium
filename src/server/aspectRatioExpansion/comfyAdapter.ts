import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

import type {
  AspectRatioExpansionAdapter,
  AspectRatioExpansionProviderStatus,
} from '@/server/aspectRatioExpansion/types';

type ComfyConfig = {
  baseUrl: string;
  workflowPath: string;
  outputNode: string;
  imageNode: string;
  aspectNode: string;
  positiveNode: string;
  negativeNode: string;
  seedNode?: string;
  pollMs: number;
  timeoutMs: number;
};

type ComfyNode = {
  inputs?: Record<string, unknown>;
};

export type ComfyWorkflow = Record<string, ComfyNode>;

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
);

const defaultWorkflowPath = () => path.join(
  os.homedir(),
  '.comfy-mcp',
  'workflows',
  'aspect_ratio_adjustment',
  'workflow.json'
);

const getConfig = (): ComfyConfig => ({
  baseUrl: (process.env.COMFY_BASE_URL || process.env.COMFY_MCP_COMFY_BASE_URL || 'http://127.0.0.1:8188').replace(/\/$/, ''),
  workflowPath: process.env.COMFY_ASPECT_RATIO_WORKFLOW_PATH || process.env.COMFY_WORKFLOW_PATH || defaultWorkflowPath(),
  outputNode: process.env.COMFY_ASPECT_RATIO_OUTPUT_NODE || process.env.COMFY_OUTPUT_NODE || '79',
  imageNode: process.env.COMFY_ASPECT_RATIO_IMAGE_NODE || process.env.COMFY_IMAGE_NODE || '109',
  aspectNode: process.env.COMFY_ASPECT_RATIO_NODE || process.env.COMFY_ASPECT_NODE || '115',
  positiveNode: process.env.COMFY_ASPECT_RATIO_POSITIVE_NODE || process.env.COMFY_POSITIVE_NODE || '113',
  negativeNode: process.env.COMFY_ASPECT_RATIO_NEGATIVE_NODE || process.env.COMFY_NEGATIVE_NODE || '114',
  seedNode: process.env.COMFY_ASPECT_RATIO_SEED_NODE || undefined,
  pollMs: Math.max(250, Number(process.env.COMFY_ASPECT_RATIO_POLL_MS || 1000)),
  timeoutMs: Math.max(5000, Number(process.env.COMFY_ASPECT_RATIO_TIMEOUT_MS || 180000)),
});

const aspectLabels: Record<string, string> = {
  '16:9': '16:9 (Panorama)',
  '4:3': '4:3 (Classic Landscape)',
  '3:2': '3:2 (Golden Landscape)',
  '21:9': '21:9 (Epic Ultrawide)',
  '1:1': '1:1 (Perfect Square)',
  '9:16': '9:16 (Slim Vertical)',
  '4:5': '4:5',
  '5:4': '5:4',
};

const isConfigured = () => Boolean(
  (process.env.COMFY_BASE_URL || process.env.COMFY_MCP_COMFY_BASE_URL) &&
  (process.env.COMFY_ASPECT_RATIO_WORKFLOW_PATH || process.env.COMFY_WORKFLOW_PATH)
);

const status = (): AspectRatioExpansionProviderStatus => ({
  id: 'comfyui',
  label: 'ComfyUI workflow',
  available: isConfigured(),
  reason: isConfigured()
    ? undefined
    : 'Set COMFY_BASE_URL and COMFY_ASPECT_RATIO_WORKFLOW_PATH (or COMFY_WORKFLOW_PATH)',
});

async function requestJson(config: ComfyConfig, pathname: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${pathname}`, init);
  } catch (error) {
    throw new Error(`ComfyUI request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = asRecord(payload);
    const message = typeof record?.error === 'string' ? record.error : undefined;
    throw new Error(message || `ComfyUI request failed (${response.status})`);
  }
  return payload as Record<string, unknown>;
}

async function uploadInput(config: ComfyConfig, source: { buffer: Buffer; filename: string; contentType?: string }) {
  const formData = new FormData();
  formData.append('image', new Blob([new Uint8Array(source.buffer)], { type: source.contentType || 'application/octet-stream' }), source.filename);
  const payload = await requestJson(config, '/upload/image', { method: 'POST', body: formData });
  return typeof payload.name === 'string' ? payload.name : source.filename;
}

function setNodeInput(workflow: ComfyWorkflow, nodeId: string, field: string, value: unknown) {
  const node = workflow[nodeId];
  if (!node?.inputs) {
    throw new Error(`ComfyUI workflow node ${nodeId} is missing`);
  }
  node.inputs[field] = value;
}

function applySeed(workflow: ComfyWorkflow, config: ComfyConfig, seed?: number) {
  if (!Number.isFinite(seed)) return;
  const nodeId = config.seedNode || Object.keys(workflow).find((key) => {
    const value = workflow[key]?.inputs?.seed;
    return typeof value === 'number' && Number.isFinite(value);
  });
  if (nodeId) setNodeInput(workflow, nodeId, 'seed', Math.round(seed as number));
}

export function applyComfyWorkflowOverrides(params: {
  workflow: ComfyWorkflow;
  imageFilename: string;
  imageNode: string;
  aspectNode: string;
  positiveNode: string;
  negativeNode: string;
  outputNode: string;
  request: {
    aspectRatio: string;
    placement: string;
    instructions?: string;
    negativePrompt?: string;
    seed?: number;
  };
  seedNode?: string;
}) {
  const { workflow, request } = params;
  setNodeInput(workflow, params.imageNode, 'image', params.imageFilename);
  const aspectLabel = aspectLabels[request.aspectRatio] || request.aspectRatio;
  setNodeInput(workflow, params.aspectNode, 'aspect_ratio', aspectLabel);
  const aspectInputs = workflow[params.aspectNode]?.inputs;
  if (!aspectInputs) throw new Error(`ComfyUI workflow node ${params.aspectNode} is missing`);
  if ('custom_ratio' in aspectInputs) aspectInputs.custom_ratio = false;
  if ('custom_aspect_ratio' in aspectInputs) aspectInputs.custom_aspect_ratio = request.aspectRatio;
  const positivePrompt = [
    request.instructions,
    `Preserve the complete source image while extending to ${request.aspectRatio}; keep the source positioned ${request.placement}.`,
  ].filter(Boolean).join(' ');
  setNodeInput(workflow, params.positiveNode, 'prompt', positivePrompt);
  if (request.negativePrompt) setNodeInput(workflow, params.negativeNode, 'prompt', request.negativePrompt);
  applySeed(workflow, { ...getConfig(), seedNode: params.seedNode }, request.seed);
  setNodeInput(workflow, params.outputNode, 'filename_prefix', `aspect_${request.aspectRatio.replace(/\W+/g, 'x')}`);
  return workflow;
}

async function waitForOutput(config: ComfyConfig, promptId: string, onProgress?: (message: string, percent?: number) => void) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < config.timeoutMs) {
    const history = await requestJson(config, `/history/${encodeURIComponent(promptId)}`);
    const entry = asRecord(history[promptId]);
    const status = asRecord(entry?.status);
    if (status?.completed === true && entry) return entry;
    if (status?.status_str === 'error' || status?.status_str === 'failed') {
      throw new Error('ComfyUI workflow failed');
    }
    const percent = Math.min(0.9, 0.2 + (Date.now() - startedAt) / config.timeoutMs * 0.7);
    onProgress?.('Waiting for ComfyUI output', percent);
    await new Promise((resolve) => setTimeout(resolve, config.pollMs));
  }
  throw new Error(`Timed out waiting for ComfyUI after ${Math.round(config.timeoutMs / 1000)} seconds`);
}

async function downloadOutput(config: ComfyConfig, image: Record<string, unknown>) {
  const params = new URLSearchParams({
    filename: String(image.filename || ''),
    type: String(image.type || 'output'),
  });
  if (typeof image.subfolder === 'string') params.set('subfolder', image.subfolder);
  const response = await fetch(`${config.baseUrl}/view?${params.toString()}`);
  if (!response.ok) throw new Error(`Failed to download ComfyUI output (${response.status})`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type')?.split(';')[0] || 'image/png',
    filename: typeof image.filename === 'string' ? image.filename : 'comfyui-aspect-ratio.png',
  };
}

export const comfyAspectRatioExpansionAdapter: AspectRatioExpansionAdapter = {
  id: 'comfyui',
  label: 'ComfyUI workflow',
  getStatus: status,
  async generate({ source, request, onProgress }) {
    const config = getConfig();
    if (!isConfigured()) throw new Error(status().reason);
    onProgress?.('Uploading source to ComfyUI', 0.08);
    const comfyFilename = await uploadInput(config, source);
    const parsedWorkflow: unknown = JSON.parse(await fs.readFile(config.workflowPath, 'utf8'));
    const workflow = asRecord(parsedWorkflow) as ComfyWorkflow | undefined;
    if (!workflow) throw new Error('Configured ComfyUI workflow must be an object');
    applyComfyWorkflowOverrides({
      workflow,
      imageFilename: comfyFilename,
      imageNode: config.imageNode,
      aspectNode: config.aspectNode,
      positiveNode: config.positiveNode,
      negativeNode: config.negativeNode,
      outputNode: config.outputNode,
      seedNode: config.seedNode,
      request,
    });
    onProgress?.('Submitting ComfyUI workflow', 0.18);
    const queued = await requestJson(config, '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
    });
    const promptId = typeof queued.prompt_id === 'string' ? queued.prompt_id : undefined;
    if (!promptId) throw new Error('ComfyUI did not return a prompt id');
    const result = await waitForOutput(config, promptId, onProgress);
    const outputs = asRecord(result.outputs);
    const outputNode = asRecord(outputs?.[config.outputNode]);
    const images = Array.isArray(outputNode?.images) ? outputNode.images : [];
    const image = images.find((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'));
    if (!image) throw new Error(`ComfyUI returned no output image from node ${config.outputNode}`);
    onProgress?.('Downloading ComfyUI output', 0.94);
    const output = await downloadOutput(config, image);
    const normalizedBuffer = await sharp(output.buffer).webp({ quality: 90, effort: 4 }).toBuffer();
    const dimensions = await sharp(output.buffer).metadata();
    if (!dimensions.width || !dimensions.height) throw new Error('ComfyUI output dimensions could not be resolved');
    return {
      ...output,
      buffer: normalizedBuffer,
      contentType: 'image/webp',
      filename: output.filename.replace(/\.[^.]+$/, '') + '.webp',
      provider: 'comfyui',
      workflowId: config.workflowPath,
      externalJobId: promptId,
      dimensions: { width: dimensions.width, height: dimensions.height },
      diagnostics: {
        aspectRatio: request.aspectRatio,
        placement: request.placement,
        outputNode: config.outputNode,
      },
    };
  },
};
