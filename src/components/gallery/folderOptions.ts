type FolderBearing = {
  folder?: string | null;
};

type FolderFacet = {
  value?: string | null;
};

const normalizeFolderName = (value?: string | null) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export const collectImageFolders = (images: readonly FolderBearing[]) =>
  images
    .map((image) => normalizeFolderName(image.folder))
    .filter((folder): folder is string => Boolean(folder));

export const collectFacetFolders = (facets?: readonly FolderFacet[] | null) =>
  (facets ?? [])
    .map((entry) => normalizeFolderName(entry.value))
    .filter((folder): folder is string => Boolean(folder));

export const mergeFolderNames = (...sources: Array<readonly (string | null | undefined)[]>) => {
  const names = new Set<string>();
  sources.forEach((source) => {
    source.forEach((entry) => {
      const folder = normalizeFolderName(entry);
      if (folder) names.add(folder);
    });
  });
  return Array.from(names).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
};
