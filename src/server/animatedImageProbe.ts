import sharp from 'sharp';
import { getCloudflareCredentials } from '@/server/cloudflareClient';

export type AnimatedImageProbeResult = {
  contentType?: string;
  format?: string;
  isAnimated: boolean;
};

const looksAnimated = (metadata: sharp.Metadata) => {
  if (typeof metadata.pages === 'number' && metadata.pages > 1) {
    return true;
  }
  if (
    typeof metadata.height === 'number'
    && typeof metadata.pageHeight === 'number'
    && metadata.pageHeight > 0
    && metadata.height > metadata.pageHeight
  ) {
    return true;
  }
  return false;
};

export async function probeAnimatedImageFromOriginalBlob(imageId: string): Promise<AnimatedImageProbeResult> {
  const { accountId, apiToken } = getCloudflareCredentials();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}/blob`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch original image blob (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const metadata = await sharp(buffer, { animated: true }).metadata();

  return {
    contentType: response.headers.get('content-type') || undefined,
    format: metadata.format || undefined,
    isAnimated: looksAnimated(metadata),
  };
}
