import type { ClientPageProjectStatus } from '../types';

export const formatStatusLabel = (status: ClientPageProjectStatus) =>
  status.charAt(0).toUpperCase() + status.slice(1);

export const formatDateTime = (value?: string | null) => {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export const formatDateOnly = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
};

export const joinNamespaces = (namespaces: string[]) =>
  namespaces.length > 0 ? namespaces.join(', ') : '';
