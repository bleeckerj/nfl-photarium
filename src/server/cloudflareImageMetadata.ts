import {
  enforceCloudflareMetadataLimit,
  omitExtrasOnlyCloudflareMetadata,
  parseCloudflareMetadata,
  pickCloudflareMetadata,
  type CloudflareMetadata,
} from '@/utils/cloudflareMetadata';
import {
  transformApiImageToCached,
  upsertCachedImage,
  type CachedCloudflareImage,
} from '@/server/cloudflareImageCache';

type CloudflareImageResult = {
  id: string;
  filename?: string;
  uploaded?: string;
  variants?: string[];
  size?: number;
  meta?: unknown;
};

type PatchCloudflareImageMetadataOptions = {
  requiredKeys?: Iterable<string>;
};

export type PatchCloudflareImageMetadataResult = {
  metadataPayload: Record<string, unknown>;
  filename?: string;
  cachedImage: CachedCloudflareImage;
};

const requireCloudflareCredentials = () => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error('Cloudflare credentials not configured');
  }
  return { accountId, apiToken };
};

export const patchCloudflareImageMetadata = async (
  imageId: string,
  buildMetadata: (
    existingMeta: CloudflareMetadata,
    fetchedImage: CloudflareImageResult
  ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  options: PatchCloudflareImageMetadataOptions = {}
): Promise<PatchCloudflareImageMetadataResult> => {
  const { accountId, apiToken } = requireCloudflareCredentials();

  const fetchedImageResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    }
  );

  const fetchedImageResult = await fetchedImageResponse.json();

  if (!fetchedImageResponse.ok) {
    console.error('Cloudflare API error (fetch existing image):', fetchedImageResult);
    throw new Error(
      fetchedImageResult.errors?.[0]?.message || 'Failed to fetch existing image metadata'
    );
  }

  const fetchedImage = fetchedImageResult.result as CloudflareImageResult;
  const metadata = await buildMetadata(parseCloudflareMetadata(fetchedImage?.meta), fetchedImage);
  const metadataPayload = pickCloudflareMetadata(
    omitExtrasOnlyCloudflareMetadata(metadata),
    { includeEmpty: true }
  );
  const requiredKeys = new Set(options.requiredKeys ?? []);
  const metadataLimit = enforceCloudflareMetadataLimit(metadataPayload, 1024);
  const droppedRequired = metadataLimit.dropped.filter((key) => requiredKeys.has(key));
  if (droppedRequired.length > 0) {
    throw new Error(
      `Metadata exceeds Cloudflare 1024-byte limit. Could not apply fields: ${droppedRequired.join(', ')}`
    );
  }
  const finalMetadataPayload = metadataLimit.metadata;

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ metadata: finalMetadataPayload }),
    }
  );

  const result = await response.json();

  if (!response.ok) {
    console.error('Cloudflare API error:', result);
    throw new Error(result.errors?.[0]?.message || 'Failed to update image metadata');
  }

  const cachedImage = transformApiImageToCached({
    id: fetchedImage.id,
    filename: fetchedImage.filename,
    uploaded: fetchedImage.uploaded ?? '',
    variants: fetchedImage.variants ?? [],
    size: fetchedImage.size,
    meta: finalMetadataPayload,
  });
  await upsertCachedImage(cachedImage);

  return {
    metadataPayload: finalMetadataPayload,
    filename: fetchedImage.filename,
    cachedImage,
  };
};
