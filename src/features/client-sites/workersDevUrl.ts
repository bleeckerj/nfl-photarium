const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

const cleanString = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeWorkerLabel = (value: string) => value.replace(/[^a-zA-Z0-9-_]/g, '-');

const normalizeWorkersSubdomain = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\.workers\.dev$/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');

const parseWorkersSubdomain = (payload: unknown): string | null => {
  const read = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const normalized = normalizeWorkersSubdomain(value);
    return normalized || null;
  };

  if (payload && typeof payload === 'object') {
    const direct = read((payload as { subdomain?: unknown }).subdomain);
    if (direct) return direct;

    const result = (payload as { result?: unknown }).result;
    if (result && typeof result === 'object') {
      const nested = read((result as { subdomain?: unknown }).subdomain);
      if (nested) return nested;
    }
  }

  return null;
};

export const isLegacyWorkersDevUrl = (value?: string | null) => {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    const labels = hostname.split('.');
    return labels.length === 3 && labels[1] === 'workers' && labels[2] === 'dev';
  } catch {
    return false;
  }
};

export const buildWorkersDevUrl = (workerName: string, accountSubdomain: string) =>
  `https://${normalizeWorkerLabel(workerName)}.${normalizeWorkersSubdomain(accountSubdomain)}.workers.dev`;

export async function resolveAccountWorkersSubdomain(): Promise<string> {
  const envSubdomain =
    cleanString(process.env.CLOUDFLARE_WORKERS_SUBDOMAIN) ||
    cleanString(process.env.CLIENT_SITES_WORKERS_SUBDOMAIN);
  if (envSubdomain) {
    return normalizeWorkersSubdomain(envSubdomain);
  }

  const accountId = cleanString(process.env.CLOUDFLARE_ACCOUNT_ID);
  const apiToken =
    cleanString(process.env.CLIENT_SITES_CLOUDFLARE_API_TOKEN) ||
    cleanString(process.env.CLOUDFLARE_API_TOKEN);

  if (!accountId || !apiToken) {
    throw new Error(
      'Cloudflare workers.dev subdomain is not configured. Set CLOUDFLARE_WORKERS_SUBDOMAIN or provide CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.'
    );
  }

  const response = await fetch(`${CLOUDFLARE_API_BASE}/accounts/${accountId}/workers/subdomain`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Failed to fetch Cloudflare workers.dev subdomain (${response.status}).`);
  }

  const subdomain = parseWorkersSubdomain(payload);
  if (!subdomain) {
    throw new Error('Cloudflare workers.dev subdomain response did not include a subdomain.');
  }

  return subdomain;
}

export async function resolveWorkersDevUrl(workerName: string): Promise<string> {
  const subdomain = await resolveAccountWorkersSubdomain();
  return buildWorkersDevUrl(workerName, subdomain);
}
