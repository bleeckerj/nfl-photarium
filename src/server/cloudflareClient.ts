import { CloudflareMetadata } from '@/utils/cloudflareMetadata';

export const getCloudflareCredentials = () => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error('Cloudflare credentials not configured');
  }
  return { accountId, apiToken };
};

export const fetchCloudflareImage = async (
  imageId: string,
  credentials?: { accountId: string; apiToken: string }
) => {
  const { accountId, apiToken } = credentials ?? getCloudflareCredentials();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`
      },
      cache: 'no-store'
    }
  );

  const result = await response.json();
  if (!response.ok) {
    const message = result.errors?.[0]?.message || 'Failed to fetch image from Cloudflare';
    throw new Error(message);
  }

  return result.result as {
    id: string;
    filename: string;
    uploaded: string;
    variants: string[];
    size?: number;
    meta?: CloudflareMetadata | string;
  };
};
