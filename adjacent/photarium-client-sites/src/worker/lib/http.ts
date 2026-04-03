/**
 * Shared header utilities for public responses.
 */

const noIndexValue = 'noindex, noimageindex, noarchive, nosnippet';

export const applyNoIndexHeaders = (headers: Headers): Headers => {
  headers.set('X-Robots-Tag', noIndexValue);
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cache-Control', 'private, no-store');
  return headers;
};

export const withNoIndex = (response: Response): Response => {
  const headers = applyNoIndexHeaders(new Headers(response.headers));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

