import type {
  CreateClientPageProjectInput,
  ReplaceClientPageSelectionInput,
  UpdateClientPageProjectInput,
} from '../types';

const ensureObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid JSON body.');
  }
  return value as Record<string, unknown>;
};

const parseOptionalString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error('Expected a string value.');
  }
  return value;
};

const parseOptionalStringArray = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error('Expected an array of strings.');
  }
  return value;
};

export const parseCreateClientPageProjectInput = (value: unknown): CreateClientPageProjectInput => {
  const object = ensureObject(value);
  if (typeof object.title !== 'string') {
    throw new Error('Project title is required.');
  }

  return {
    title: object.title,
    clientName: parseOptionalString(object.clientName),
    clientSiteId: parseOptionalString(object.clientSiteId),
    notes: parseOptionalString(object.notes),
    expiresAt: parseOptionalString(object.expiresAt) ?? null,
    sourceNamespaces: parseOptionalStringArray(object.sourceNamespaces),
  };
};

export const parseUpdateClientPageProjectInput = (value: unknown): UpdateClientPageProjectInput => {
  const object = ensureObject(value);
  return {
    title: parseOptionalString(object.title),
    clientName: parseOptionalString(object.clientName),
    clientSiteId: parseOptionalString(object.clientSiteId),
    notes: parseOptionalString(object.notes),
    expiresAt: object.expiresAt === null ? null : parseOptionalString(object.expiresAt),
    sourceNamespaces: parseOptionalStringArray(object.sourceNamespaces),
  };
};

export const parseReplaceClientPageSelectionInput = (
  value: unknown
): ReplaceClientPageSelectionInput => {
  const object = ensureObject(value);
  if (!Array.isArray(object.selectedImageIds) || !object.selectedImageIds.every((entry) => typeof entry === 'string')) {
    throw new Error('selectedImageIds must be an array of strings.');
  }

  return {
    selectedImageIds: object.selectedImageIds,
  };
};
