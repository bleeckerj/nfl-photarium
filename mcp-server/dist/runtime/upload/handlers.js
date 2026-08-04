import { BASE_URL } from '../shared/config.js';
import { apiRequest } from '../shared/api-client.js';
import { normalizeManualPrompt } from '../shared/prompts.js';
import { cleanUploadFilename, camelizeUploadStem, detectImageMimeFromBuffer, extensionFromFilename, extensionFromMimeType, estimateBase64Bytes, withExtension, } from './filenames.js';
import { createAnimation, downloadUpload, importFromUrl, listUploads, uploadFileBase64, uploadFromUrl, } from './client.js';
import { cropPhotariumVariant } from './crop-variant.js';
import { runDiscordRefreshAndIngest, runFilesystemIngest, } from './ingest-commands.js';
export const uploadHandlers = {
    'photarium_tag_enrichment_status': async (args) => {
        const { jobId } = args;
        const result = await apiRequest(`/api/images/tag-enrichment/${encodeURIComponent(jobId)}`);
        return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
    },
    'photarium_upload_url': async (args) => {
        const { url, folder, createFolder, tags, namespace, description, prompt, displayName, originalUrl, sourceUrl, parentId, generateSemanticTags, semanticTagCount } = args;
        const result = await uploadFromUrl(url, { folder, createFolder, tags, namespace, description, prompt, displayName, originalUrl, sourceUrl, parentId, generateSemanticTags, semanticTagCount });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    },
    'photarium_import_url': async (args) => {
        const { url, includeData } = args;
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
    'photarium_upload_file': async (args) => {
        const { base64, filename, contentType, folder, createFolder, tags, description, prompt, originalUrl, sourceUrl, sourcePath, namespace, parentId, generateSemanticTags, semanticTagCount } = args;
        const result = await uploadFileBase64('/api/upload', {
            base64,
            filename,
            contentType,
            folder,
            createFolder,
            tags,
            description,
            prompt,
            originalUrl,
            sourceUrl,
            sourcePath,
            namespace,
            parentId,
            generateSemanticTags,
            semanticTagCount,
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
    'photarium_upload_image': async (args) => {
        const { base64, filename, contentType, folder, createFolder, tags, description, prompt, originalUrl, sourceUrl, namespace, parentId, useExternalApi, generateSemanticTags, semanticTagCount } = args;
        const endpoint = useExternalApi === true ? '/api/upload/external' : '/api/upload';
        const result = await uploadFileBase64(endpoint, {
            base64,
            filename,
            contentType,
            folder,
            createFolder,
            tags,
            description,
            prompt,
            originalUrl,
            sourceUrl,
            namespace,
            parentId,
            generateSemanticTags,
            semanticTagCount,
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
    'photarium_upload_external_file': async (args) => {
        const { base64, filename, contentType, folder, createFolder, tags, description, prompt, originalUrl, sourceUrl, namespace, parentId, generateSemanticTags, semanticTagCount } = args;
        const result = await uploadFileBase64('/api/upload/external', {
            base64,
            filename,
            contentType,
            folder,
            createFolder,
            tags,
            description,
            prompt,
            originalUrl,
            sourceUrl,
            namespace,
            parentId,
            generateSemanticTags,
            semanticTagCount,
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
    'photarium_upload_from_path': async (args) => {
        const { filePath, filename, folder, createFolder, tags, description, prompt, originalUrl, sourceUrl, namespace, parentId, generateSemanticTags, semanticTagCount } = args;
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
            if (folder)
                form.append('folder', folder);
            if (createFolder)
                form.append('createFolder', 'true');
            if (description)
                form.append('description', description);
            const cleanedPrompt = normalizeManualPrompt(prompt);
            if (cleanedPrompt)
                form.append('prompt', cleanedPrompt);
            if (originalUrl)
                form.append('originalUrl', originalUrl);
            if (sourceUrl)
                form.append('sourceUrl', sourceUrl);
            if (namespace)
                form.append('namespace', namespace);
            if (parentId)
                form.append('parentId', parentId);
            if (generateSemanticTags === false)
                form.append('generateSemanticTags', 'false');
            if (semanticTagCount !== undefined)
                form.append('semanticTagCount', String(semanticTagCount));
            if (tags && tags.length > 0) {
                form.append('tags', tags.join(','));
            }
            const response = await fetch(`${BASE_URL}/api/upload`, {
                method: 'POST',
                body: form,
            });
            const rawText = await response.text();
            let result;
            try {
                result = rawText ? JSON.parse(rawText) : {};
            }
            catch {
                result = { raw: rawText };
            }
            if (!response.ok) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                error: result.error || `Upload failed (${response.status})`,
                                status: response.status,
                                filePath,
                                uploadFilename: finalFilename,
                                mimeType,
                                bytes: fileBuffer.byteLength,
                                response: result,
                            }, null, 2),
                        },
                    ],
                    isError: true,
                };
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            ...result,
                            uploadFilename: finalFilename,
                            displayName,
                            mimeType,
                            bytes: fileBuffer.byteLength,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (err) {
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
    'photarium_animate': async (args) => {
        const { frames, fps, loop, folder, tags, description, originalUrl, sourceUrl, namespace, parentId, filename } = args;
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
    'photarium_crop_variant': async (args) => {
        const { imageId, aspectRatio, anchor, quality, filename, folder, createFolder, tags, description, prompt, originalUrl, sourceUrl, namespace, parentId } = args;
        const result = await cropPhotariumVariant({
            imageId,
            aspectRatio,
            anchor,
            quality,
            filename,
            folder,
            createFolder,
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
    'photarium_uploads_list': async (args) => {
        const { page, pageSize, folder } = args;
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
    'photarium_upload_download': async (args) => {
        const { uploadId } = args;
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
    'photarium_fs_ingest': async (args) => {
        const { rootPath, namespace, apiBase, folder, createFolder, tags, descriptionPrefix, includeFilename, includePathTags, aiMetadata, aiDisplayName, aiTags, generateSemanticTags, tagCount, concurrency, throttleMs, limit, dryRun, verbose, } = args;
        const result = await runFilesystemIngest({
            rootPath,
            namespace,
            apiBase: apiBase || BASE_URL,
            folder,
            createFolder,
            tags,
            descriptionPrefix,
            includeFilename,
            includePathTags,
            aiMetadata,
            aiDisplayName,
            aiTags,
            generateSemanticTags,
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
    'photarium_discord_refresh_and_ingest': async (args) => {
        const { discordRepo, imagesRoot, namespace, visuallyNamespace, autotraderNamespace, apiBase, checkpointFile, tags, appendImageTag, descriptionPrefix, tagCount, concurrency, throttleMs, noAiMetadata, includePathTags, includeFilename, hashCacheBackfillOnly, reportCache, assumeUploaded, skipDiscordRefresh, skipIngest, dryRun, verbose, } = args;
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
                purpose: 'Refreshes/downloads latest Discord content into local files when configured, then ingests those local files into Photarium catalog with the same semantics as fs:ingest.',
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
};
