/**
 * Reads the built client shell from the assets binding.
 */
export const fetchClientShell = (request: Request, assets: Fetcher): Promise<Response> => {
  const shellRequest = new Request(new URL('/', request.url).toString(), request);
  return assets.fetch(shellRequest);
};

