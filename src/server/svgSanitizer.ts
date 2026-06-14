import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

/**
 * Server-side SVG sanitizer.
 *
 * User-uploaded SVG is XML and can carry active content — <script>, inline event
 * handlers (onload/onclick/...), <foreignObject> (an HTML escape hatch), and
 * external/entity references (XXE, billion-laughs). Serving such SVG same-origin
 * enables stored XSS. This module strips that content before the SVG is ever
 * stored or served.
 *
 * Trade-offs / kept-on-purpose:
 *  - <use> is kept; DOMPurify keeps same-document references safe.
 *  - <a> is kept but DOMPurify's default ALLOWED_URI_REGEXP neutralises
 *    javascript:/data: hrefs, so only navigational links survive.
 *  - <foreignObject>, <script>, <iframe> are always removed.
 *  - DOCTYPE / ENTITY declarations are stripped before parsing to defend against
 *    XXE and entity-expansion attacks (jsdom does not resolve external entities,
 *    but we strip defensively).
 */

// Reused across calls — constructing JSDOM per-invocation is expensive.
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);

const PURIFY_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'foreignObject', 'iframe'],
  FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover', 'onbegin', 'onend', 'onrepeat'],
};

// Strip DOCTYPE and ENTITY declarations (XXE / entity-expansion) before parsing.
const stripDoctypeAndEntities = (svg: string): string =>
  svg.replace(/<!DOCTYPE[^>]*(\[[\s\S]*?\])?[^>]*>/gi, '').replace(/<!ENTITY[^>]*>/gi, '');

export type SanitizeSvgResult =
  | { ok: true; buffer: Buffer; modified: boolean }
  | { ok: false; error: string };

/**
 * Sanitize an SVG buffer, returning a cleaned buffer safe to store/serve.
 * Rejects input that does not contain a parseable <svg> element.
 */
export function sanitizeSvgBuffer(buffer: Buffer): SanitizeSvgResult {
  let raw: string;
  try {
    raw = buffer.toString('utf8');
  } catch {
    return { ok: false, error: 'SVG could not be decoded as UTF-8 text' };
  }

  if (!/<svg[\s>]/i.test(raw)) {
    return { ok: false, error: 'File does not contain a valid <svg> element' };
  }

  const preprocessed = stripDoctypeAndEntities(raw);
  const clean = DOMPurify.sanitize(preprocessed, PURIFY_CONFIG);

  if (!clean || !/<svg[\s>]/i.test(clean)) {
    return { ok: false, error: 'SVG was empty or invalid after sanitization' };
  }

  const sanitizedBuffer = Buffer.from(clean, 'utf8');
  // Compare against the original bytes to report whether anything was removed.
  const modified = !sanitizedBuffer.equals(buffer);
  return { ok: true, buffer: sanitizedBuffer, modified };
}
