import { NextRequest, NextResponse } from 'next/server';

import { toDuplicateSummary } from '@/server/duplicateDetector';
import { upsertRegistryNamespace } from '@/server/namespaceRegistry';
import { uploadImageBuffer } from '@/server/uploadService';
import type { UploadDuplicateAction } from '@/server/uploadDuplicatePolicy';
import {
  parseExternalUploadFormFields,
  persistUploadPrompt,
  resolveExternalUploadFolder,
  withCors,
} from '@/server/uploadExternalRoute';

const logExternalIssue = (message: string, details?: Record<string, unknown>) => {
  console.warn('[upload/external] ' + message, details);
};

const normalizeDuplicateAction = (value: FormDataEntryValue | null): UploadDuplicateAction | undefined => {
  if (value === 'reject' || value === 'family' || value === 'override') return value;
  return undefined;
};

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: NextRequest) {
  try {
    if (process.env.DISABLE_EXTERNAL_API === 'true') {
      return withCors(NextResponse.json(
        { error: 'External upload API is disabled by configuration.' },
        { status: 403 },
      ));
    }

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) {
      return withCors(NextResponse.json(
        { error: 'Cloudflare credentials not configured. Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables.' },
        { status: 500 },
      ));
    }

    const formData = await request.formData();
    const fileValue = formData.get('file');
    if (!(fileValue instanceof File)) {
      logExternalIssue('No file provided');
      return withCors(NextResponse.json({ error: 'No file provided' }, { status: 400 }));
    }

    const parsedFields = parseExternalUploadFormFields(formData);
    if (!parsedFields.ok) {
      return withCors(NextResponse.json(
        { error: parsedFields.error },
        { status: parsedFields.status },
      ));
    }
    const fields = parsedFields.fields;

    if (!fields.instagramSourceField.ok) {
      return withCors(NextResponse.json(
        { error: fields.instagramSourceField.error },
        { status: 400 },
      ));
    }
    if (!fields.promptField.ok) {
      return withCors(NextResponse.json(
        { error: fields.promptField.error },
        { status: 400 },
      ));
    }
    if (!fields.workflowJsonField.ok) {
      return withCors(NextResponse.json(
        { error: fields.workflowJsonField.error },
        { status: 400 },
      ));
    }

    const folderResolution = await resolveExternalUploadFolder(
      fields.cleanFolder,
      fields.effectiveNamespace,
      formData,
    );
    if (!folderResolution.ok) {
      return withCors(NextResponse.json(
        { error: folderResolution.error },
        { status: folderResolution.status },
      ));
    }

    const fileBuffer = Buffer.from(await fileValue.arrayBuffer());
    const outcome = await uploadImageBuffer({
      buffer: fileBuffer,
      originalBuffer: fileBuffer,
      fileName: fileValue.name,
      fileType: fileValue.type,
      fileSize: fileValue.size,
      context: {
        accountId,
        apiToken,
        folder: folderResolution.folder,
        tags: fields.cleanTags,
        displayName: fields.cleanDisplayName,
        description: fields.cleanDescription,
        originalUrl: fields.cleanOriginalUrl,
        sourceUrl: fields.cleanSourceUrl,
        instagramSource: fields.instagramSourceField.instagramSource,
        namespace: fields.effectiveNamespace,
        parentId: fields.cleanParentId,
        duplicateAction: normalizeDuplicateAction(fields.duplicateAction),
        generateSemanticTags: fields.generateSemanticTags,
        semanticTagCount: fields.semanticTagCount,
        comfyWorkflowJson: fields.workflowJsonField.workflowJson,
      },
    });

    if (!outcome.ok) {
      const payload = outcome.duplicates
        ? { error: outcome.error, duplicates: outcome.duplicates.map(toDuplicateSummary) }
        : { error: outcome.error };
      return withCors(NextResponse.json(payload, { status: outcome.status }));
    }

    await upsertRegistryNamespace(fields.effectiveNamespace);
    const promptSave = await persistUploadPrompt(
      [outcome.data.id, outcome.data.webpVariantId],
      fields.promptField.prompt,
    );

    return withCors(NextResponse.json({
      ...outcome.data,
      ...(promptSave ? { promptSave } : {}),
    }));
  } catch (error) {
    console.error('[upload/external] External upload error', error);
    return withCors(NextResponse.json({ error: 'Internal server error' }, { status: 500 }));
  }
}
