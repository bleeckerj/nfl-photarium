import { cleanString } from '@/utils/cloudflareMetadata';

type TextExtras = {
  description?: string;
  altText?: string;
};

type ImageTextFallbacks = {
  description?: string;
  altTag?: string;
};

export function resolveInitialDescription(
  extras: TextExtras | null | undefined,
  image: ImageTextFallbacks | null | undefined
): string {
  return extras?.description ?? image?.description ?? '';
}

export function resolveInitialAltText(
  extras: TextExtras | null | undefined,
  image: ImageTextFallbacks | null | undefined
): string {
  return extras?.altText ?? image?.altTag ?? '';
}

export function hasDirtyTextMetadata(
  values: {
    descriptionInput?: string | null;
    altTextInput?: string | null;
  },
  extras: TextExtras | null | undefined,
  image: ImageTextFallbacks | null | undefined
): boolean {
  const initialDescription = resolveInitialDescription(extras, image);
  if ((values.descriptionInput ?? '') !== initialDescription) {
    return true;
  }

  const initialAltText = cleanString(resolveInitialAltText(extras, image)) ?? '';
  const currentAltText = cleanString(values.altTextInput ?? '') ?? '';
  return currentAltText !== initialAltText;
}
