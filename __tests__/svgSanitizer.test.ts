import { describe, expect, it } from 'vitest';
import { sanitizeSvgBuffer } from '@/server/svgSanitizer';

const toBuffer = (svg: string) => Buffer.from(svg, 'utf8');
const sanitizeToString = (svg: string) => {
  const result = sanitizeSvgBuffer(toBuffer(svg));
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result.buffer.toString('utf8');
};

describe('sanitizeSvgBuffer', () => {
  it('accepts a benign SVG unchanged in spirit', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>';
    const result = sanitizeSvgBuffer(toBuffer(svg));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.buffer.toString('utf8')).toContain('<rect');
      expect(result.buffer.toString('utf8')).toContain('fill="red"');
    }
  });

  it('strips <script> elements', () => {
    const out = sanitizeToString(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>'
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('strips inline event handlers (onload/onclick)', () => {
    const out = sanitizeToString(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect onclick="evil()"/></svg>'
    );
    expect(out.toLowerCase()).not.toContain('onload');
    expect(out.toLowerCase()).not.toContain('onclick');
  });

  it('strips <foreignObject> (HTML-in-SVG escape hatch)', () => {
    const out = sanitizeToString(
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body>hi</body></foreignObject><rect/></svg>'
    );
    expect(out.toLowerCase()).not.toContain('foreignobject');
  });

  it('neutralizes javascript: hrefs', () => {
    const out = sanitizeToString(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)">x</a></svg>'
    );
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('strips DOCTYPE / ENTITY declarations (XXE / entity expansion)', () => {
    const out = sanitizeToString(
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
        '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
    );
    expect(out).not.toContain('DOCTYPE');
    expect(out).not.toContain('ENTITY');
    expect(out).not.toContain('etc/passwd');
  });

  it('reports modified=true when unsafe content was removed', () => {
    const result = sanitizeSvgBuffer(
      toBuffer('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script><rect/></svg>')
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.modified).toBe(true);
  });

  it('rejects input that is not an SVG', () => {
    const result = sanitizeSvgBuffer(Buffer.from('<html><body>not svg</body></html>', 'utf8'));
    expect(result.ok).toBe(false);
  });
});
