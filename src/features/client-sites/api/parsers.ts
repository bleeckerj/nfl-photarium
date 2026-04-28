import type { CreateClientSiteInput, UpdateClientSiteInput } from '../types';

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

export const parseCreateClientSiteInput = (value: unknown): CreateClientSiteInput => {
  const object = ensureObject(value);
  if (typeof object.name !== 'string') {
    throw new Error('Client site name is required.');
  }

  return {
    name: object.name,
    slug: parseOptionalString(object.slug),
    customDomain: parseOptionalString(object.customDomain),
  };
};

export const parseUpdateClientSiteInput = (value: unknown): UpdateClientSiteInput => {
  const object = ensureObject(value);
  return {
    name: parseOptionalString(object.name),
    customDomain: object.customDomain === null ? null : parseOptionalString(object.customDomain),
    status: parseOptionalString(object.status) as UpdateClientSiteInput['status'],
  };
};
