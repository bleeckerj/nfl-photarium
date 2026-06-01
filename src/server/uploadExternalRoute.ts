import { NextResponse } from 'next/server';
import { getPromptThisRecord, setPromptThisRecord, type PromptThisRecord } from '@/server/promptThis';
import type { ComfyWorkflowExtraction } from '@/utils/comfyMetadata';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';

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

export type ExternalUploadFormFields = {
  cleanFolder?: string;
  cleanTags: string[];
  cleanDescription?: string;
  cleanDisplayName?: string;
  cleanOriginalUrl?: string;
  normalizedOriginalUrl?: string;
  cleanSourceUrl?: string;
  normalizedSourceUrl?: string;
  effectiveNamespace: string;
  cleanParentId?: string;
  duplicateAction: FormDataEntryValue | null;
  promptField: ReturnType<typeof parseOptionalPromptField>;
  workflowJsonField: ReturnType<typeof parseOptionalWorkflowJson>;
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

const cleanOptionalText = (value: FormDataEntryValue | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed !== 'undefined' ? trimmed : undefined;
};

export function parseExternalUploadFormFields(
  formData: FormData
): { ok: true; fields: ExternalUploadFormFields } | { ok: false; error: string; status: number } {
  const rawNamespace = cleanOptionalText(formData.get('namespace'));
  const effectiveNamespace =
    rawNamespace && rawNamespace !== '__all__' && rawNamespace !== '__none__'
      ? rawNamespace
      : undefined;

  if (!effectiveNamespace) {
    return {
      ok: false,
      error: 'A specific namespace is required for uploads. Select a namespace instead of All.',
      status: 400,
    };
  }

  const cleanOriginalUrl = cleanOptionalText(formData.get('originalUrl'));
  const cleanSourceUrl = cleanOptionalText(formData.get('sourceUrl'));
  const tags = cleanOptionalText(formData.get('tags'));
  const parentId = cleanOptionalText(formData.get('parentId'));

  return {
    ok: true,
    fields: {
      cleanFolder: cleanOptionalText(formData.get('folder')),
      cleanTags: tags ? tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
      cleanDescription: cleanOptionalText(formData.get('description')),
      cleanDisplayName: cleanOptionalText(formData.get('displayName')),
      cleanOriginalUrl,
      normalizedOriginalUrl: normalizeOriginalUrl(cleanOriginalUrl),
      cleanSourceUrl,
      normalizedSourceUrl: normalizeOriginalUrl(cleanSourceUrl),
      effectiveNamespace,
      cleanParentId: parentId,
      duplicateAction: formData.get('duplicateAction'),
      promptField: parseOptionalPromptField(formData.get('prompt')),
      workflowJsonField: parseOptionalWorkflowJson(formData.get('comfyWorkflowJson')),
    },
  };
}

export async function parseCloudflareUploadApiResponse(
  cloudflareResponse: Response
): Promise<{ ok: true; result: CloudflareUploadApiResult } | { ok: false; response: NextResponse }> {
  const contentType = cloudflareResponse.headers.get('content-type') || '';
  let result: CloudflareUploadApiResult = {};
  let textBody: string | undefined;

  if (contentType.includes('application/json')) {
    const jsonPayload = await cloudflareResponse.json();
    if (jsonPayload && typeof jsonPayload === 'object') {
      result = jsonPayload as CloudflareUploadApiResult;
    }
  } else {
    textBody = await cloudflareResponse.text();
    try {
      const parsedPayload = JSON.parse(textBody);
      if (parsedPayload && typeof parsedPayload === 'object') {
        result = parsedPayload as CloudflareUploadApiResult;
      }
    } catch {
      console.error('Cloudflare returned non-JSON response:', {
        status: cloudflareResponse.status,
        statusText: cloudflareResponse.statusText,
        contentType,
        bodyPreview: textBody.slice(0, 500),
      });

      let errorMessage = 'Cloudflare returned an unexpected response';
      if (cloudflareResponse.status === 429) {
        errorMessage = 'Rate limited by Cloudflare. Please wait and try again.';
      } else if (cloudflareResponse.status === 503 || cloudflareResponse.status === 502) {
        errorMessage = 'Cloudflare service temporarily unavailable. Please retry.';
      } else if (cloudflareResponse.status === 408 || textBody.includes('timeout')) {
        errorMessage = 'Request timed out. The file may be too large or the connection is slow.';
      } else if (cloudflareResponse.status >= 500) {
        errorMessage = `Cloudflare server error (${cloudflareResponse.status}). Please retry.`;
      }

      return {
        ok: false,
        response: withCors(NextResponse.json(
          { error: errorMessage },
          { status: cloudflareResponse.status || 502 }
        )),
      };
    }
  }

  if (!cloudflareResponse.ok) {
    console.error('Cloudflare API error:', result);
    return {
      ok: false,
      response: withCors(NextResponse.json(
        { error: result.errors?.[0]?.message || 'Failed to upload to Cloudflare' },
        { status: cloudflareResponse.status }
      )),
    };
  }

  return { ok: true, result };
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
