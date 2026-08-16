type ImageAttributes = Record<string, string>;

export const isCargoCollectivePage = (sourceUrl?: string): boolean => {
  if (!sourceUrl) return false;
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();
    return hostname === 'cargocollective.com' || hostname.endsWith('.cargocollective.com');
  } catch {
    return false;
  }
};

// Cargo pages repeat a loader and navigation thumbnails as image tags. Project
// media alone carries both its Cargo media id and the uncapped original source.
export const isCargoCollectiveProjectImage = (attrs: ImageAttributes): boolean =>
  Boolean(attrs['data-mid'] && attrs.src_o);
