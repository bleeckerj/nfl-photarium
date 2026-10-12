import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProvenanceIndicator } from '@/components/asset-detail/ProvenanceIndicator';

describe('provenance indicator', () => {
  it('shows an accessible receipt icon only for verified availability', () => {
    expect(renderToStaticMarkup(createElement(ProvenanceIndicator, { available: false }))).toBe('');
    const html = renderToStaticMarkup(createElement(ProvenanceIndicator, { available: true }));
    expect(html).toContain('Generation provenance receipt available');
    expect(html).toContain('data-provenance-available="true"');
    expect(html).toContain('lucide-file-clock');
  });
});
