interface ClientShellBranding {
  siteName: string;
  faviconUrl?: string;
  logoUrl?: string;
  logoAlt?: string;
}

const defaultOpenGraphDescription = 'Asset Review Gallery';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const applyBranding = (html: string, branding: ClientShellBranding): string => {
  const title = escapeHtml(branding.siteName);
  const faviconUrl = branding.faviconUrl?.trim();
  const logoUrl = branding.logoUrl?.trim();
  const logoAlt = escapeHtml(branding.logoAlt?.trim() || `${branding.siteName} logo`);
  const description = escapeHtml(defaultOpenGraphDescription);
  const openGraphMarkup = [
    `<meta name="description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta name="twitter:card" content="${logoUrl ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    logoUrl ? `<meta property="og:image" content="${escapeHtml(logoUrl)}" />` : '',
    logoUrl ? `<meta property="og:image:alt" content="${logoAlt}" />` : '',
    logoUrl ? `<meta name="twitter:image" content="${escapeHtml(logoUrl)}" />` : '',
  ]
    .filter(Boolean)
    .join('\n    ');

  let output = html.replace('<title>Photarium Client Site</title>', `<title>${title}</title>`);
  output = output.replace('</title>', `</title>\n    ${openGraphMarkup}`);

  if (faviconUrl) {
    output = output.replace(
      /<link rel="icon" href="[^"]+" type="[^"]+" \/>/,
      `<link rel="icon" href="${escapeHtml(faviconUrl)}" type="image/png" />`
    );
  }

  const logoMarkup = logoUrl
    ? `<img class="review-bar__brand-logo" src="${escapeHtml(logoUrl)}" alt="${logoAlt}" />`
    : '';

  output = output.replace(
    '<div class="review-bar__meta">',
    `<div class="review-bar__meta">${logoMarkup}`
  );

  return output;
};

/**
 * Reads the built client shell from the assets binding and applies per-site branding.
 */
export const fetchClientShell = async (
  request: Request,
  assets: Fetcher,
  branding: ClientShellBranding
): Promise<Response> => {
  const shellRequest = new Request(new URL('/', request.url).toString(), request);
  const response = await assets.fetch(shellRequest);
  const html = await response.text();
  const brandedHtml = applyBranding(html, branding);
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(brandedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
