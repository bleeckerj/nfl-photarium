import { NextResponse } from 'next/server';
import { getPromptThisRecord, setPromptThisRecord, type PromptThisRecord } from '@/server/promptThis';
import type { ComfyWorkflowExtraction } from '@/utils/comfyMetadata';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_WORKFLOW_JSON_BYTES = 2_000_000;

export type CloudflareUploadApiResult = {
  result?: {
    id?: string;
    filename?: string;
    uploaded?: string;
    variants?: string[];
    size?: number;
    meta?: Record<string, unknown>;
  };
  errors?: Array<{ message?: string }>;
};

export type PromptSaveSummary = {
  requested: true;
  promptLength: number;
  attempted: number;
  saved: number;
  failed: number;
  imageIds: string[];
  errors?: Array<{ imageId: string; error: string }>;
};

export function withCors(response: NextResponse) {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export function parseOptionalWorkflowJson(
  value: FormDataEntryValue | null
): { ok: true; workflowJson?: unknown } | { ok: false; error: string } {
  if (value === null) return { ok: true };
  if (typeof value !== 'string') {
    return { ok: false, error: 'Invalid comfyWorkflowJson: expected a JSON string' };
  }

  const trimmed = value.trim();
  if (!trimmed) return { ok: true };

  if (Buffer.byteLength(trimmed, 'utf8') > MAX_WORKFLOW_JSON_BYTES) {
    return { ok: false, error: 'Invalid comfyWorkflowJson: payload too large' };
  }

  try {
    return {
      ok: true,
      workflowJson: JSON.parse(trimmed),
    };
  } catch {
    return { ok: false, error: 'Invalid comfyWorkflowJson: malformed JSON' };
  }
}

export function applyWorkflowOverride(
  extraction: ComfyWorkflowExtraction,
  workflowJson?: unknown
): ComfyWorkflowExtraction {
  if (workflowJson === undefined) return extraction;

  const source = 'request:comfyWorkflowJson';
  const mergedSources = Array.from(new Set([...(extraction.sources ?? []), source]));

  return {
    ...extraction,
    detected: true,
    source,
    sources: mergedSources,
    workflowJson,
    workflowSourceKey: source,
  };
}

export function parseOptionalPromptField(
  value: FormDataEntryValue | null
): { ok: true; prompt?: string } | { ok: false; error: string } {
  if (value === null) return { ok: true };
  if (typeof value !== 'string') {
    return { ok: false, error: 'Invalid prompt: expected a text field' };
  }
  const prompt = value.trim();
  return prompt ? { ok: true, prompt } : { ok: true };
}

export async function persistUploadPrompt(
  imageIds: Array<string | undefined>,
  prompt?: string
): Promise<PromptSaveSummary | undefined> {
  if (!prompt) return undefined;

  const uniqueIds = Array.from(new Set(imageIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)));
  if (!uniqueIds.length) {
    return {
      requested: true,
      promptLength: prompt.length,
      attempted: 0,
      saved: 0,
      failed: 0,
      imageIds: [],
    };
  }

  const errors: Array<{ imageId: string; error: string }> = [];
  let saved = 0;

  for (const imageId of uniqueIds) {
    try {
      const existing = await getPromptThisRecord(imageId);
      const now = new Date().toISOString();
      const record: PromptThisRecord = {
        imageId,
        prompt,
        model: 'manual',
        provider: 'manual',
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      await setPromptThisRecord(record);
      saved += 1;
    } catch (error) {
      errors.push({
        imageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (errors.length) {
    console.warn('[upload/external] Failed to persist prompt for one or more uploaded images', {
      attempted: uniqueIds.length,
      failed: errors.length,
      imageIds: uniqueIds,
    });
  }

  return {
    requested: true,
    promptLength: prompt.length,
    attempted: uniqueIds.length,
    saved,
    failed: errors.length,
    imageIds: uniqueIds,
    errors: errors.length ? errors : undefined,
  };
}
