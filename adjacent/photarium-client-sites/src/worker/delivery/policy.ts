import type { DownloadPresetDefinition, DownloadPresetPolicy, OutputFormat, ViewPresetDefinition } from '../publishing-contract/types';

/**
 * Policy lookup helpers for named delivery presets.
 */
export const resolveViewPreset = (
  policy: DownloadPresetPolicy,
  presetName: string
): ViewPresetDefinition | null =>
  policy.viewPresets.find((preset) => preset.name === presetName) ?? null;

export const resolveDownloadPreset = (
  policy: DownloadPresetPolicy,
  presetName: string
): DownloadPresetDefinition | null =>
  policy.downloadPresets.find((preset) => preset.name === presetName) ?? null;

export const isOutputFormatAllowed = (
  policy: DownloadPresetPolicy,
  format: string
): format is OutputFormat =>
  policy.allowedOutputFormats.includes(format as OutputFormat);
