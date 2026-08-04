import { beforeEach, describe, expect, it, vi } from 'vitest';

const listCatalogImagesWithFolderOverrides = vi.fn();
const listStoredFolders = vi.fn();

vi.mock('@/server/folderInventory', () => ({
  listCatalogImagesWithFolderOverrides: () => listCatalogImagesWithFolderOverrides(),
}));

vi.mock('@/utils/folderStore', () => ({
  listStoredFolders: (namespace: string | null) => listStoredFolders(namespace),
}));

const {
  UnknownFolderError,
  listKnownFolderNames,
  parseCreateFolderFlag,
  requireFilableFolder,
  suggestSimilarFolders,
} = await import('@/server/folderCreationPolicy');

const image = (folder: string, namespace?: string) => ({ id: folder, folder, namespace });

describe('folder creation policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listStoredFolders.mockResolvedValue([]);
    listCatalogImagesWithFolderOverrides.mockResolvedValue([
      image('blog-2026', 'cf-default'),
      image('service-manual-illustrations', 'cf-default'),
      image('headshots', 'other-namespace'),
    ]);
  });

  it('files into a folder that already exists, normalizing the name', async () => {
    await expect(requireFilableFolder(' Blog  2026 ', 'cf-default', false)).resolves.toBe('blog-2026');
  });

  it('rejects a folder that does not exist without an explicit opt-in', async () => {
    await expect(requireFilableFolder('service-manual-illustrations-codex-imagegen', 'cf-default', false))
      .rejects.toBeInstanceOf(UnknownFolderError);
  });

  it('suggests existing folders when it rejects, so callers reuse instead of create', async () => {
    const error = await requireFilableFolder('service-manual-illustrations-codex', 'cf-default', false)
      .catch((err: Error) => err);
    expect(error.message).toContain('service-manual-illustrations');
    expect(error.message).toContain('createFolder=true');
  });

  it('creates the folder when the operator explicitly authorizes it', async () => {
    await expect(requireFilableFolder('Project AndSons', 'cf-default', true)).resolves.toBe('project-andsons');
    // The opt-in path must not need the catalog at all.
    expect(listCatalogImagesWithFolderOverrides).not.toHaveBeenCalled();
  });

  it('still enforces the name grammar when creation is authorized', async () => {
    await expect(requireFilableFolder('signals/ec5808f44b2f', 'cf-default', true)).rejects.toThrow();
    await expect(requireFilableFolder('2026-08-01', 'cf-default', true)).rejects.toThrow();
  });

  it('scopes known folders to the namespace', async () => {
    const known = await listKnownFolderNames('cf-default');
    expect(known.has('blog-2026')).toBe(true);
    expect(known.has('headshots')).toBe(false);
  });

  it('includes stored folders that hold no images yet', async () => {
    listStoredFolders.mockResolvedValue(['ads-to-use']);
    await expect(requireFilableFolder('ads-to-use', 'cf-default', false)).resolves.toBe('ads-to-use');
  });

  it('ranks suggestions by shared tokens', () => {
    const suggestions = suggestSimilarFolders('blog-2027', ['blog-2026', 'blog', 'headshots']);
    expect(suggestions).toContain('blog-2026');
    expect(suggestions).not.toContain('headshots');
  });

  it('treats only the literal string "true" as authorization', () => {
    expect(parseCreateFolderFlag('true')).toBe(true);
    expect(parseCreateFolderFlag('TRUE')).toBe(true);
    expect(parseCreateFolderFlag('1')).toBe(false);
    expect(parseCreateFolderFlag('yes')).toBe(false);
    expect(parseCreateFolderFlag(null)).toBe(false);
  });
});
