export const FOLDER_NAME_MAX_LENGTH = 64;

const RESERVED_FOLDER_NAMES = new Set([
  'all',
  'no-folder',
  'unfiled',
  '__create__',
  '__none__',
  '__all__',
]);

const FOLDER_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;

export type FolderPolicyResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

export const normalizeFolderName = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, '-');

export const validateFolderName = (value: string): FolderPolicyResult => {
  const name = normalizeFolderName(value);
  if (!name) return { ok: false, error: 'Folder name is required' };
  if (name.length > FOLDER_NAME_MAX_LENGTH) {
    return { ok: false, error: `Folder names must be ${FOLDER_NAME_MAX_LENGTH} characters or fewer` };
  }
  if (RESERVED_FOLDER_NAMES.has(name)) {
    return { ok: false, error: `The folder name "${name}" is reserved` };
  }
  if (DATE_ONLY_PATTERN.test(name)) {
    return { ok: false, error: 'Date-only folder names are not allowed; use a project or archive name' };
  }
  if (UUID_PATTERN.test(name)) {
    return { ok: false, error: 'Timestamp and UUID-like folder names are not allowed' };
  }
  if (!FOLDER_NAME_PATTERN.test(name)) {
    return { ok: false, error: 'Use lowercase letters, numbers, and single hyphens between words' };
  }
  return { ok: true, name };
};

export class FolderPolicyError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'FolderPolicyError';
  }
}

export const requireValidFolderName = (value: string): string => {
  const result = validateFolderName(value);
  if (!result.ok) throw new FolderPolicyError(result.error);
  return result.name;
};
