import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

export type NoAiDemarkMode = 'demark' | 'metadata';
export type NoAiDemarkModelProfile = 'default' | 'ctrlregen';
export type NoAiDemarkDevice = 'auto' | 'cpu' | 'mps' | 'cuda';

export type NoAiDemarkSettings = {
  mode: NoAiDemarkMode;
  strength: number;
  steps: number;
  modelProfile: NoAiDemarkModelProfile;
  device: NoAiDemarkDevice;
  removeAllMetadata: boolean;
};

type NoAiWorkerItem = {
  imageId: string;
  ok: boolean;
  error?: string;
  width?: number;
  height?: number;
  aiMetadataPresent?: boolean;
};

type NoAiWorkerResponse = {
  items: NoAiWorkerItem[];
};

export type NoAiDemarkArtifact = {
  buffer: Buffer;
  contentType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
};

const configuredNoAiRoot = () => {
  const root = process.env.PHOTARIUM_NOAI_WATERMARK_ROOT?.trim();
  if (!root) {
    throw new Error('PHOTARIUM_NOAI_WATERMARK_ROOT is required for the No-AI Demarker');
  }
  return path.resolve(root);
};

const configuredPython = (noAiRoot: string) => (
  process.env.PHOTARIUM_NOAI_WATERMARK_PYTHON?.trim()
  || path.join(noAiRoot, '.venv', 'bin', 'python')
);

const demarkWorkerPath = () => path.join(process.cwd(), 'mcp-server', 'worker', 'demark_worker.py');

const parseWorkerResponse = (stdout: string): NoAiWorkerResponse => {
  const responseLine = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!responseLine) throw new Error('The noai-watermark worker returned no JSON result');

  try {
    const parsed = JSON.parse(responseLine) as NoAiWorkerResponse;
    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error('invalid result shape');
    }
    return parsed;
  } catch (error) {
    throw new Error(`The noai-watermark worker returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const runWorker = async (params: {
  settings: NoAiDemarkSettings;
  imageId: string;
  sourcePath: string;
  outputPath: string;
}): Promise<NoAiWorkerResponse> => {
  const noAiRoot = configuredNoAiRoot();
  const workerPath = demarkWorkerPath();
  await Promise.all([fs.access(noAiRoot), fs.access(workerPath)]);

  return new Promise((resolve, reject) => {
    const child = spawn(configuredPython(noAiRoot), [workerPath], {
      cwd: noAiRoot,
      env: {
        ...process.env,
        NO_COLOR: '1',
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      reject(new Error(`Unable to start noai-watermark worker: ${error.message}`));
    });
    child.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        const detail = stderr.trim() ? `: ${stderr.trim().slice(-1000)}` : '';
        reject(new Error(`noai-watermark worker exited with code ${code ?? 1}${detail}`));
        return;
      }
      try {
        resolve(parseWorkerResponse(stdout));
      } catch (error) {
        const detail = stderr.trim() ? ` ${stderr.trim().slice(-1000)}` : '';
        reject(new Error(`${error instanceof Error ? error.message : String(error)}${detail}`));
      }
    });
    child.stdin.write(JSON.stringify({
      settings: params.settings,
      items: [{
        imageId: params.imageId,
        sourcePath: params.sourcePath,
        outputPath: params.outputPath,
      }],
    }));
    child.stdin.end();
  });
};

const contentTypeFromFormat = (format: string | undefined): NoAiDemarkArtifact['contentType'] => {
  if (format === 'png') return 'image/png';
  if (format === 'jpeg') return 'image/jpeg';
  throw new Error('No-AI Demarker outputs must be PNG or JPEG');
};

/**
 * Run the same local Python worker used by the direct Photarium MCP tool.
 * The two TypeScript entrypoints have separate build roots, so the shared
 * Python worker is the single source of the actual demarking behavior.
 */
export const runNoAiDemark = async (params: {
  imageId: string;
  sourceFilename: string;
  sourceBuffer: Buffer;
  outputFilename: string;
  settings: NoAiDemarkSettings;
}): Promise<NoAiDemarkArtifact> => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'photarium-noai-demarker-'));
  try {
    const sourcePath = path.join(temporaryDirectory, `source-${path.basename(params.sourceFilename)}`);
    const outputPath = path.join(temporaryDirectory, path.basename(params.outputFilename));
    await fs.writeFile(sourcePath, params.sourceBuffer);

    const workerResponse = await runWorker({
      settings: params.settings,
      imageId: params.imageId,
      sourcePath,
      outputPath,
    });
    const workerItem = workerResponse.items.find((item) => item.imageId === params.imageId);
    if (!workerItem?.ok) {
      throw new Error(workerItem?.error || 'noai-watermark did not return a result for this image');
    }
    if (workerItem.aiMetadataPresent !== false) {
      throw new Error('No-AI verification failed: AI metadata remains in the output');
    }

    const output = await fs.readFile(outputPath);
    const [sourceMetadata, outputMetadata] = await Promise.all([
      sharp(params.sourceBuffer).metadata(),
      sharp(output).metadata(),
    ]);
    if (!sourceMetadata.width || !sourceMetadata.height || !outputMetadata.width || !outputMetadata.height) {
      throw new Error('No-AI verification failed: image dimensions are unavailable');
    }
    if (sourceMetadata.width !== outputMetadata.width || sourceMetadata.height !== outputMetadata.height) {
      throw new Error(
        `No-AI verification failed: output dimensions ${outputMetadata.width}x${outputMetadata.height} do not match source ${sourceMetadata.width}x${sourceMetadata.height}`,
      );
    }
    if (workerItem.width !== outputMetadata.width || workerItem.height !== outputMetadata.height) {
      throw new Error('No-AI verification failed: worker dimensions do not match output bytes');
    }

    return {
      buffer: output,
      contentType: contentTypeFromFormat(outputMetadata.format),
      width: outputMetadata.width,
      height: outputMetadata.height,
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
};
