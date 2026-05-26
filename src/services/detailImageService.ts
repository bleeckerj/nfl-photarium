export const buildDetailImageUrl = (imageId: string) => {
  const params = new URLSearchParams({ includeVectorMeta: '1' });
  return `/api/images/${encodeURIComponent(imageId)}?${params.toString()}`;
};

export const fetchDetailImageResponse = (imageId: string) => {
  return fetch(buildDetailImageUrl(imageId));
};
