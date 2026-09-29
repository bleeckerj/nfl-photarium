import { BASE_URL, JSON_REQUEST_HEADERS, RAW_REQUEST_HEADERS } from './config.js';

export class PhotariumApiError extends Error {
  constructor(public readonly status: number, detail: string) {
    super(`API error (${status}): ${detail}`);
    this.name = 'PhotariumApiError';
  }
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...JSON_REQUEST_HEADERS,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new PhotariumApiError(response.status, error);
  }

  return response.json();
}

export async function apiRequestRaw(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...RAW_REQUEST_HEADERS,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new PhotariumApiError(response.status, error);
  }

  return response;
}
