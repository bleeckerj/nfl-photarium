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
