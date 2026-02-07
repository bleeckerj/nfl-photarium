#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import undici from 'undici';

const fetch = globalThis.fetch || undici.fetch;
const FormData = globalThis.FormData || undici.FormData;
const Blob = globalThis.Blob || undici.Blob;

const DEFAULT_PHOTARIUM_BASE = process.env.PHOTARIUM_BASE_URL || 'http://localhost:3000';
const DEFAULT_COMFY_BASE = process.env.COMFY_BASE_URL || process.env.COMFY_MCP_COMFY_BASE_URL || 'http://127.0.0.1:8188';
const DEFAULT_WORKFLOW_PATH = process.env.COMFY_WORKFLOW_PATH || path.join(os.homedir(), '.comfy-mcp', 'workflows', 'aspect_ratio_adjustment', 'workflow.json');
const DEFAULT_OUTPUT_NODE = process.env.COMFY_OUTPUT_NODE || '79';
const DEFAULT_IMAGE_NODE = process.env.COMFY_IMAGE_NODE || '109';
const DEFAULT_ASPECT_NODE = process.env.COMFY_ASPECT_NODE || '115';
const DEFAULT_POSITIVE_NODE = process.env.COMFY_POSITIVE_NODE || '113';
const DEFAULT_NEGATIVE_NODE = process.env.COMFY_NEGATIVE_NODE || '114';

const ASPECT_LABELS = {
  '16:9': '16:9 (Panorama)',
  '4:3': '4:3 (Classic Landscape)',
  '3:2': '3:2 (Golden Landscape)',
  '21:9': '21:9 (Epic Ultrawide)',
  '1:1': '1:1 (Perfect Square)',
  '9:16': '9:16 (Slim Vertical)',
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      opts[key] = next;
      i += 1;
    } else {
      opts[key] = true;
    }
  }
  return opts;
};

const requireValue = (value, name) => {
  if (!value) {
    console.error(`Missing required ${name}. Use --${name}=...`);
    process.exit(1);
  }
  return value;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (url, options) => {
  let resp;
  try {
    resp = await fetch(url, options);
  } catch (error) {
    throw new Error(`Fetch failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(payload?.error?.message || payload?.error || `Request failed (${resp.status})`);
  }
  return payload;
};

const assertComfyReachable = async (comfyBaseUrl) => {
  try {
    const resp = await fetch(`${comfyBaseUrl}/system_stats`);
    if (!resp.ok) {
      throw new Error(`ComfyUI responded with ${resp.status}`);
    }
  } catch (error) {
    throw new Error(
      `ComfyUI not reachable at ${comfyBaseUrl}. Set --comfyBase or COMFY_BASE_URL. (${error instanceof Error ? error.message : String(error)})`
    );
  }
};

const downloadImageById = async (baseUrl, imageId, variant) => {
  const params = new URLSearchParams();
  if (variant) params.set('variant', variant);
  const url = `${baseUrl}/api/images/${imageId}/download${params.toString() ? `?${params}` : ''}`;
  let resp;
  try {
    resp = await fetch(url);
  } catch (error) {
    throw new Error(`Failed to download image from Photarium: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Failed to download image: ${resp.status} ${text}`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const contentType = resp.headers.get('content-type') || 'application/octet-stream';
  const disposition = resp.headers.get('content-disposition') || '';
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  const filename = filenameMatch?.[1] || `${imageId}.bin`;
  return { buffer: Buffer.from(arrayBuffer), contentType, filename };
};

const uploadToComfy = async (comfyBaseUrl, buffer, filename, contentType) => {
  const formData = new FormData();
  formData.append('image', new Blob([new Uint8Array(buffer)], { type: contentType }), filename);
  let resp;
  try {
    resp = await fetch(`${comfyBaseUrl}/upload/image`, { method: 'POST', body: formData });
  } catch (error) {
    throw new Error(`ComfyUI upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(payload?.error || `ComfyUI upload failed (${resp.status})`);
  }
  return payload;
};

const runComfyWorkflow = async (comfyBaseUrl, workflow) => {
  const payload = await fetchJson(`${comfyBaseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
  });
  return payload?.prompt_id;
};

const waitForComfy = async (comfyBaseUrl, promptId, timeoutMs = 180000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const history = await fetchJson(`${comfyBaseUrl}/history/${promptId}`);
    const entry = history?.[promptId];
    if (entry?.status?.completed) {
      return entry;
    }
    await sleep(1000);
  }
  throw new Error('Timed out waiting for ComfyUI');
};

const downloadComfyOutput = async (comfyBaseUrl, imageInfo) => {
  const params = new URLSearchParams({
    filename: imageInfo.filename,
    type: imageInfo.type || 'output',
  });
  if (imageInfo.subfolder) params.set('subfolder', imageInfo.subfolder);
  let resp;
  try {
    resp = await fetch(`${comfyBaseUrl}/view?${params.toString()}`);
  } catch (error) {
    throw new Error(`Failed to download ComfyUI output: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!resp.ok) {
    throw new Error(`Failed to download ComfyUI output (${resp.status})`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const contentType = resp.headers.get('content-type') || 'application/octet-stream';
  return { buffer: Buffer.from(arrayBuffer), contentType };
};

const uploadToPhotarium = async (baseUrl, buffer, filename, contentType, folder) => {
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), filename);
  if (folder) formData.append('folder', folder);
  let resp;
  try {
    resp = await fetch(`${baseUrl}/api/upload/external`, { method: 'POST', body: formData });
  } catch (error) {
    throw new Error(`Photarium upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(payload?.error || `Photarium upload failed (${resp.status})`);
  }
  return payload;
};

const loadWorkflow = async (workflowPath) => {
  const raw = await fs.readFile(workflowPath, 'utf8');
  return JSON.parse(raw);
};

const resolveAspectLabel = (ratio) => {
  if (!ratio) return undefined;
  if (ratio.includes('(')) return ratio;
  return ASPECT_LABELS[ratio] || ratio;
};

const main = async () => {
  const opts = parseArgs();
  const imageId = requireValue(opts.imageId || opts.id, 'imageId');
  const aspectRatio = opts.aspectRatio || '16:9';
  const applyAspectNode = opts.applyAspectNode === 'true' || opts.applyAspectNode === true;
  const positivePrompt = opts.positivePrompt || opts.prompt || '';
  const negativePrompt = opts.negativePrompt || '';
  const folder = opts.folder || 'comfyui';
  const photariumBase = opts.photariumBase || DEFAULT_PHOTARIUM_BASE;
  const comfyBase = opts.comfyBase || DEFAULT_COMFY_BASE;
  const workflowPath = opts.workflowPath || DEFAULT_WORKFLOW_PATH;
  const outputNode = String(opts.outputNode || DEFAULT_OUTPUT_NODE);
  const imageNode = String(opts.imageNode || DEFAULT_IMAGE_NODE);
  const aspectNode = String(opts.aspectNode || DEFAULT_ASPECT_NODE);
  const positiveNode = String(opts.positiveNode || DEFAULT_POSITIVE_NODE);
  const negativeNode = String(opts.negativeNode || DEFAULT_NEGATIVE_NODE);
  const variant = opts.variant || 'public';

  console.log('Downloading from Photarium...');
  const source = await downloadImageById(photariumBase, imageId, variant);

  await assertComfyReachable(comfyBase);

  console.log('Uploading to ComfyUI input...');
  await uploadToComfy(comfyBase, source.buffer, source.filename, source.contentType);

  console.log('Loading workflow...');
  const workflow = await loadWorkflow(workflowPath);
  if (!workflow[imageNode]?.inputs) {
    throw new Error(`Image node ${imageNode} not found in workflow`);
  }
  workflow[imageNode].inputs.image = source.filename;

  const label = resolveAspectLabel(aspectRatio);
  if (applyAspectNode) {
    if (!workflow[aspectNode]?.inputs) {
      throw new Error(`Aspect node ${aspectNode} not found in workflow`);
    }
    workflow[aspectNode].inputs.aspect_ratio = label || workflow[aspectNode].inputs.aspect_ratio;
    workflow[aspectNode].inputs.custom_ratio = false;
    workflow[aspectNode].inputs.custom_aspect_ratio = aspectRatio;
  }

  if (workflow[positiveNode]?.inputs && positivePrompt) {
    workflow[positiveNode].inputs.prompt = positivePrompt;
  }
  if (workflow[negativeNode]?.inputs && negativePrompt) {
    workflow[negativeNode].inputs.prompt = negativePrompt;
  }

  if (workflow[outputNode]?.inputs) {
    workflow[outputNode].inputs.filename_prefix = `${path.parse(source.filename).name}_${aspectRatio.replace(/\W+/g, 'x')}`;
  }

  console.log('Running ComfyUI workflow...');
  const promptId = await runComfyWorkflow(comfyBase, workflow);
  if (!promptId) {
    throw new Error('ComfyUI did not return a prompt id');
  }

  const result = await waitForComfy(comfyBase, promptId);
  const outputs = result?.outputs || {};
  const outputImages = outputs?.[outputNode]?.images || [];
  if (outputImages.length === 0) {
    throw new Error('No output images from ComfyUI');
  }

  console.log('Downloading ComfyUI output...');
  const output = await downloadComfyOutput(comfyBase, outputImages[0]);

  const outputFilename = outputImages[0].filename || `${path.parse(source.filename).name}_${aspectRatio.replace(/\W+/g, 'x')}.png`;

  console.log('Uploading to Photarium...');
  const uploaded = await uploadToPhotarium(photariumBase, output.buffer, outputFilename, output.contentType, folder);

  console.log('Done.');
  console.log(JSON.stringify({
    sourceImageId: imageId,
    outputFilename,
    uploaded,
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
