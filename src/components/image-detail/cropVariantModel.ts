import type { CloudflareImage } from '@/components/image-detail/types';
import type { CropVariantAnchor, CropVariantPlacement } from '@/services/cropVariantService';

export type RatioOption = { label: string; value: string };
export type ExpansionProvider = 'auto' | 'openai' | 'comfyui';

export const RATIO_OPTIONS: RatioOption[] = [
  { label: '1:1', value: '1:1' },
  { label: '3:2', value: '3:2' },
  { label: '4:5', value: '4:5' },
  { label: '5:4', value: '5:4' },
  { label: '9:16', value: '9:16' },
  { label: '16:9', value: '16:9' },
  { label: 'Custom', value: 'custom' },
];

export const ANCHORS: Array<{ label: string; value: CropVariantAnchor }> = [
  { label: 'Top', value: 'top' },
  { label: 'Center', value: 'center' },
  { label: 'Bottom', value: 'bottom' },
];

export const HORIZONTAL_PLACEMENTS: Array<{ label: string; value: CropVariantPlacement }> = [
  { label: 'Left', value: 'left' },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'right' },
];

export const VERTICAL_PLACEMENTS: Array<{ label: string; value: CropVariantPlacement }> = [
  { label: 'Top', value: 'top' },
  { label: 'Center', value: 'center' },
  { label: 'Bottom', value: 'bottom' },
];

export function parseRatio(value: string) {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height, label: value.trim() };
}

export function buildDefaultFilename(image: CloudflareImage) {
  const base = (image.displayName || image.filename || image.id).replace(/\.[^.]+$/, '');
  return `${base}-crop`;
}

export function alignUp(value: number, multiple: number) {
  return Math.ceil(value / multiple) * multiple;
}

export function splitTags(value: string) {
  const tags = value.split(',').map((tag) => tag.trim()).filter(Boolean);
  return tags.length ? Array.from(new Set(tags)) : undefined;
}
