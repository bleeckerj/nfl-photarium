import { cleanString, parseCloudflareMetadata, pickCloudflareMetadata } from './cloudflareMetadata';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.warn('Cloudflare credentials missing; folder management endpoints will fail.');
}

export interface CloudflareImageRecord {
  id: string;
  filename?: string;
  uploaded: string;
  variants: string[];
  folder?: string;
  namespace?: string;
  linkedAssetId?: string;
}

type CloudflareImageApiRecord = {
  id: string;
  filename?: string;
  uploaded: string;
  variants?: unknown;
  meta?: unknown;
};

async function apiFetch(url: string, init?: RequestInit) {
  if (!ACCOUNT_ID || !API_TOKEN) {
    throw new Error('Cloudflare credentials not configured');
  }
  const resp = await fetch(url, {
    ...init,
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      ...(init?.headers || {}),
    }
  });
  return resp;
}

export async function fetchCloudflareImages(): Promise<CloudflareImageRecord[]> {
  const resp = await apiFetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1`);
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json.errors?.[0]?.message || 'Failed to fetch Cloudflare images');
  }
  const records: CloudflareImageRecord[] = Array.isArray(json.result?.images)
    ? json.result.images.map((image: CloudflareImageApiRecord) => {
        const meta = parseCloudflareMetadata(image.meta);
        const folder = cleanString(typeof meta.folder === 'string' ? meta.folder : undefined);
        const namespace = cleanString(typeof meta.namespace === 'string' ? meta.namespace : undefined);
        const linkedAssetId = cleanString(typeof meta.linkedAssetId === 'string' ? meta.linkedAssetId : undefined);
        return {
          id: image.id,
          filename: image.filename,
          uploaded: image.uploaded,
          variants: Array.isArray(image.variants) ? image.variants : [],
          folder,
          namespace,
          linkedAssetId,
        };
      })
    : [];
  return records;
}

export async function updateImageFolder(imageId: string, folder?: string) {
  if (!ACCOUNT_ID || !API_TOKEN) {
    throw new Error('Cloudflare credentials not configured');
  }
  const fetchResp = await apiFetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1/${imageId}`);
  const fetchJson = await fetchResp.json();
  if (!fetchResp.ok) {
    throw new Error(fetchJson.errors?.[0]?.message || 'Failed to fetch existing metadata');
  }
  const existingMeta = parseCloudflareMetadata(fetchJson.result?.meta);
  const metadata = {
    ...existingMeta,
    updatedAt: new Date().toISOString(),
  } as Record<string, unknown>;
  metadata.folder = cleanString(folder);
  const metadataPayload = pickCloudflareMetadata(metadata);

  const patchResp = await apiFetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1/${imageId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ metadata: metadataPayload }),
    }
  );
  const patchJson = await patchResp.json();
  if (!patchResp.ok) {
    throw new Error(patchJson.errors?.[0]?.message || 'Failed to update metadata');
  }
}
