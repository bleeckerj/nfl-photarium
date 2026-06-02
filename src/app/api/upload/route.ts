import { NextRequest, NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import { toDuplicateSummary } from '@/server/duplicateDetector';
import { upsertRegistryNamespace } from '@/server/namespaceRegistry';
import { validateParentForNewChild } from '@/server/parentValidation';
import { getPromptThisRecord, setPromptThisRecord, type PromptThisRecord } from '@/server/promptThis';
import { resolveUploadNamespace, SPECIFIC_NAMESPACE_REQUIRED_ERROR } from '@/server/uploadNamespace';
import { SUPPORTED_IMAGE_TYPES, uploadImageBuffer } from '@/server/uploadService';
import type { UploadFailure, UploadSuccess } from '@/server/uploadService';
import type { UploadDuplicateAction } from '@/server/uploadDuplicatePolicy';

const logIssue = (message: string, details?: Record<string, unknown>) => {
  console.warn('[upload] ' + message, details);
};

const MAX_ZIP_BYTES = 500 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const isZipFile = (file: File) =>
  file.type === 'application/zip' || file.type === 'application/x-zip-compressed' || file.name.toLowerCase().endsWith('.zip');

const isKeynoteFile = (file: File) => file.name.toLowerCase().endsWith('.key');

const isArchiveFile = (file: File) => isZipFile(file) || isKeynoteFile(file);

const normalizeDuplicateAction = (value: unknown): UploadDuplicateAction | undefined =>
  value === 'reject' || value === 'family' ? value : undefined;

const getMimeTypeFromFilename = (filename: string) => {
  const lower = filename.toLowerCase();
  const match = Object.keys(MIME_BY_EXTENSION).find((ext) => lower.endsWith(ext));
  return match ? MIME_BY_EXTENSION[match] : undefined;
};

const normalizeFilename = (filename: string) => {
  const parts = filename.split(/[\\/]/);
  return parts[parts.length - 1] || filename;
};

const stripExtension = (filename: string) => filename.replace(/\.[^.]+$/, '');

const isKeynoteDataEntry = (entryName: string) => {
  const normalized = entryName.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  return lower.startsWith('data/') || lower.includes('/data/');
};

const isKeynoteSourcePath = (value?: string) => value ? value.toLowerCase().endsWith('.key') : false;

const keynoteDescriptionFromPath = (value?: string) => {
  if (!value) return undefined;
  return stripExtension(normalizeFilename(value));
};

type PromptSaveSummary = {
  requested: true;
  promptLength: number;
  attempted: number;
  saved: number;
  failed: number;
  imageIds: string[];
  errors?: Array<{ imageId: string; error: string }>;
};

const parseOptionalPromptField = (
  value: FormDataEntryValue | null
): { ok: true; prompt?: string } | { ok: false; error: string } => {
  if (value === null) return { ok: true };
  if (typeof value !== 'string') {
    return { ok: false, error: 'Invalid prompt: expected a text field' };
  }
  const prompt = value.trim();
  return prompt ? { ok: true, prompt } : { ok: true };
};

async function persistUploadPrompt(
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
    logIssue('Failed to persist prompt for one or more uploaded images', {
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

export async function POST(request: NextRequest) {
  try {
    // Check for required environment variables
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    
    if (!accountId || !apiToken) {
      return NextResponse.json(
        { error: 'Cloudflare credentials not configured. Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      logIssue('No file provided in form submission');
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Get folder, tags, description, and URLs from form data
    const folder = formData.get('folder') as string;
    const tags = formData.get('tags') as string;
    const description = formData.get('description') as string;
    const promptField = parseOptionalPromptField(formData.get('prompt'));
    const displayName = formData.get('displayName') as string;
    const originalUrl = formData.get('originalUrl') as string;
    const sourceUrl = formData.get('sourceUrl') as string;
    const sourcePath = formData.get('sourcePath') as string;
    const filenameRaw = formData.get('filename');
    const namespace = formData.get('namespace') as string;
    const parentIdRaw = formData.get('parentId');
    const duplicateActionRaw = formData.get('duplicateAction');

    if (!promptField.ok) {
      return NextResponse.json(
        { error: promptField.error },
        { status: 400 }
      );
    }
    const cleanPrompt = promptField.prompt;
    
    // Clean up values - handle empty strings and "undefined" strings
    const cleanFolder = folder && folder.trim() && folder !== 'undefined' ? folder.trim() : undefined;
    const cleanTags = tags && tags.trim() ? tags.trim().split(',').map(t => t.trim()).filter(t => t) : [];
    const cleanDescription = description && description.trim() && description !== 'undefined' ? description.trim() : undefined;
    const cleanDisplayName = displayName && displayName.trim() && displayName !== 'undefined' ? displayName.trim() : undefined;
    const cleanOriginalUrl = originalUrl && originalUrl.trim() && originalUrl !== 'undefined' ? originalUrl.trim() : undefined;
    const cleanSourceUrl = sourceUrl && sourceUrl.trim() && sourceUrl !== 'undefined' ? sourceUrl.trim() : undefined;
    const cleanSourcePath = sourcePath && sourcePath.trim() && sourcePath !== 'undefined' ? sourcePath.trim() : undefined;
    const cleanFilename =
      typeof filenameRaw === 'string' && filenameRaw.trim() && filenameRaw !== 'undefined'
        ? normalizeFilename(filenameRaw.trim())
        : undefined;
    const parentIdValue = typeof parentIdRaw === 'string' ? parentIdRaw.trim() : '';
    const cleanParentId = parentIdValue && parentIdValue !== 'undefined' ? parentIdValue : undefined;

    const parentValidation = await validateParentForNewChild(cleanParentId);
    if (!parentValidation.ok) {
      return NextResponse.json(
        { error: parentValidation.error },
        { status: parentValidation.status }
      );
    }
    const effectiveNamespace = resolveUploadNamespace(namespace, parentValidation);
    if (!effectiveNamespace) {
      return NextResponse.json(
        { error: SPECIFIC_NAMESPACE_REQUIRED_ERROR },
        { status: 400 }
      );
    }
    const resolvedParentId = parentValidation.canonicalParentId;

    const keynoteSource = isKeynoteSourcePath(cleanSourcePath);
    const forcedTags = keynoteSource
      ? Array.from(new Set([...cleanTags, 'keynote']))
      : cleanTags;
    const forcedDescription = cleanDescription || (keynoteSource ? keynoteDescriptionFromPath(cleanSourcePath) : undefined);

    const uploadContext = {
      accountId,
      apiToken,
      folder: cleanFolder,
      tags: forcedTags,
      description: forcedDescription,
      displayName: cleanDisplayName,
      originalUrl: cleanOriginalUrl,
      sourceUrl: cleanSourceUrl,
      sourcePath: cleanSourcePath,
      namespace: effectiveNamespace,
      parentId: resolvedParentId,
      duplicateAction: normalizeDuplicateAction(duplicateActionRaw),
    };

    if (isArchiveFile(file)) {
      const isKeynote = isKeynoteFile(file);
      if (file.size > MAX_ZIP_BYTES) {
        logIssue('Rejected oversized zip upload', { filename: file.name, bytes: file.size, limit: MAX_ZIP_BYTES });
        return NextResponse.json(
          { error: 'Archive file size must be 500MB or less' },
          { status: 400 }
        );
      }

      const zipBuffer = Buffer.from(await file.arrayBuffer());
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();
      const keynoteName = isKeynote ? stripExtension(file.name) : undefined;
      const keynoteTags = isKeynote
        ? Array.from(new Set([...cleanTags, 'keynote']))
        : cleanTags;
      const keynoteDescription = isKeynote ? keynoteName : cleanDescription;
      const keynoteSourcePath = isKeynote ? (cleanSourcePath || file.name) : cleanSourcePath;
      const keynoteContext = isKeynote
        ? {
            ...uploadContext,
            tags: keynoteTags,
            description: keynoteDescription,
            sourcePath: keynoteSourcePath
          }
        : uploadContext;

      const orderedEntries = isKeynote
        ? entries
          .filter((entry) => !entry.isDirectory && isKeynoteDataEntry(entry.entryName))
          .sort((a, b) => a.entryName.localeCompare(b.entryName))
        : entries;

      const results: UploadSuccess[] = [];
      const failures: UploadFailure[] = [];
      const skipped: { filename: string; reason: string }[] = [];
      let keynoteParentId: string | undefined;

      for (const entry of orderedEntries) {
        if (entry.isDirectory) {
          continue;
        }
        const entryName = normalizeFilename(entry.entryName);
        const entryType = getMimeTypeFromFilename(entryName);
        if (!entryType || !SUPPORTED_IMAGE_TYPES.has(entryType)) {
          skipped.push({ filename: entryName, reason: 'Not an image file' });
          continue;
        }

        const entryBuffer = entry.getData();
        const entryContext = isKeynote
          ? {
              ...keynoteContext,
              parentId: keynoteParentId
            }
          : uploadContext;
        const outcome = await uploadImageBuffer({
          buffer: entryBuffer,
          originalBuffer: entryBuffer,
          fileName: entryName,
          fileType: entryType,
          fileSize: entryBuffer.byteLength,
          context: entryContext
        });

        if (outcome.ok) {
          results.push(outcome.data);
          if (isKeynote && !keynoteParentId) {
            keynoteParentId = outcome.data.id;
          }
        } else {
          failures.push({
            filename: entryName,
            error: outcome.error,
            reason: outcome.reason ?? 'upload'
          });
        }
      }

      if (results.length === 0 && failures.length === 0) {
        return NextResponse.json(
          { error: 'No supported images found in zip' },
          { status: 400 }
        );
      }

      if (results.length > 0) {
        await upsertRegistryNamespace(effectiveNamespace);
      }

      const promptSave = await persistUploadPrompt(
        results.flatMap((result) => [result.id, result.webpVariantId]),
        cleanPrompt
      );

      return NextResponse.json({
        results,
        failures,
        skipped,
        successCount: results.length,
        failureCount: failures.length,
        skippedCount: skipped.length,
        isZip: true,
        ...(promptSave ? { promptSave } : {})
      });
    }

    const fileType = file.type || getMimeTypeFromFilename(file.name) || '';
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const outcome = await uploadImageBuffer({
      buffer: fileBuffer,
      originalBuffer: fileBuffer,
      fileName: cleanFilename || file.name,
      fileType,
      fileSize: file.size,
      context: uploadContext
    });

    if (!outcome.ok) {
      if (outcome.reason === 'duplicate') {
        return NextResponse.json(
          {
            error: outcome.error,
            duplicates: outcome.duplicates ? outcome.duplicates.map(toDuplicateSummary) : []
          },
          { status: outcome.status }
        );
      }
      return NextResponse.json(
        { error: outcome.error },
        { status: outcome.status }
      );
    }

    await upsertRegistryNamespace(effectiveNamespace);

    const promptSave = await persistUploadPrompt(
      [outcome.data.id, outcome.data.webpVariantId],
      cleanPrompt
    );

    return NextResponse.json({
      ...outcome.data,
      ...(promptSave ? { promptSave } : {})
    });

  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
