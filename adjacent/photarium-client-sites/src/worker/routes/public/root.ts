import type { Context } from 'hono';
import { fetchClientShell } from '../../lib/client-shell';
import { applyNoIndexHeaders, withNoIndex } from '../../lib/http';
import { getRootProjectBootstrapPath, getRootState } from './root-state';
import type { RootProjectLink } from './root-state';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderBrandAsset = (logoUrl?: string, logoAlt?: string): string => {
  if (!logoUrl?.trim()) return '';
  return `<img class="brand-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(logoAlt || 'Client logo')}" />`;
};

const renderFavicon = (faviconUrl?: string): string =>
  faviconUrl?.trim()
    ? `<link rel="icon" href="${escapeHtml(faviconUrl)}" type="image/png" />`
    : '';

const renderClientProjectIndex = (
  siteName: string,
  entries: RootProjectLink[],
  branding: { faviconUrl?: string; logoUrl?: string; logoAlt?: string }
): string => {
  const cards = entries.map((entry) => `
    <a class="project-card" href="${escapeHtml(getRootProjectBootstrapPath(entry))}">
      <span class="project-card__eyebrow">Client Gallery</span>
      <strong class="project-card__title">${escapeHtml(entry.title)}</strong>
      <span class="project-card__meta">Open gallery</span>
    </a>
  `).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex,nofollow,noarchive" />
    <title>${escapeHtml(siteName)}</title>
    ${renderFavicon(branding.faviconUrl)}
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f5f2;
        --surface: #ffffff;
        --line: #d6d1c7;
        --text: #151515;
        --muted: #626262;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: linear-gradient(180deg, #f8f7f3 0%, var(--bg) 100%);
        color: var(--text);
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(1100px, calc(100% - 32px));
        margin: 0 auto;
        padding: 48px 0 64px;
      }
      header {
        display: grid;
        gap: 12px;
        margin-bottom: 28px;
      }
      .brand-logo {
        width: auto;
        max-width: min(320px, 60vw);
        max-height: 64px;
        height: auto;
        object-fit: contain;
      }
      .eyebrow {
        margin: 0;
        font-family: ui-monospace, Menlo, monospace;
        font-size: 0.82rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }
      h1 {
        margin: 0;
        font-size: clamp(2.6rem, 6vw, 5rem);
        line-height: 0.96;
      }
      .summary {
        margin: 0;
        max-width: 42rem;
        color: var(--muted);
        font-size: 1.1rem;
        line-height: 1.55;
      }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      }
      .project-card {
        display: grid;
        gap: 12px;
        min-height: 200px;
        padding: 20px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--surface);
        color: inherit;
        text-decoration: none;
      }
      .project-card__eyebrow {
        font-family: ui-monospace, Menlo, monospace;
        font-size: 0.72rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .project-card__title {
        font-size: 1.6rem;
        line-height: 1.1;
      }
      .project-card__meta {
        align-self: end;
        color: var(--muted);
        font-size: 0.95rem;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        ${renderBrandAsset(branding.logoUrl, branding.logoAlt)}
        <p class="eyebrow">Client Galleries</p>
        <h1>${escapeHtml(siteName)}</h1>
        <p class="summary">Choose a gallery to review.</p>
      </header>
      <section class="grid">${cards}</section>
    </main>
  </body>
</html>`;
};

const renderMissingProjectsPage = (
  siteName: string,
  branding: { faviconUrl?: string; logoUrl?: string; logoAlt?: string }
): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex,nofollow,noarchive" />
    <title>${escapeHtml(siteName)}</title>
    ${renderFavicon(branding.faviconUrl)}
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f5f5f2;
        color: #151515;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(560px, calc(100% - 32px));
        padding: 28px;
        border: 1px solid #d6d1c7;
        border-radius: 18px;
        background: #fff;
      }
      .brand-logo {
        width: auto;
        max-width: min(280px, 60vw);
        max-height: 56px;
        height: auto;
        margin-bottom: 16px;
        object-fit: contain;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 2rem;
      }
      p {
        margin: 0;
        color: #626262;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      ${renderBrandAsset(branding.logoUrl, branding.logoAlt)}
      <h1>${escapeHtml(siteName)}</h1>
      <p>No client galleries are available at this URL.</p>
    </main>
  </body>
</html>`;

export const handleRootEntry = async (
  context: Context<{ Bindings: Env }>
): Promise<Response> => {
  const state = getRootState(context.req.url, context.env);

  if (state.mode === 'local-dev') {
    const response = await fetchClientShell(context.req.raw, context.env.ASSETS, {
      siteName: context.env.PUBLIC_SITE_NAME,
      faviconUrl: context.env.CLIENT_BRAND_FAVICON_URL,
      logoUrl: context.env.CLIENT_BRAND_LOGO_URL,
      logoAlt: context.env.CLIENT_BRAND_LOGO_ALT,
    });
    return withNoIndex(response);
  }

  if (state.mode === 'index') {
    const headers = applyNoIndexHeaders(new Headers({ 'Content-Type': 'text/html; charset=utf-8' }));
    return new Response(
      renderClientProjectIndex(state.siteName, state.projects, {
        faviconUrl: context.env.CLIENT_BRAND_FAVICON_URL,
        logoUrl: context.env.CLIENT_BRAND_LOGO_URL,
        logoAlt: context.env.CLIENT_BRAND_LOGO_ALT,
      }),
      {
      status: 200,
      headers,
      }
    );
  }

  if (state.mode === 'redirect') {
    return Response.redirect(new URL(state.sharePath, context.req.url).toString(), 302);
  }

  const headers = applyNoIndexHeaders(new Headers({ 'Content-Type': 'text/html; charset=utf-8' }));
  return new Response(
    renderMissingProjectsPage(state.siteName, {
      faviconUrl: context.env.CLIENT_BRAND_FAVICON_URL,
      logoUrl: context.env.CLIENT_BRAND_LOGO_URL,
      logoAlt: context.env.CLIENT_BRAND_LOGO_ALT,
    }),
    {
    status: 404,
    headers,
    }
  );
};
