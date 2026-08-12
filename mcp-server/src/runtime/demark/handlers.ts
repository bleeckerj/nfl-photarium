import type { RuntimeToolHandler } from '../types.js';
import {
  DEMARK_DEVICES,
  DEMARK_MODES,
  DEMARK_MODEL_PROFILES,
  type DemarkSettings,
} from './types.js';
import { processDemarkImages } from './service.js';

function requiredImageIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('imageIds must be a non-empty array of strings');
  const ids = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim());
  if (!ids.length) throw new Error('imageIds must be a non-empty array of strings');
  if (ids.length !== value.length) throw new Error('imageIds must contain only non-empty strings');
  return ids;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string, fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${field} must be one of: ${values.join(', ')}`);
  }
  return value as T;
}

function numberValue(value: unknown, field: string, fallback: number, predicate: (candidate: number) => boolean): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || !predicate(value)) {
    throw new Error(`${field} has an invalid value`);
  }
  return value;
}

function settingsFromArgs(args: Record<string, unknown>): DemarkSettings {
  const mode = enumValue(args.mode, DEMARK_MODES, 'mode', 'demark');
  const modelProfile = enumValue(args.modelProfile, DEMARK_MODEL_PROFILES, 'modelProfile', 'ctrlregen');
  const device = enumValue(args.device, DEMARK_DEVICES, 'device', 'auto');
  const strength = numberValue(args.strength, 'strength', 0.04, (value) => value >= 0 && value <= 1);
  const steps = numberValue(args.steps, 'steps', 50, (value) => Number.isInteger(value) && value >= 1);
  if (args.removeAllMetadata !== undefined && typeof args.removeAllMetadata !== 'boolean') {
    throw new Error('removeAllMetadata must be a boolean');
  }
  return {
    mode,
    strength,
    steps,
    modelProfile,
    device,
    removeAllMetadata: args.removeAllMetadata === true,
  };
}

export const demarkHandlers: Record<string, RuntimeToolHandler> = {
  photarium_demark_images: async (args: Record<string, unknown>) => {
    const imageIds = requiredImageIds(args.imageIds);
    const settings = settingsFromArgs(args);
    const result = await processDemarkImages(imageIds, settings);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      ...(result.succeeded === 0 ? { isError: true } : {}),
    };
  },
};
