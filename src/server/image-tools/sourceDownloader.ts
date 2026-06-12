import { fetchCloudflareImage, getCloudflareCredentials } from '@/server/cloudflareClient';
import { assertDecodableSourceImage } from '@/server/image-tools/sourceImageValidation';

type CloudflareImageSource = Awaited<ReturnType<typeof fetchCloudflareImage>>;

export type DownloadedSourceImage = {
  buffer: Buffer;
  contentType: string;
  filename: string;
};

const sanitizeFailureDetail = (value: string) =>
  value
    .replace(/https?:\/\/[^\s)]+/g, '<url>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '<host>')
    .replace(/\[?::1\]?(?::\d+)?/g, '<host>');

const pickFallbackVariantUrl = (variants: string[]) => {
  if (!Array.isArray(variants) || variants.length === 0) return undefined;
  return variants.find((url) => url.includes('/public')) || variants[0];
};

const readSourceResponse = async (
  response: Response,
  params: {
    imageId: string;
    filename: string;
  }
): Promise<DownloadedSourceImage> => {
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await response.arrayBuffer());
  await assertDecodableSourceImage({
    buffer,
    contentType,
    filename: params.filename,
    imageId: params.imageId,
  });
  return { buffer, contentType, filename: params.filename };
};

const fetchOriginalBlob = async (params: {
  accountId: string;
  apiToken: string;
  imageId: string;
}) => {
  return fetch(
    `https://api.cloudflare.com/client/v4/accounts/${params.accountId}/images/v1/${params.imageId}/blob`,
    {
      headers: { Authorization: `Bearer ${params.apiToken}` },
      cache: 'no-store',
    }
  );
};

const fetchFallbackVariant = async (source: CloudflareImageSource) => {
  const url = pickFallbackVariantUrl(source.variants);
  if (!url) return undefined;
  return fetch(url, { cache: 'no-store' });
};

const tryFetchFallbackVariant = async (source: CloudflareImageSource) => {
  try {
    return await fetchFallbackVariant(source);
  } catch {
    return undefined;
  }
};

export const downloadSourceImage = async (imageId: string): Promise<DownloadedSourceImage> => {
  const { accountId, apiToken } = getCloudflareCredentials();
  const source = await fetchCloudflareImage(imageId, { accountId, apiToken });
  const filename = source.filename || `${imageId}.bin`;

  let blobResponse: Response;
  try {
    blobResponse = await fetchOriginalBlob({ accountId, apiToken, imageId });
  } catch (error) {
    const variantResponse = await tryFetchFallbackVariant(source);
    if (variantResponse?.ok) {
      return readSourceResponse(variantResponse, { imageId, filename });
    }

    const message = sanitizeFailureDetail(error instanceof Error ? error.message : String(error));
    throw new Error(`Source image download failed: ${message}. Check Cloudflare credentials and source asset availability.`);
  }

  if (blobResponse.ok) {
    return readSourceResponse(blobResponse, { imageId, filename });
  }

  if (blobResponse.status === 403) {
    const variantResponse = await tryFetchFallbackVariant(source);
    if (variantResponse?.ok) {
      return readSourceResponse(variantResponse, { imageId, filename });
    }
  }

  throw new Error(`Failed to download source image from Cloudflare (${blobResponse.status})`);
};
