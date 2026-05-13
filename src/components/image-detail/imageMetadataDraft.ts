import { cleanString } from '@/utils/cloudflareMetadata';
import { mergeUserTagsPreservingSystemTags, getUserVisibleTags } from '@/utils/systemTags';
import {
  hasDirtyTextMetadata,
  resolveInitialAltText,
  resolveInitialDescription,
} from './metadataValueResolvers';

export type ImageMetadataDraftAsset = {
  folder?: string;
  tags?: string[];
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  displayName?: string;
  filename?: string;
  altTag?: string;
  exif?: Record<string, string | number>;
};

export type ImageMetadataDraftExtras = {
  imageId?: string;
  folder?: string;
  description?: string;
  altText?: string;
} | null;

export type ImageMetadataDraftValues = {
  folderSelect: string;
  newFolderInput: string;
  tagsInput: string;
  descriptionInput: string;
  altTextInput: string;
  originalUrlInput: string;
  sourceUrlInput: string;
  displayNameInput: string;
  clearExif: boolean;
};

export type ImageMetadataSaveResponse = {
  folder?: string;
  tags?: unknown;
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  displayName?: string;
};

export const emptyImageMetadataDraftValues = (): ImageMetadataDraftValues => ({
  folderSelect: '',
  newFolderInput: '',
  tagsInput: '',
  descriptionInput: '',
  altTextInput: '',
  originalUrlInput: '',
  sourceUrlInput: '',
  displayNameInput: '',
  clearExif: false,
});

export const parseUserTagsInput = (value: string) =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => !tag.startsWith('_'));

export function resolveImageMetadataDraftValues(
  image: ImageMetadataDraftAsset | null | undefined,
  extras: ImageMetadataDraftExtras
): ImageMetadataDraftValues {
  if (!image) {
    return emptyImageMetadataDraftValues();
  }

  return {
    folderSelect: image.folder || '',
    newFolderInput: '',
    tagsInput: getUserVisibleTags(image.tags).join(', '),
    descriptionInput: resolveInitialDescription(extras, image),
    altTextInput: resolveInitialAltText(extras, image),
    originalUrlInput: image.originalUrl || '',
    sourceUrlInput: image.sourceUrl || '',
    displayNameInput: image.displayName || image.filename || '',
    clearExif: false,
  };
}

export function isImageMetadataDraftDirty(
  values: ImageMetadataDraftValues,
  image: ImageMetadataDraftAsset | null | undefined,
  extras: ImageMetadataDraftExtras
): boolean {
  if (!image) {
    return false;
  }

  const finalFolder = values.folderSelect === '__create__'
    ? cleanString(values.newFolderInput) ?? ''
    : cleanString(values.folderSelect) ?? '';
  const imageFolder = cleanString(image.folder) ?? '';
  if (finalFolder !== imageFolder) {
    return true;
  }

  const inputTags = values.tagsInput ? parseUserTagsInput(values.tagsInput) : [];
  const imageTags = getUserVisibleTags(image.tags);
  const normalizeTags = (tags: string[]) => [...tags].map((tag) => tag.trim()).filter(Boolean).sort();
  const normalizedInputTags = normalizeTags(inputTags);
  const normalizedImageTags = normalizeTags(imageTags);
  if (normalizedInputTags.length !== normalizedImageTags.length) {
    return true;
  }
  for (let i = 0; i < normalizedInputTags.length; i += 1) {
    if (normalizedInputTags[i] !== normalizedImageTags[i]) {
      return true;
    }
  }

  if (hasDirtyTextMetadata(
    {
      descriptionInput: values.descriptionInput,
      altTextInput: values.altTextInput,
    },
    extras,
    image
  )) {
    return true;
  }

  const originalValue = cleanString(values.originalUrlInput) ?? '';
  const imageOriginal = cleanString(image.originalUrl) ?? '';
  if (originalValue !== imageOriginal) {
    return true;
  }

  const displayNameValue = cleanString(values.displayNameInput) ?? '';
  const imageDisplayName = cleanString(image.displayName || image.filename) ?? '';
  if (displayNameValue !== imageDisplayName) {
    return true;
  }

  return values.clearExif;
}

export function buildImageMetadataSavePayload(
  values: ImageMetadataDraftValues,
  image: ImageMetadataDraftAsset
): Record<string, unknown> {
  const finalFolder = values.folderSelect === '__create__'
    ? (values.newFolderInput.trim() || undefined)
    : values.folderSelect;
  const cleanedOriginalUrl = cleanString(values.originalUrlInput);
  const cleanedSourceUrl = cleanString(values.sourceUrlInput);
  const payload: Record<string, unknown> = {
    folder: finalFolder,
    tags: mergeUserTagsPreservingSystemTags(image.tags, parseUserTagsInput(values.tagsInput)),
    description: values.descriptionInput,
    originalUrl: cleanedOriginalUrl ?? '',
    sourceUrl: cleanedSourceUrl ?? '',
    displayName: cleanString(values.displayNameInput) ?? '',
    altTag: cleanString(values.altTextInput) ?? '',
  };

  if (values.clearExif) {
    payload.clearExif = true;
  }

  return payload;
}

export function applyImageMetadataSaveResponse<T extends ImageMetadataDraftAsset>(
  image: T,
  response: ImageMetadataSaveResponse,
  values: ImageMetadataDraftValues
): T {
  const hasFolderResponse = Object.prototype.hasOwnProperty.call(response, 'folder');
  return {
    ...image,
    folder: hasFolderResponse ? response.folder : image.folder,
    tags: Array.isArray(response.tags)
      ? response.tags.filter((tag): tag is string => typeof tag === 'string')
      : mergeUserTagsPreservingSystemTags(image.tags, parseUserTagsInput(values.tagsInput)),
    description: values.descriptionInput,
    originalUrl: response.originalUrl,
    sourceUrl: response.sourceUrl,
    displayName: response.displayName,
    altTag: cleanString(values.altTextInput) ?? '',
    exif: values.clearExif ? undefined : image.exif,
  };
}

export function resolveImageMetadataDraftValuesAfterSave(
  savedImage: ImageMetadataDraftAsset,
  values: ImageMetadataDraftValues
): ImageMetadataDraftValues {
  return {
    ...resolveImageMetadataDraftValues(savedImage, {
      folder: savedImage.folder,
      description: values.descriptionInput,
      altText: values.altTextInput,
    }),
    // A newly typed folder is now a saved existing folder value.
    folderSelect: savedImage.folder || '',
    newFolderInput: '',
    clearExif: false,
  };
}
