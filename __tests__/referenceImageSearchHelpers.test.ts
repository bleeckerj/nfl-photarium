import { describe, expect, it } from 'vitest';
import {
  MAX_REFERENCE_FILE_BYTES,
  buildReferenceSearchFormData,
  extractImageFileFromClipboard,
  formatWarningMessage,
  validateReferenceFile,
} from '@/components/referenceImageSearch';

describe('validateReferenceFile', () => {
  it('accepts common raster formats within the size limit', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']) {
      expect(validateReferenceFile({ type, size: 1024 })).toEqual({ ok: true });
    }
  });

  it('rejects unsupported mime types', () => {
    const result = validateReferenceFile({ type: 'image/heic', size: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Unsupported');
  });

  it('rejects files over the size limit', () => {
    const result = validateReferenceFile({ type: 'image/png', size: MAX_REFERENCE_FILE_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('too large');
  });
});

describe('buildReferenceSearchFormData', () => {
  const file = new File([Buffer.from('bytes') as BlobPart], 'ref.png', { type: 'image/png' });

  it('includes file, limit, and namespace fields', () => {
    const formData = buildReferenceSearchFormData(file, 48, 'ns1');
    expect(formData.get('file')).toBeInstanceOf(File);
    expect(formData.get('limit')).toBe('48');
    expect(formData.get('namespace')).toBe('ns1');
  });

  it('omits namespace when null (all namespaces)', () => {
    const formData = buildReferenceSearchFormData(file, 48, null);
    expect(formData.get('namespace')).toBeNull();
  });

  it('keeps an empty-string namespace (unassigned scope)', () => {
    const formData = buildReferenceSearchFormData(file, 48, '');
    expect(formData.get('namespace')).toBe('');
  });
});

describe('extractImageFileFromClipboard', () => {
  const makeItem = (kind: string, type: string, file: File | null) => ({
    kind,
    type,
    getAsFile: () => file,
  });

  it('returns the first pasted image file', () => {
    const imageFile = new File([Buffer.from('img') as BlobPart], 'paste.png', { type: 'image/png' });
    const items = [
      makeItem('string', 'text/plain', null),
      makeItem('file', 'image/png', imageFile),
    ] as unknown as DataTransferItemList;
    expect(extractImageFileFromClipboard(items)).toBe(imageFile);
  });

  it('ignores non-image files', () => {
    const pdf = new File([Buffer.from('pdf') as BlobPart], 'doc.pdf', { type: 'application/pdf' });
    const items = [makeItem('file', 'application/pdf', pdf)] as unknown as DataTransferItemList;
    expect(extractImageFileFromClipboard(items)).toBeNull();
  });

  it('handles missing clipboard items', () => {
    expect(extractImageFileFromClipboard(null)).toBeNull();
    expect(extractImageFileFromClipboard(undefined)).toBeNull();
  });
});

describe('formatWarningMessage', () => {
  it('maps known warnings to user-facing text', () => {
    expect(formatWarningMessage('clip-unavailable')).toContain('embedding provider');
    expect(formatWarningMessage('vector-search-unavailable')).toContain('Vector search');
  });

  it('returns null for unknown warnings', () => {
    expect(formatWarningMessage('mystery')).toBeNull();
  });
});
