import { getCloudflareCredentials } from '@/server/cloudflareClient';
import { cleanupImageArtifacts } from '@/server/imageArtifactCleanup';

export async function deleteCloudflareImageWithArtifacts(imageId: string): Promise<void> {
  const { accountId, apiToken } = getCloudflareCredentials();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    }
  );

  const result = await response.json().catch(() => null);
  if (!response.ok && response.status !== 404) {
    throw new Error(result?.errors?.[0]?.message || 'Failed to delete image from Cloudflare');
  }

  const cleanup = await cleanupImageArtifacts(imageId);
  if (!cleanup.success) {
    console.warn('[ImageDelete] Local artifact cleanup had failures', {
      imageId,
      steps: cleanup.steps,
    });
  }
}
