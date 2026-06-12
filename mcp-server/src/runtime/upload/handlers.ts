import { BASE_URL } from '../shared/config.js';
import { normalizeManualPrompt } from '../shared/prompts.js';
import type { RuntimeToolHandler } from '../types.js';
import {
  cleanUploadFilename,
  camelizeUploadStem,
  detectImageMimeFromBuffer,
  extensionFromFilename,
  extensionFromMimeType,
  estimateBase64Bytes,
  withExtension,
} from './filenames.js';
import {
  createAnimation,
  downloadUpload,
  importFromUrl,
  listUploads,
  uploadFileBase64,
  uploadFromUrl,
} from './client.js';
import { cropPhotariumVariant, type CropVariantAnchor } from './crop-variant.js';
import {
  runDiscordRefreshAndIngest,
  runFilesystemIngest,
  runInstagramSingleUrlIngest,
} from './ingest-commands.js';

export const uploadHandlers: Record<string, RuntimeToolHandler> = {
  'photarium_upload_url': async (args: Record<string, unknown>) => {
    const { url, folder, tags, namespace, description, prompt, displayName, originalUrl, sourceUrl, parentId } = args as {
      url: string;
      folder?: string;
      tags?: string[];
      namespace?: string;
      description?: string;
      prompt?: string;
      displayName?: string;
      originalUrl?: string;
      sourceUrl?: string;
      parentId?: string;
    };
    const result = await uploadFromUrl(url, { folder, tags, namespace, description, prompt, displayName, originalUrl, sourceUrl, parentId });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_import_url': async (args: Record<string, unknown>) => {
    const { url, includeData } = args as { url: string; includeData?: boolean };
    const result = await importFromUrl(url);
    const response = includeData === true
      ? result
      : {
          ...result,
          data: undefined,
          dataOmitted: true,
          dataBytes: estimateBase64Bytes(result.data),
        };
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  },

  'photarium_upload_file': async (args: Record<string, unknown>) => {
    const { base64, filename, contentType, folder, tags, description, prompt, originalUrl, sourceUrl, sourcePath, namespace, parentId } = args as {
      base64: string;
      filename: string;
      contentType?: string;
      folder?: string;
      tags?: string[];
      description?: string;
      prompt?: string;
      originalUrl?: string;
      sourceUrl?: string;
      sourcePath?: string;
      namespace?: string;
      parentId?: string;
    };
    const result = await uploadFileBase64('/api/upload', {
      base64,
      filename,
      contentType,
      folder,
      tags,
      description,
      prompt,
      originalUrl,
      sourceUrl,
      sourcePath,
      namespace,
      parentId,
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_upload_image': async (args: Record<string, unknown>) => {
    const { base64, filename, contentType, folder, tags, description, prompt, originalUrl, sourceUrl, namespace, parentId, useExternalApi } = args as {
      base64: string;
      filename: string;
      contentType?: string;
      folder?: string;
      tags?: string[];
      description?: string;
      prompt?: string;
      originalUrl?: string;
      sourceUrl?: string;
      namespace?: string;
      parentId?: string;
      useExternalApi?: boolean;
    };
    const endpoint = useExternalApi === false ? '/api/upload' : '/api/upload/external';
    const result = await uploadFileBase64(endpoint, {
      base64,
      filename,
      contentType,
      folder,
      tags,
      description,
      prompt,
      originalUrl,
      sourceUrl,
      namespace,
      parentId,
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_upload_external_file': async (args: Record<string, unknown>) => {
    const { base64, filename, contentType, folder, tags, description, prompt, originalUrl, sourceUrl, namespace, parentId } = args as {
      base64: string;
      filename: string;
      contentType?: string;
      folder?: string;
      tags?: string[];
      description?: string;
      prompt?: string;
      originalUrl?: string;
      sourceUrl?: string;
      namespace?: string;
      parentId?: string;
    };
    const result = await uploadFileBase64('/api/upload/external', {
      base64,
      filename,
      contentType,
      folder,
      tags,
      description,
      prompt,
      originalUrl,
      sourceUrl,
      namespace,
      parentId,
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_upload_from_path': async (args: Record<string, unknown>) => {
    const { filePath, filename, folder, tags, description, prompt, originalUrl, sourceUrl, namespace, parentId } = args as {
      filePath: string;
      filename?: string;
      folder?: string;
      tags?: string[];
      description?: string;
      prompt?: string;
      originalUrl?: string;
      sourceUrl?: string;
      namespace?: string;
      parentId?: string;
    };

    try {
      const { readFileSync, statSync } = await import('node:fs');
      const stats = statSync(filePath);
      if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${filePath}`);
      }
      if (stats.size <= 0) {
        throw new Error(`File is empty: ${filePath}`);
      }

      const fileBuffer = readFileSync(filePath);
      const detectedMime = detectImageMimeFromBuffer(fileBuffer);
      if (!detectedMime) {
        throw new Error('File does not contain recognized image data');
      }

      const requestedFilename = cleanUploadFilename(filename || filePath.split('/').pop() || 'upload');
      const requestedExt = extensionFromFilename(requestedFilename);
      const effectiveExt = requestedExt || extensionFromMimeType(detectedMime) || '.png';
      const semanticStem = camelizeUploadStem(requestedFilename.replace(/\.[^.]+$/, ''));
      const finalFilename = withExtension(semanticStem || 'UploadedImage', effectiveExt);
      const displayName = semanticStem || finalFilename.replace(/\.[^.]+$/, '');
      const mimeType = detectedMime;

      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), finalFilename);
      form.append('displayName', displayName);
      if (folder) form.append('folder', folder);
      if (description) form.append('description', description);
      const cleanedPrompt = normalizeManualPrompt(prompt);
      if (cleanedPrompt) form.append('prompt', cleanedPrompt);
      if (originalUrl) form.append('originalUrl', originalUrl);
      if (sourceUrl) form.append('sourceUrl', sourceUrl);
      if (namespace) form.append('namespace', namespace);
      if (parentId) form.append('parentId', parentId);
      if (tags && tags.length > 0) {
        form.append('tags', tags.join(','));
      }

      const response = await fetch(`${BASE_URL}/api/upload`, {
        method: 'POST',
        body: form,
      });

      const rawText = await response.text();
      let result: Record<string, unknown>;
      try {
        result = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      } catch {
        result = { raw: rawText };
      }
      if (!response.ok) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: (result.error as string | undefined) || `Upload failed (${response.status})`,
                  status: response.status,
                  filePath,
                  uploadFilename: finalFilename,
                  mimeType,
                  bytes: fileBuffer.byteLength,
                  response: result,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...result,
                uploadFilename: finalFilename,
                displayName,
                mimeType,
                bytes: fileBuffer.byteLength,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Error uploading from path: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },

  'photarium_animate': async (args: Record<string, unknown>) => {
    const { frames, fps, loop, folder, tags, description, originalUrl, sourceUrl, namespace, parentId, filename } = args as {
      frames: Array<{ kind: 'url'; url: string } | { kind: 'base64'; data: string; filename: string; contentType?: string }>;
      fps?: number;
      loop?: boolean;
      folder?: string;
      tags?: string[];
      description?: string;
      originalUrl?: string;
      sourceUrl?: string;
      namespace?: string;
      parentId?: string;
      filename?: string;
    };
    const result = await createAnimation({ frames, fps, loop, folder, tags, description, originalUrl, sourceUrl, namespace, parentId, filename });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_crop_variant': async (args: Record<string, unknown>) => {
    const { imageId, aspectRatio, anchor, quality, filename, folder, tags, description, prompt, originalUrl, sourceUrl, namespace, parentId } = args as {
      imageId: string;
      aspectRatio?: string;
      anchor?: CropVariantAnchor;
      quality?: number;
      filename?: string;
      folder?: string;
      tags?: string[];
      description?: string;
      prompt?: string;
      originalUrl?: string;
      sourceUrl?: string;
      namespace?: string;
      parentId?: string;
    };
    const result = await cropPhotariumVariant({
      imageId,
      aspectRatio,
      anchor,
      quality,
      filename,
      folder,
      tags,
      description,
      prompt,
      originalUrl,
      sourceUrl,
      namespace,
      parentId,
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_uploads_list': async (args: Record<string, unknown>) => {
    const { page, pageSize, folder } = args as { page?: number; pageSize?: number; folder?: string };
    const result = await listUploads({ page, pageSize, folder });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_upload_download': async (args: Record<string, unknown>) => {
    const { uploadId } = args as { uploadId: string };
    const result = await downloadUpload(uploadId);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },

  'photarium_fs_ingest': async (args: Record<string, unknown>) => {
    const {
      rootPath,
      namespace,
      apiBase,
      folder,
      tags,
      descriptionPrefix,
      includeFilename,
      includePathTags,
      aiMetadata,
      aiDisplayName,
      aiTags,
      tagCount,
      concurrency,
      throttleMs,
      limit,
      dryRun,
      verbose,
    } = args as {
      rootPath: string;
      namespace: string;
      apiBase?: string;
      folder?: string;
      tags?: string[];
      descriptionPrefix?: string;
      includeFilename?: boolean;
      includePathTags?: boolean;
      aiMetadata?: boolean;
      aiDisplayName?: boolean;
      aiTags?: boolean;
      tagCount?: number;
      concurrency?: number;
      throttleMs?: number;
      limit?: number;
      dryRun?: boolean;
      verbose?: boolean;
    };

    const result = await runFilesystemIngest({
      rootPath,
      namespace,
      apiBase: apiBase || BASE_URL,
      folder,
      tags,
      descriptionPrefix,
      includeFilename,
      includePathTags,
      aiMetadata,
      aiDisplayName,
      aiTags,
      tagCount,
      concurrency,
      throttleMs,
      limit,
      dryRun,
      verbose,
    });

    const response = {
      ok: result.ok,
      exitCode: result.exitCode,
      command: result.command,
      stdout: result.stdout,
      stderr: result.stderr,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
      ...(result.ok ? {} : { isError: true }),
    };
  },

  'photarium_discord_refresh_and_ingest': async (args: Record<string, unknown>) => {
    const {
      discordRepo,
      imagesRoot,
      namespace,
      visuallyNamespace,
      autotraderNamespace,
      apiBase,
      checkpointFile,
      tags,
      appendImageTag,
      descriptionPrefix,
      tagCount,
      concurrency,
      throttleMs,
      noAiMetadata,
      includePathTags,
      includeFilename,
      hashCacheBackfillOnly,
      reportCache,
      assumeUploaded,
      skipDiscordRefresh,
      skipIngest,
      dryRun,
      verbose,
    } = args as {
      discordRepo?: string;
      imagesRoot?: string;
      namespace?: string;
      visuallyNamespace?: string;
      autotraderNamespace?: string;
      apiBase?: string;
      checkpointFile?: string;
      tags?: string[];
      appendImageTag?: string;
      descriptionPrefix?: string;
      tagCount?: number;
      concurrency?: number;
      throttleMs?: number;
      noAiMetadata?: boolean;
      includePathTags?: boolean;
      includeFilename?: boolean;
      hashCacheBackfillOnly?: boolean;
      reportCache?: boolean;
      assumeUploaded?: boolean;
      skipDiscordRefresh?: boolean;
      skipIngest?: boolean;
      dryRun?: boolean;
      verbose?: boolean;
    };

    const result = await runDiscordRefreshAndIngest({
      discordRepo,
      imagesRoot,
      namespace,
      visuallyNamespace,
      autotraderNamespace,
      apiBase,
      checkpointFile,
      tags,
      appendImageTag,
      descriptionPrefix,
      tagCount,
      concurrency,
      throttleMs,
      noAiMetadata,
      includePathTags,
      includeFilename,
      hashCacheBackfillOnly,
      reportCache,
      assumeUploaded,
      skipDiscordRefresh,
      skipIngest,
      dryRun,
      verbose,
    });

    const response = {
      ok: result.ok,
      exitCode: result.exitCode,
      command: result.command,
      stdout: result.stdout,
      stderr: result.stderr,
      metadata: {
        purpose:
          'Refreshes/downloads latest Discord content into local files when configured, then ingests those local files into Photarium catalog with the same semantics as fs:ingest.',
      },
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
      ...(result.ok ? {} : { isError: true }),
    };
  },

  'photarium_instagram_ingest_single_url': async (args: Record<string, unknown>) => {
    const {
      url,
      username,
      namespace,
      apiBase,
      profileDir,
      output,
      requestDelayMs,
      headful,
      verbose,
    } = args as {
      url: string;
      username?: string;
      namespace?: string;
      apiBase?: string;
      profileDir?: string;
      output?: string;
      requestDelayMs?: number;
      headful?: boolean;
      verbose?: boolean;
    };

    const result = await runInstagramSingleUrlIngest({
      url,
      username,
      namespace,
      apiBase,
      profileDir,
      output,
      requestDelayMs,
      headful,
      verbose,
    });

    const response = {
      ok: result.ok,
      exitCode: result.exitCode,
      command: result.command,
      stdout: result.stdout,
      stderr: result.stderr,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
      ...(result.ok ? {} : { isError: true }),
    };
  },
};
