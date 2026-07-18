import { describe, expect, it } from 'vitest';
import { normalizeFolderName, validateFolderName } from '@/server/folderPolicy';

describe('folder policy', () => {
  it('normalizes approved names', () => {
    expect(normalizeFolderName(' Project  AndSons ')).toBe('project-andsons');
    expect(validateFolderName(' Project  AndSons ')).toEqual({ ok: true, name: 'project-andsons' });
  });

  it.each(['2026-07-18', '550e8400-e29b-41d4-a716-446655440000', 'all', 'no folder'])(
    'rejects uncontrolled folder name %s',
    (name) => {
      expect(validateFolderName(name).ok).toBe(false);
    }
  );

  it('rejects names that do not follow the kebab-case grammar', () => {
    expect(validateFolderName('project/andsons').ok).toBe(false);
    expect(validateFolderName('project_andsons').ok).toBe(false);
  });
});
