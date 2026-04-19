import type { ParentValidationResult } from '@/server/parentValidation';

export const SPECIFIC_NAMESPACE_REQUIRED_ERROR =
  'A specific namespace is required for uploads. Select a namespace instead of All.';

export const normalizeSpecificNamespace = (value?: string | null) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === '__all__' || trimmed === '__none__') {
    return undefined;
  }
  return trimmed;
};

export const resolveUploadNamespace = (
  requestedNamespace: string | null | undefined,
  parentValidation: Extract<ParentValidationResult, { ok: true }>
) => normalizeSpecificNamespace(requestedNamespace) ?? parentValidation.canonicalParentNamespace;
