import { NextRequest, NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import { toDuplicateSummary } from '@/server/duplicateDetector';
import { upsertRegistryNamespace } from '@/server/namespaceRegistry';
import { SUPPORTED_IMAGE_TYPES, uploadImageBuffer } from '@/server/uploadService';
import type { UploadFailure, UploadSuccess } from '@/server/uploadService';

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

const getMimeTypeFromFilename = (filename: string) => {
  const lower = filename.toLowerCase();
  const match = Object.keys(MIME_BY_EXTENSION).find((ext) => lower.endsWith(ext));
  return match ? MIME_BY_EXTENSION[match] : undefined;
};

const normalizeFilename = (filename: string) => {
  const parts = filename.split(/[\\/]/);
  return parts[parts.length - 1] || filename;
};

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
    const originalUrl = formData.get('originalUrl') as string;
    const sourceUrl = formData.get('sourceUrl') as string;
    const namespace = formData.get('namespace') as string;
    const parentIdRaw = formData.get('parentId');
    
    // Clean up values - handle empty strings and "undefined" strings
    const cleanFolder = folder && folder.trim() && folder !== 'undefined' ? folder.trim() : undefined;
    const cleanTags = tags && tags.trim() ? tags.trim().split(',').map(t => t.trim()).filter(t => t) : [];
    const cleanDescription = description && description.trim() && description !== 'undefined' ? description.trim() : undefined;
    const cleanOriginalUrl = originalUrl && originalUrl.trim() && originalUrl !== 'undefined' ? originalUrl.trim() : undefined;
    const cleanSourceUrl = sourceUrl && sourceUrl.trim() && sourceUrl !== 'undefined' ? sourceUrl.trim() : undefined;
    const rawNamespace = typeof namespace === 'string' ? namespace.trim() : '';
    const cleanNamespace =
      rawNamespace && rawNamespace !== 'undefined' && rawNamespace !== '__all__' && rawNamespace !== '__none__'
        ? rawNamespace
        : undefined;
    const defaultNamespace = process.env.IMAGE_NAMESPACE || process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || undefined;
    const effectiveNamespace = cleanNamespace || defaultNamespace;
    const parentIdValue = typeof parentIdRaw === 'string' ? parentIdRaw.trim() : '';
    const cleanParentId = parentIdValue && parentIdValue !== 'undefined' ? parentIdValue : undefined;

    const uploadContext = {
      accountId,
      apiToken,
      folder: cleanFolder,
      tags: cleanTags,
      description: cleanDescription,
      originalUrl: cleanOriginalUrl,
      sourceUrl: cleanSourceUrl,
      namespace: effectiveNamespace,
      parentId: cleanParentId
    };

    if (isZipFile(file)) {
      if (file.size > MAX_ZIP_BYTES) {
        logIssue('Rejected oversized zip upload', { filename: file.name, bytes: file.size, limit: MAX_ZIP_BYTES });
        return NextResponse.json(
          { error: 'Zip file size must be less than 100MB' },
          { status: 400 }
        );
      }

      const zipBuffer = Buffer.from(await file.arrayBuffer());
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();
      const results: UploadSuccess[] = [];
      const failures: UploadFailure[] = [];
      const skipped: { filename: string; reason: string }[] = [];

      for (const entry of entries) {
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
        const outcome = await uploadImageBuffer({
          buffer: entryBuffer,
          originalBuffer: entryBuffer,
          fileName: entryName,
          fileType: entryType,
          fileSize: entryBuffer.byteLength,
          context: uploadContext
        });

        if (outcome.ok) {
          results.push(outcome.data);
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

      return NextResponse.json({
        results,
        failures,
        skipped,
        successCount: results.length,
        failureCount: failures.length,
        skippedCount: skipped.length,
        isZip: true
      });
    }

    const fileType = file.type || getMimeTypeFromFilename(file.name) || '';
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const outcome = await uploadImageBuffer({
      buffer: fileBuffer,
      originalBuffer: fileBuffer,
      fileName: file.name,
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

    return NextResponse.json(outcome.data);

  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
