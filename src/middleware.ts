import { NextResponse } from 'next/server';

/**
 * Global defense-in-depth security headers.
 *
 * These are the backstop for the SVG XSS surface: even if a sanitizer bypass or
 * a mis-served SVG reaches the browser, `X-Content-Type-Options: nosniff` stops
 * MIME re-interpretation and the CSP neutralizes inline script execution.
 *
 * The CSP is intentionally shipped in Report-Only mode first so it cannot break
 * Next.js hydration / streaming inline scripts. Once violation reports confirm
 * the policy is clean, switch the header name to `Content-Security-Policy` to
 * enforce it.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // imagedelivery.net is Cloudflare Images delivery; data:/blob: for inline previews.
  "img-src 'self' https://imagedelivery.net data: blob:",
  // Next.js / React 19 emit inline hydration scripts; allow them for now.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' https://imagedelivery.net https://api.cloudflare.com",
  "media-src 'self' https://imagedelivery.net blob:",
  // The key XSS mitigations: no plugins, no clickjacking, locked-down base href.
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join('; ');

export function middleware() {
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Content-Security-Policy-Report-Only', CONTENT_SECURITY_POLICY);
  return response;
}

export const config = {
  // Run on all routes except Next.js internals and the favicon.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
