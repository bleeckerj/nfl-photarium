type NamespaceBearingImage = {
  namespace?: string;
};

export const getKnownNamespaces = (
  registryNamespaces: string[],
  images: NamespaceBearingImage[],
  hiddenNamespaces: string[]
): string[] => Array.from(new Set([
  ...registryNamespaces,
  ...images.map(image => image.namespace ?? ''),
  ...hiddenNamespaces,
].map(value => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
