import { parseCloudflareMetadata, cleanString, CloudflareMetadata } from '@/utils/cloudflareMetadata';

interface CloudflareImageApiResponse {
  id: string;
  filename?: string;
  uploaded: string;
  variants: string[];
  meta?: unknown;
  size?: number;
}

export interface UploadRecord {
  uploadId: string;
  cloudflareUrl: string;
  folder?: string;
  filename?: string;
  originalUrl?: string;
  bytes?: number;
  contentHash?: string;
  createdAt: string;
}

export interface UploadListResult {
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextPage?: number;
  total: number;
  uploads: UploadRecord[];
}

const CF_PAGE_SIZE_LIMIT = 100;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 250;

const ensureEnv = () => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error('Cloudflare credentials not configured');
  }
  return { accountId, apiToken };
};

const fetchCloudflarePage = async (
  page: number,
  perPage: number
): Promise<CloudflareImageApiResponse[]> => {
  const { accountId, apiToken } = ensureEnv();

  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage)
  });

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`
      },
      cache: 'no-store'
    }
  );

  const json = await response.json();

  if (!response.ok) {
    const message = json?.errors?.[0]?.message || 'Failed to fetch Cloudflare uploads';
    throw new Error(message);
  }

  return Array.isArray(json?.result?.images) ? json.result.images : [];
};

const pickVariantUrl = (variants: string[]): string => {
  if (!variants?.length) {
    throw new Error('Cloudflare image has no variants');
  }
  const publicVariant = variants.find((variant) => variant.includes('/public'));
  return publicVariant ?? variants[0];
};

const extractBytes = (meta: CloudflareMetadata, fallback?: number) => {
  const sizeFields = ['size', 'bytes', 'fileSize'];
  for (const field of sizeFields) {
    const value = meta?.[field];
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return fallback;
};

const extractHash = (meta: CloudflareMetadata) => {
  const raw =
    cleanString(meta?.contentHash as string) ||
    cleanString(meta?.hash as string) ||
    cleanString(meta?.sha256 as string);
  return raw?.replace(/^sha256:/i, '').toLowerCase();
};

const toUploadRecord = (image: CloudflareImageApiResponse): UploadRecord => {
  const metadata = parseCloudflareMetadata(image.meta);
  const folder = cleanString(metadata.folder as string);
  const originalUrl = cleanString(metadata.originalUrl as string);
  const filename = image.filename || cleanString(metadata.filename as string) || undefined;

  return {
    uploadId: image.id,
    cloudflareUrl: pickVariantUrl(image.variants),
    folder,
    filename,
    originalUrl,
    bytes: extractBytes(metadata, image.size),
    contentHash: extractHash(metadata),
    createdAt: image.uploaded
  };
};

const clampPageSize = (pageSize: number) =>
  Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize || DEFAULT_PAGE_SIZE));

export async function listUploads(params: {
  page?: number;
  pageSize?: number;
  folder?: string | null;
}): Promise<UploadListResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = clampPageSize(params.pageSize ?? DEFAULT_PAGE_SIZE);
  const folderFilter = params.folder ? params.folder.trim() : undefined;

  if (!folderFilter) {
    const cfPageSize = Math.min(pageSize, CF_PAGE_SIZE_LIMIT);
    const images = await fetchCloudflarePage(page, cfPageSize);
    const uploads = images.map(toUploadRecord);
    return {
      page,
      pageSize: cfPageSize,
      hasMore: images.length === cfPageSize,
      nextPage: images.length === cfPageSize ? page + 1 : undefined,
      total: uploads.length,
      uploads
    };
  }

  // Folder filtering requires scanning Cloudflare pages client-side
  const matches: UploadRecord[] = [];
  const targetStart = (page - 1) * pageSize;
  let cfPage = 1;
  let exhausted = false;

  while (matches.length < targetStart + pageSize && !exhausted) {
    const batch = await fetchCloudflarePage(cfPage, CF_PAGE_SIZE_LIMIT);
    if (!batch.length) {
      exhausted = true;
      break;
    }
    batch.forEach((image) => {
      const record = toUploadRecord(image);
      if (record.folder === folderFilter) {
        matches.push(record);
      }
    });
    if (batch.length < CF_PAGE_SIZE_LIMIT) {
      exhausted = true;
    }
    cfPage += 1;
  }

  const slice = matches.slice(targetStart, targetStart + pageSize);
  const hasMore = !exhausted && matches.length >= targetStart + pageSize;

  return {
    page,
    pageSize,
    hasMore,
    nextPage: hasMore ? page + 1 : undefined,
    total: matches.length,
    uploads: slice
  };
}

export async function getUploadDownloadInfo(uploadId: string) {
  const { accountId, apiToken } = ensureEnv();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${uploadId}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`
      },
      cache: 'no-store'
    }
  );
  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.errors?.[0]?.message || 'Failed to fetch Cloudflare image';
    throw new Error(message);
  }
  const result = payload?.result;
  if (!result?.variants?.length) {
    throw new Error('Cloudflare image is missing variants');
  }
  const downloadUrl = pickVariantUrl(result.variants);
  const metadata = parseCloudflareMetadata(result.meta);
  const contentType = cleanString(metadata?.type as string) || response.headers.get('content-type') || undefined;
  return {
    url: downloadUrl,
    filename: result.filename || uploadId,
    contentType: contentType ?? 'application/octet-stream',
    size: typeof result.size === 'number' ? result.size : undefined
  };
}
