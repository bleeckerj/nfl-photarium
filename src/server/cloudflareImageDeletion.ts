import { getCloudflareCredentials } from '@/server/cloudflareClient';
import { cleanupImageArtifacts } from '@/server/imageArtifactCleanup';

const CLOUDFLARE_IMAGE_DELETE_TIMEOUT_MS = Math.max(
  2_000,
  Number(process.env.CLOUDFLARE_IMAGE_DELETE_TIMEOUT_MS ?? 15_000)
);

export class CloudflareImageDeleteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function deleteCloudflareImageAsset(imageId: string): Promise<void> {
  const { accountId, apiToken } = getCloudflareCredentials();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLOUDFLARE_IMAGE_DELETE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
        signal: controller.signal,
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CloudflareImageDeleteError(
        504,
        `Cloudflare image delete timed out after ${CLOUDFLARE_IMAGE_DELETE_TIMEOUT_MS}ms`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const result = await response.json().catch(() => null);
  if (!response.ok && response.status !== 404) {
    throw new CloudflareImageDeleteError(
      response.status,
      result?.errors?.[0]?.message || 'Failed to delete image from Cloudflare'
    );
  }
}

export async function deleteCloudflareImageWithArtifacts(imageId: string): Promise<void> {
  await deleteCloudflareImageAsset(imageId);

  const cleanup = await cleanupImageArtifacts(imageId);
  if (!cleanup.success) {
    console.warn('[ImageDelete] Local artifact cleanup had failures', {
      imageId,
      steps: cleanup.steps,
    });
  }
}
