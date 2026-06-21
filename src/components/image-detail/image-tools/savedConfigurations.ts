import type { ImageToolControl, ImageToolManifest } from '@/services/imageToolsService';
import {
  buildInitialValues,
  type ToolValues,
} from '@/components/image-detail/image-tools/controlModel';

export const IMAGE_TOOL_CONFIGURATIONS_STORAGE_KEY = 'imageToolSavedConfigurations';
const STORAGE_VERSION = 1;

export type SavedImageToolConfiguration = {
  id: string;
  toolId: string;
  name: string;
  values: ToolValues;
  createdAt: string;
  updatedAt: string;
};

type StorageDriver = Pick<Storage, 'getItem' | 'setItem'>;

type StoredConfigurationsEnvelope = {
  version: number;
  configurations: SavedImageToolConfiguration[];
};

type UpsertSavedImageToolConfigurationOptions = {
  tool: ImageToolManifest;
  name: string;
  values: ToolValues;
  existingId?: string;
  storage?: StorageDriver | null;
  now?: Date;
  idFactory?: () => string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isPrimitiveToolValue = (value: unknown): value is ToolValues[string] =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const getBrowserStorage = (): StorageDriver | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const createConfigurationId = () => {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  return `image-tool-config-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeStoredValues = (value: unknown): ToolValues => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, ToolValues[string]] => isPrimitiveToolValue(entry[1]))
  );
};

const normalizeStoredConfiguration = (value: unknown): SavedImageToolConfiguration | null => {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const toolId = typeof value.toolId === 'string' ? value.toolId.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : '';
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : '';
  if (!id || !toolId || !name || !createdAt || !updatedAt) return null;

  return {
    id,
    toolId,
    name,
    values: normalizeStoredValues(value.values),
    createdAt,
    updatedAt,
  };
};

export const readSavedImageToolConfigurations = (
  storage: StorageDriver | null = getBrowserStorage()
): SavedImageToolConfiguration[] => {
  if (!storage) return [];
  try {
    const raw = storage.getItem(IMAGE_TOOL_CONFIGURATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const configurations = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && parsed.version === STORAGE_VERSION && Array.isArray(parsed.configurations)
        ? parsed.configurations
        : [];

    return configurations
      .map(normalizeStoredConfiguration)
      .filter((configuration): configuration is SavedImageToolConfiguration => Boolean(configuration));
  } catch (error) {
    console.warn('Failed to parse saved image tool configurations', error);
    return [];
  }
};

const writeSavedImageToolConfigurations = (
  configurations: SavedImageToolConfiguration[],
  storage: StorageDriver | null = getBrowserStorage()
) => {
  if (!storage) return;
  const envelope: StoredConfigurationsEnvelope = {
    version: STORAGE_VERSION,
    configurations,
  };
  storage.setItem(IMAGE_TOOL_CONFIGURATIONS_STORAGE_KEY, JSON.stringify(envelope));
};

const sortConfigurations = (configurations: SavedImageToolConfiguration[]) =>
  [...configurations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const getSavedImageToolConfigurations = (
  toolId: string,
  storage: StorageDriver | null = getBrowserStorage()
) => sortConfigurations(readSavedImageToolConfigurations(storage).filter((configuration) => configuration.toolId === toolId));

const normalizeNumberValue = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeSelectValue = (control: ImageToolControl, value: unknown) => {
  if (!isPrimitiveToolValue(value)) return undefined;
  const stringValue = String(value);
  if (!(control.options ?? []).some((option) => String(option.value) === stringValue)) return undefined;
  return stringValue;
};

const normalizeStoredControlValue = (control: ImageToolControl, value: unknown) => {
  if (control.type === 'switch') return typeof value === 'boolean' ? value : undefined;
  if (control.type === 'number' || control.type === 'slider') return normalizeNumberValue(value);
  if (control.type === 'select') return normalizeSelectValue(control, value);
  if (control.type === 'text' || control.type === 'color') return typeof value === 'string' ? value : undefined;
  return undefined;
};

export const normalizeSavedToolValues = (tool: ImageToolManifest, values: ToolValues): ToolValues => {
  const next = buildInitialValues(tool);
  tool.controls.forEach((control) => {
    const value = normalizeStoredControlValue(control, values[control.id]);
    if (value !== undefined) {
      next[control.id] = value;
    }
  });
  return next;
};

export const upsertSavedImageToolConfiguration = ({
  tool,
  name,
  values,
  existingId,
  storage = getBrowserStorage(),
  now = new Date(),
  idFactory = createConfigurationId,
}: UpsertSavedImageToolConfigurationOptions) => {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Configuration name is required.');
  }

  const configurations = readSavedImageToolConfigurations(storage);
  const existingIndexById = existingId
    ? configurations.findIndex((configuration) => configuration.toolId === tool.id && configuration.id === existingId)
    : -1;
  const existingIndex = existingIndexById >= 0
    ? existingIndexById
    : configurations.findIndex(
      (configuration) => configuration.toolId === tool.id && configuration.name.toLowerCase() === trimmedName.toLowerCase()
    );
  const existing = existingIndex >= 0 ? configurations[existingIndex] : null;
  const timestamp = now.toISOString();
  const configuration: SavedImageToolConfiguration = {
    id: existing?.id ?? idFactory(),
    toolId: tool.id,
    name: trimmedName,
    values: normalizeSavedToolValues(tool, values),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  const nextConfigurations = [...configurations];
  if (existingIndex >= 0) {
    nextConfigurations[existingIndex] = configuration;
  } else {
    nextConfigurations.unshift(configuration);
  }

  writeSavedImageToolConfigurations(nextConfigurations, storage);

  return {
    configuration,
    configurations: sortConfigurations(nextConfigurations.filter((item) => item.toolId === tool.id)),
  };
};

export const deleteSavedImageToolConfiguration = (
  toolId: string,
  configurationId: string,
  storage: StorageDriver | null = getBrowserStorage()
) => {
  const nextConfigurations = readSavedImageToolConfigurations(storage).filter(
    (configuration) => !(configuration.toolId === toolId && configuration.id === configurationId)
  );
  writeSavedImageToolConfigurations(nextConfigurations, storage);
  return sortConfigurations(nextConfigurations.filter((configuration) => configuration.toolId === toolId));
};
