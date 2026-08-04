import { NextRequest, NextResponse } from 'next/server';
import {
  cleanString,
  CLOUDFLARE_EXTRAS_ONLY_FIELDS,
  omitExtrasOnlyCloudflareMetadata,
} from '@/utils/cloudflareMetadata';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import { getCachedImages } from '@/server/cloudflareImageCache';
import { syncMetadataImageById } from '@/server/metadataSearchIndex';
import { listImageFamilyIds } from '@/server/imageFamily';
import { upsertRegistryNamespace } from '@/server/namespaceRegistry';
import { validateParentAssignmentForExistingImage } from '@/server/parentValidation';
import { patchImageExtrasRecord } from '@/server/imageExtras';
import { mergeUserTagsPreservingSystemTags } from '@/utils/systemTags';
import { patchCloudflareImageMetadata } from '@/server/cloudflareImageMetadata';
import { requireValidFolderName } from '@/server/folderPolicy';

const MAX_CLOUDFLARE_TEXT_MIRROR_CHARS = 160;

const toCloudflareTextMirror = (value?: string) => {
  if (!value) return '';
  const compact = value.trim();
  if (!compact) return '';
  return compact.length <= MAX_CLOUDFLARE_TEXT_MIRROR_CHARS
    ? compact
    : `${compact.slice(0, MAX_CLOUDFLARE_TEXT_MIRROR_CHARS)}…`;
};

const isReservedNamespace = (value: string) => value === '__all__' || value === '__none__';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check for required environment variables
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    
    if (!accountId || !apiToken) {
      return NextResponse.json(
        { error: 'Cloudflare credentials not configured' },
        { status: 500 }
      );
    }

    const { id: imageId } = await params;
    const body = await request.json();
    const {
      folder,
      tags,
      description,
      originalUrl,
      sourceUrl,
      parentId,
      displayName,
      altTag,
      variationSort,
      namespace,
      applyToFamily,
      applyToFamilyFields,
    } = body;
    
    if (!imageId) {
      return NextResponse.json(
        { error: 'Image ID is required' },
        { status: 400 }
      );
    }

    const folderProvided = Object.prototype.hasOwnProperty.call(body, 'folder');
    const tagsProvided = Object.prototype.hasOwnProperty.call(body, 'tags');
    const descriptionProvided = Object.prototype.hasOwnProperty.call(body, 'description');
    const originalUrlProvided = Object.prototype.hasOwnProperty.call(body, 'originalUrl');
    const sourceUrlProvided = Object.prototype.hasOwnProperty.call(body, 'sourceUrl');
    const displayNameProvided = Object.prototype.hasOwnProperty.call(body, 'displayName');
    const altTagProvided = Object.prototype.hasOwnProperty.call(body, 'altTag');
    const variationSortProvided = Object.prototype.hasOwnProperty.call(body, 'variationSort');
    const namespaceProvided = Object.prototype.hasOwnProperty.call(body, 'namespace');

    const rawFolder = cleanString(typeof folder === 'string' ? folder : undefined);
    const cleanNamespace = cleanString(typeof namespace === 'string' ? namespace : undefined);
    const cleanDescription =
      typeof description === 'string'
        ? cleanString(description)
        : description === null
          ? ''
          : undefined;
    const cleanOriginalUrl = cleanString(typeof originalUrl === 'string' ? originalUrl : undefined);
    const cleanSourceUrl = cleanString(typeof sourceUrl === 'string' ? sourceUrl : undefined);
    const cleanDisplayName = cleanString(typeof displayName === 'string' ? displayName : undefined);
    const cleanAltTag = cleanString(typeof altTag === 'string' ? altTag : undefined);
    const cleanVariationSort = (() => {
      if (typeof variationSort === 'number' && Number.isFinite(variationSort)) {
        return variationSort;
      }
      if (typeof variationSort === 'string') {
        const parsed = Number(variationSort);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return undefined;
    })();
    const cleanTags = (() => {
      if (Array.isArray(tags)) {
        return tags
          .map((t: string) => cleanString(t))
          .filter((t): t is string => typeof t === 'string');
      }
      if (typeof tags === 'string') {
        return tags
          .split(',')
          .map(tag => cleanString(tag))
          .filter((t): t is string => typeof t === 'string');
      }
      return [];
    })();

    // Store the normalized name the policy returns, not the caller's raw string —
    // otherwise "Inca Trail" passes validation and lands as an invalid folder.
    let cleanFolder = rawFolder;
    if (folderProvided && rawFolder) {
      try {
        cleanFolder = requireValidFolderName(rawFolder);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Invalid folder name' },
          { status: 400 }
        );
      }
    }

    const applyToFamilyRequested = applyToFamily === true;
    const allowedFamilyFields = new Set(['folder', 'namespace']);
    const familyFieldSet = new Set<string>();
    if (Array.isArray(applyToFamilyFields)) {
      applyToFamilyFields.forEach((field: unknown) => {
        if (typeof field === 'string' && allowedFamilyFields.has(field)) {
          familyFieldSet.add(field);
        }
      });
    }
    if (applyToFamilyRequested && familyFieldSet.size === 0) {
      if (folderProvided) familyFieldSet.add('folder');
      if (namespaceProvided) familyFieldSet.add('namespace');
    }
    const shouldApplyToFamily = applyToFamilyRequested && familyFieldSet.size > 0;
    const parentProvided = Object.prototype.hasOwnProperty.call(body, 'parentId');
    const cleanParentId = typeof parentId === 'string' ? parentId.trim() : '';

    if (namespaceProvided && (!cleanNamespace || isReservedNamespace(cleanNamespace))) {
      return NextResponse.json(
        { error: 'A non-empty namespace is required.' },
        { status: 400 }
      );
    }

    if (parentProvided) {
      const parentValidation = await validateParentAssignmentForExistingImage(imageId, cleanParentId);
      if (!parentValidation.ok) {
        return NextResponse.json(
          { error: parentValidation.error },
          { status: parentValidation.status }
        );
      }
    }

    if (namespaceProvided && cleanNamespace) {
      await upsertRegistryNamespace(cleanNamespace);
    }

    type UpdateFlags = {
      folder: boolean;
      tags: boolean;
      description: boolean;
      originalUrl: boolean;
      sourceUrl: boolean;
      displayName: boolean;
      parentId: boolean;
      altTag: boolean;
      variationSort: boolean;
      namespace: boolean;
    };

    const targetFlags: UpdateFlags = {
      folder: folderProvided,
      tags: tagsProvided,
      description: descriptionProvided,
      originalUrl: originalUrlProvided,
      sourceUrl: sourceUrlProvided,
      displayName: displayNameProvided,
      parentId: parentProvided,
      altTag: altTagProvided,
      variationSort: variationSortProvided && cleanVariationSort !== undefined,
      namespace: namespaceProvided,
    };

    const familyFlags: UpdateFlags = {
      folder: folderProvided && familyFieldSet.has('folder'),
      tags: false,
      description: false,
      originalUrl: false,
      sourceUrl: false,
      displayName: false,
      parentId: false,
      altTag: false,
      variationSort: false,
      namespace: namespaceProvided && familyFieldSet.has('namespace'),
    };

    const updateImage = async (targetId: string, flags: UpdateFlags) => {
      const requiredKeys = new Set<string>();
      if (flags.tags) requiredKeys.add('tags');
      if (flags.displayName) requiredKeys.add('displayName');
      if (flags.parentId) requiredKeys.add('variationParentId');
      if (flags.altTag) requiredKeys.add('altTag');
      if (flags.variationSort) requiredKeys.add('variationSort');
      if (flags.namespace) requiredKeys.add('namespace');

      const result = await patchCloudflareImageMetadata(targetId, async (existingMeta) => {
        const metadata = {
          ...existingMeta,
          updatedAt: new Date().toISOString(),
        } as Record<string, unknown>;

        if (flags.tags) {
          metadata.tags = mergeUserTagsPreservingSystemTags(
            Array.isArray(existingMeta.tags) ? existingMeta.tags : [],
            cleanTags
          );
        }

        // Extras-only fields stay in local extras storage, not Cloudflare metadata.
        Object.values(CLOUDFLARE_EXTRAS_ONLY_FIELDS).forEach((field) => {
          delete metadata[field];
        });

        if (flags.displayName) {
          metadata.displayName = cleanDisplayName ?? '';
        }

        if (flags.parentId) {
          // Explicitly allow clearing the parent.
          metadata.variationParentId = cleanParentId;
        }

        if (flags.altTag) {
          metadata.altTag = cleanAltTag ?? '';
        }

        const extrasPatch: {
          folder?: string;
          description?: string;
          altText?: string;
          sourceUrl?: string;
          sourceUrlNormalized?: string;
          originalUrl?: string;
          originalUrlNormalized?: string;
        } = {};
        if (flags.folder) {
          extrasPatch.folder = cleanFolder ?? '';
        }
        if (flags.description) {
          extrasPatch.description = cleanDescription || undefined;
        }
        if (flags.altTag) {
          extrasPatch.altText = cleanAltTag || undefined;
        }
        if (flags.sourceUrl) {
          extrasPatch.sourceUrl = cleanSourceUrl || undefined;
          extrasPatch.sourceUrlNormalized = normalizeOriginalUrl(cleanSourceUrl) || undefined;
        }
        if (flags.originalUrl) {
          extrasPatch.originalUrl = cleanOriginalUrl || undefined;
          extrasPatch.originalUrlNormalized = normalizeOriginalUrl(cleanOriginalUrl) || undefined;
        }
        if (Object.keys(extrasPatch).length > 0) {
          await patchImageExtrasRecord(targetId, extrasPatch);
        }

        // Keep Cloudflare metadata compact: alt text gets a small mirror for fallback surfaces.
        metadata.altTag = toCloudflareTextMirror(
          flags.altTag
            ? (cleanAltTag ?? '')
            : cleanString(typeof metadata.altTag === 'string' ? metadata.altTag : undefined) ?? ''
        );

        if (flags.variationSort && cleanVariationSort !== undefined) {
          metadata.variationSort = cleanVariationSort;
        }

        if (flags.namespace) {
          metadata.namespace = cleanNamespace ?? '';
        }

        return omitExtrasOnlyCloudflareMetadata(metadata);
      }, { requiredKeys });

      console.log(`[Update] Upserting cache for ${targetId} with tags:`, result.cachedImage.tags);

      return {
        metadataPayload: result.metadataPayload,
        filename: result.filename,
      };
    };

    const updatedIds: string[] = [];
    let targetResult: { metadataPayload: Record<string, unknown>; filename?: string } | null = null;

    if (shouldApplyToFamily) {
      const cachedImages = await getCachedImages();
      const { memberIds } = listImageFamilyIds(
        cachedImages.map(img => ({ id: img.id, parentId: img.parentId })),
        imageId
      );

      // Each member's update is an independent Cloudflare GET+PATCH plus local
      // writes; run them through a small worker pool instead of serially.
      const FAMILY_UPDATE_CONCURRENCY = 4;
      const pending = [...memberIds];
      await Promise.all(
        Array.from({ length: Math.min(FAMILY_UPDATE_CONCURRENCY, pending.length) }, async () => {
          for (;;) {
            const memberId = pending.shift();
            if (!memberId) return;
            const result = await updateImage(memberId, memberId === imageId ? targetFlags : familyFlags);
            updatedIds.push(memberId);
            if (memberId === imageId) {
              targetResult = result;
            }
          }
        })
      );
    } else {
      targetResult = await updateImage(imageId, targetFlags);
      updatedIds.push(imageId);
    }

    if (!targetResult) {
      throw new Error('Failed to update image metadata');
    }

    await Promise.all(updatedIds.map((updatedId) => syncMetadataImageById(updatedId)));

    const metadataPayload = targetResult.metadataPayload;
    const finalParentId = cleanString(metadataPayload.variationParentId as string | undefined);
    const finalFolder = targetFlags.folder ? (cleanFolder ?? '') : undefined;
    const finalTags = Array.isArray(metadataPayload.tags) ? metadataPayload.tags : [];
    const finalDescription = targetFlags.description
      ? (cleanDescription ?? '')
      : cleanString(metadataPayload.description as string | undefined) ?? '';
    const finalOriginalUrl = cleanString(metadataPayload.originalUrl as string | undefined);
    const finalSourceUrl = cleanString(metadataPayload.sourceUrl as string | undefined);
    const finalDisplayName =
      (metadataPayload.displayName as string | undefined) ?? targetResult.filename;
    const finalAltTag = targetFlags.altTag
      ? (cleanAltTag ?? '')
      : cleanString(metadataPayload.altTag as string | undefined) ?? '';
    const finalVariationSort =
      typeof metadataPayload.variationSort === 'number' ? metadataPayload.variationSort : undefined;
    const finalNamespace = cleanString(metadataPayload.namespace as string | undefined);

    return NextResponse.json({
      success: true,
      updatedIds,
      folder: finalFolder,
      tags: finalTags,
      description: finalDescription,
      originalUrl: finalOriginalUrl,
      sourceUrl: finalSourceUrl,
      displayName: finalDisplayName,
      parentId: finalParentId,
      altTag: finalAltTag,
      variationSort: finalVariationSort,
      namespace: finalNamespace,
    });

  } catch (error) {
    console.error('Update image error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (
      message.includes('Cloudflare 1024-byte limit')
      || message.toLowerCase().includes('metadata must not exceed 1024 bytes')
    ) {
      return NextResponse.json(
        { error: message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
