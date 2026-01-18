import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Embedding Service
 * 
 * Generates CLIP embeddings for images using HuggingFace Inference API.
 * CLIP embeddings enable semantic similarity search - finding images
 * that are visually or conceptually similar.
 * 
 * Usage:
 *   const embedding = await generateClipEmbedding(imageUrl);
 *   // Returns 512-dimensional float32 vector
 * 
 * Environment Variables:
 *   HUGGINGFACE_API_TOKEN - HuggingFace API token (get from https://huggingface.co/settings/tokens)
 *   
 * Free Tier: HuggingFace Inference API has a generous free tier for small projects
 */

// CLIP embedding dimension (openai/clip-vit-base-patch32)
export const CLIP_EMBEDDING_DIM = 512;

const DEFAULT_PROVIDER = 'huggingface';
const PROVIDER_LOG_KEY = Symbol.for('photarium.embedding.provider.logged');
const PYTHON_LOG_KEY = Symbol.for('photarium.embedding.python.logged');
const PYTHON_RESOLVE_KEY = Symbol.for('photarium.embedding.python.resolved');

const resolveEmbeddingProvider = () =>
  (process.env.EMBEDDING_PROVIDER || DEFAULT_PROVIDER).toLowerCase();

const findRepoRoot = () => {
  const tryFind = (startDir: string) => {
    let current = startDir;
    while (true) {
      if (fs.existsSync(path.join(current, 'package.json'))) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  };

  return tryFind(process.cwd()) ?? tryFind(__dirname) ?? process.cwd();
};

const checkPythonHasSentenceTransformers = (pythonExecutable: string) =>
  new Promise<boolean>((resolve) => {
    const child = spawn(pythonExecutable, ['-c', 'import sentence_transformers'], {
      stdio: 'ignore',
    });

    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });

const resolvePythonExecutable = async (repoRoot: string) => {
  const globalScope = globalThis as typeof globalThis & {
    [PYTHON_RESOLVE_KEY]?: string;
  };
  if (globalScope[PYTHON_RESOLVE_KEY]) {
    return globalScope[PYTHON_RESOLVE_KEY];
  }

  const candidates: string[] = [];
  if (process.env.PYTHON_EXECUTABLE) {
    candidates.push(process.env.PYTHON_EXECUTABLE);
  }

  const venvPython = path.resolve(repoRoot, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) {
    candidates.push(venvPython);
  }

  candidates.push('python3', 'python');

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await checkPythonHasSentenceTransformers(candidate)) {
      globalScope[PYTHON_RESOLVE_KEY] = candidate;
      return candidate;
    }
  }

  globalScope[PYTHON_RESOLVE_KEY] = candidates[0] ?? 'python3';
  return globalScope[PYTHON_RESOLVE_KEY];
};

const logProviderOnce = () => {
  const globalScope = globalThis as typeof globalThis & {
    [PROVIDER_LOG_KEY]?: boolean;
  };
  if (!globalScope[PROVIDER_LOG_KEY]) {
    console.info(`[Embedding] Provider: ${resolveEmbeddingProvider()}`);
    globalScope[PROVIDER_LOG_KEY] = true;
  }
};

logProviderOnce();

const logPythonOnce = (pythonExecutable: string, repoRoot: string) => {
  const globalScope = globalThis as typeof globalThis & {
    [PYTHON_LOG_KEY]?: boolean;
  };
  if (!globalScope[PYTHON_LOG_KEY]) {
    console.info(`[Embedding] Local python resolved: ${pythonExecutable}`);
    console.info(`[Embedding] Repo root: ${repoRoot}`);
    globalScope[PYTHON_LOG_KEY] = true;
  }
};

/**
 * Generate CLIP embedding for an image using HuggingFace Inference API
 * 
 * @param imageUrl - URL of the image to embed (must be publicly accessible)
 * @returns 512-dimensional embedding vector, or null if generation failed
 */
export async function generateClipEmbedding(imageUrl: string): Promise<number[] | null> {
  const provider = resolveEmbeddingProvider();
  console.info(`[Embedding] Provider (${provider}) - image request`);

  if (provider === 'local') {
    try {
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        console.error(`[Embedding] Failed to fetch image: ${imageResponse.status}`);
        return null;
      }
      const imageBuffer = await imageResponse.arrayBuffer();
      const localEmbedding = await generateClipEmbeddingLocalFromBytes(imageBuffer);
      if (localEmbedding) {
        console.log('[Embedding] Successfully generated CLIP embedding via local model');
      }
      return localEmbedding;
    } catch (error) {
      console.error('[Embedding] Local embedding error:', error);
      return null;
    }
  }

  const apiToken = process.env.HUGGINGFACE_API_TOKEN;

  if (!apiToken) {
    console.error('[Embedding] Missing HUGGINGFACE_API_TOKEN - get one from https://huggingface.co/settings/tokens');
    return null;
  }

  try {
    // Fetch the image bytes
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.error(`[Embedding] Failed to fetch image: ${imageResponse.status}`);
      return null;
    }

    const imageBuffer = await imageResponse.arrayBuffer();

    // Call HuggingFace Inference API
    const response = await fetch(
      'https://router.huggingface.co/hf-inference/models/openai/clip-vit-base-patch32',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/octet-stream',
        },
        body: imageBuffer,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Embedding] HuggingFace API error: ${response.status} - ${errorText}`);
      return null;
    }

    const result = await response.json() as number[] | { error?: string };

    // Check for errors
    if (result && typeof result === 'object' && 'error' in result) {
      console.error('[Embedding] HuggingFace API error:', result.error);
      return null;
    }

    // HuggingFace returns embedding as flat array
    if (!Array.isArray(result)) {
      console.error('[Embedding] Invalid response format from HuggingFace API');
      return null;
    }

    if (result.length !== CLIP_EMBEDDING_DIM) {
      console.warn(`[Embedding] Unexpected dimension: ${result.length}, expected ${CLIP_EMBEDDING_DIM}`);
    }

    console.log('[Embedding] Successfully generated CLIP embedding via HuggingFace');
    return result;
  } catch (error) {
    console.error('[Embedding] Error generating CLIP embedding:', error);
    return null;
  }
}

/**
 * Generate CLIP embedding from raw image bytes
 * 
 * @param imageBytes - Raw image data as Buffer or ArrayBuffer
 * @returns 512-dimensional embedding vector, or null if generation failed
 */
export async function generateClipEmbeddingFromBytes(
  imageBytes: Buffer | ArrayBuffer
): Promise<number[] | null> {
  const provider = resolveEmbeddingProvider();
  console.info(`[Embedding] Provider (${provider}) - image bytes request`);
  if (provider === 'local') {
    return generateClipEmbeddingLocalFromBytes(imageBytes);
  }

  const apiToken = process.env.HUGGINGFACE_API_TOKEN;

  if (!apiToken) {
    console.error('[Embedding] Missing HUGGINGFACE_API_TOKEN');
    return null;
  }

  try {
    const buffer = imageBytes instanceof Buffer 
      ? imageBytes 
      : Buffer.from(new Uint8Array(imageBytes));

    // Convert to Uint8Array for fetch body
    const uint8Array = new Uint8Array(buffer);

    const response = await fetch(
      'https://router.huggingface.co/hf-inference/models/openai/clip-vit-base-patch32',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/octet-stream',
        },
        body: uint8Array,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Embedding] HuggingFace API error: ${response.status} - ${errorText}`);
      return null;
    }

    const result = await response.json() as number[] | { error?: string };

    if (result && typeof result === 'object' && 'error' in result) {
      console.error('[Embedding] HuggingFace API error:', result.error);
      return null;
    }

    if (!Array.isArray(result)) {
      console.error('[Embedding] Invalid response format from HuggingFace API');
      return null;
    }

    return result;
  } catch (error) {
    console.error('[Embedding] Error generating CLIP embedding from bytes:', error);
    return null;
  }
}

/**
 * Generate text embedding using CLIP for text-to-image search
 * Uses HuggingFace sentence-transformers/clip-ViT-B-32
 * 
 * @param text - Text query to embed
 * @returns 512-dimensional embedding vector, or null if generation failed
 */
export async function generateClipTextEmbedding(text: string): Promise<number[] | null> {
  const provider = resolveEmbeddingProvider();
  console.info(`[Embedding] Provider (${provider}) - text request`);
  if (provider === 'local') {
    return generateClipTextEmbeddingLocal(text);
  }

  const apiToken = process.env.HUGGINGFACE_API_TOKEN;

  if (!apiToken) {
    console.error('[Embedding] Missing HUGGINGFACE_API_TOKEN');
    return null;
  }

  try {
    const response = await fetch(
      'https://router.huggingface.co/hf-inference/pipeline/feature-extraction/sentence-transformers/clip-ViT-B-32',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: text }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Embedding] HuggingFace API error: ${response.status} - ${errorText}`);
      return null;
    }

    const result = await response.json();

    // Result format varies - typically [[embedding]] or just [embedding]
    let embedding: number[];
    if (Array.isArray(result) && result.length > 0) {
      if (Array.isArray(result[0])) {
        embedding = result[0];
      } else {
        embedding = result;
      }
    } else {
      console.error('[Embedding] Invalid response format from HuggingFace API');
      return null;
    }

    console.log('[Embedding] Successfully generated text embedding via HuggingFace');
    return embedding;
  } catch (error) {
    console.error('[Embedding] Error generating text embedding:', error);
    return null;
  }
}

async function generateClipEmbeddingLocalFromBytes(
  imageBytes: Buffer | ArrayBuffer
): Promise<number[] | null> {
  try {
    const buffer = imageBytes instanceof Buffer
      ? imageBytes
      : Buffer.from(new Uint8Array(imageBytes));
    const payload: { mode: 'image'; imageBase64: string } = {
      mode: 'image',
      imageBase64: buffer.toString('base64')
    };
    return await runLocalEmbeddingScript(payload);
  } catch (error) {
    console.error('[Embedding] Local image embedding error:', error);
    return null;
  }
}

async function generateClipTextEmbeddingLocal(text: string): Promise<number[] | null> {
  try {
    const payload: { mode: 'text'; text: string } = {
      mode: 'text',
      text
    };
    return await runLocalEmbeddingScript(payload);
  } catch (error) {
    console.error('[Embedding] Local text embedding error:', error);
    return null;
  }
}

async function runLocalEmbeddingScript(payload: { mode: 'image' | 'text'; text?: string; imageBase64?: string; }) {
  const repoRoot = findRepoRoot();
  const pythonExecutable = await resolvePythonExecutable(repoRoot);
  const scriptPath = path.resolve(repoRoot, 'scripts', 'clip_embed.py');
  logPythonOnce(pythonExecutable, repoRoot);

  return new Promise<number[] | null>((resolve) => {
    const child = spawn(pythonExecutable, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code: number | null) => {
      if (code !== 0) {
        const trimmed = stderr.trim();
        if (trimmed.includes("No module named 'sentence_transformers'")) {
          console.error(
            `[Embedding] Local embedding script failed: sentence_transformers not available for ${pythonExecutable}`
          );
          console.error('[Embedding] Install with: pip install sentence-transformers');
          resolve(null);
          return;
        }
        console.error('[Embedding] Local embedding script failed:', trimmed || `exit code ${code}`);
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (!Array.isArray(parsed)) {
          console.error('[Embedding] Local embedding script returned invalid payload');
          resolve(null);
          return;
        }
        resolve(parsed as number[]);
      } catch (error) {
        console.error('[Embedding] Failed to parse local embedding output:', error);
        resolve(null);
      }
    });

    child.stdin.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE') {
        console.error('[Embedding] Local embedding stdin error:', error);
      }
    });

    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch (error) {
      console.error('[Embedding] Local embedding write error:', error);
    }
  });
}

/**
 * Batch generate CLIP embeddings for multiple images
 * Processes in parallel with rate limiting
 * 
 * @param imageUrls - Array of image URLs to embed
 * @param concurrency - Maximum concurrent requests (default: 5)
 * @param onProgress - Optional callback for progress updates
 * @returns Map of URL to embedding (null for failed images)
 */
export async function batchGenerateClipEmbeddings(
  imageUrls: string[],
  concurrency = 5,
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, number[] | null>> {
  const results = new Map<string, number[] | null>();
  let completed = 0;

  // Process in batches
  for (let i = 0; i < imageUrls.length; i += concurrency) {
    const batch = imageUrls.slice(i, i + concurrency);
    
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const embedding = await generateClipEmbedding(url);
        return { url, embedding };
      })
    );

    for (const { url, embedding } of batchResults) {
      results.set(url, embedding);
      completed++;
    }

    if (onProgress) {
      onProgress(completed, imageUrls.length);
    }

    // Small delay between batches to avoid rate limiting
    if (i + concurrency < imageUrls.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * Calculate cosine similarity between two embedding vectors
 * 
 * @param a - First embedding vector
 * @param b - Second embedding vector
 * @returns Similarity score between -1 and 1 (1 = identical)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}
