'use client';

import clsx from 'clsx';
import type { MouseEvent } from 'react';

export interface ColorSwatchesProps {
  assetId?: string;
  dominantColors?: string[];
  averageColor?: string;
  size?: 'compact' | 'default';
  showLabels?: boolean;
  className?: string;
  onSelectColor?: (hex: string) => void;
}

const MAX_SWATCHES = 5;

interface PaletteCopyPayload {
  id: string;
  palette: string[];
}

export function normalizePaletteHex(color: string): string | null {
  const normalizedColor = color.trim().replace(/^#/, '');
  const hex = normalizedColor.length === 3
    ? normalizedColor.split('').map((digit) => `${digit}${digit}`).join('')
    : normalizedColor;

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return null;
  }

  return `#${hex.toLowerCase()}`;
}

export function buildPaletteCopyPayload(assetId: string, colors: string[]): PaletteCopyPayload {
  return {
    id: assetId,
    palette: colors
      .map(normalizePaletteHex)
      .filter((color): color is string => color !== null),
  };
}

export function formatPaletteJson(assetId: string, colors: string[]): string {
  return JSON.stringify(buildPaletteCopyPayload(assetId, colors), null, 2);
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export function ColorSwatches({
  assetId,
  dominantColors,
  averageColor,
  size = 'default',
  showLabels = false,
  className,
  onSelectColor,
}: ColorSwatchesProps) {
  const palette =
    dominantColors
      ?.reduce<string[]>((colors, color) => {
        if (typeof color !== 'string') {
          return colors;
        }

        const normalizedColor = color.trim();
        if (!normalizedColor || colors.includes(normalizedColor)) {
          return colors;
        }

        colors.push(normalizedColor);
        return colors;
      }, [])
      .slice(0, MAX_SWATCHES) ?? [];
  const hasAverage = typeof averageColor === 'string' && averageColor.trim().length > 0;

  if (!hasAverage && palette.length === 0) {
    return null;
  }

  const swatchClassName = size === 'compact' ? 'h-3 w-3' : 'h-4 w-4';
  const labelClassName = size === 'compact' ? 'text-[0.55rem]' : 'text-[0.65rem]';
  const rootClassName = size === 'compact' ? 'gap-2' : 'gap-3';
  const paletteLabelClassName = clsx(
    'mr-1 inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 uppercase tracking-wide text-gray-400 shadow-sm transition',
    'hover:border-gray-300 hover:bg-white hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-300',
    labelClassName
  );
  const swatchClassNameInteractive = clsx(
    'inline-block rounded-sm border border-gray-300 shadow-sm',
    swatchClassName,
    onSelectColor
      ? 'cursor-pointer transition hover:scale-105 hover:ring-2 hover:ring-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400'
      : ''
  );
  const handleCopyPalette = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void copyTextToClipboard(formatPaletteJson(assetId ?? '', palette));
  };

  return (
    <div className={clsx('flex flex-wrap items-center font-3270 text-gray-500', rootClassName, className)}>
      {hasAverage && (
        <div className="flex items-center gap-1.5">
          {onSelectColor ? (
            <button
              type="button"
              className={swatchClassNameInteractive}
              style={{ backgroundColor: averageColor }}
              title={`Average color ${averageColor}`}
              aria-label={`Average color ${averageColor}`}
              onClick={() => onSelectColor(averageColor)}
            />
          ) : (
            <span
              className={swatchClassNameInteractive}
              style={{ backgroundColor: averageColor }}
              title={`Average color ${averageColor}`}
              aria-label={`Average color ${averageColor}`}
            />
          )}
          {showLabels && (
            <span className={clsx('uppercase tracking-wide', labelClassName)}>
              avg {averageColor}
            </span>
          )}
        </div>
      )}
      {palette.length > 0 && (
        <div className="flex items-center gap-1">
          {showLabels && (
            <button
              type="button"
              className={paletteLabelClassName}
              title="Copy palette JSON"
              aria-label="Copy palette JSON"
              onClick={handleCopyPalette}
            >
              PALETTE
            </button>
          )}
          {palette.map((color) => (
            onSelectColor ? (
              <button
                key={color}
                type="button"
                className={swatchClassNameInteractive}
                style={{ backgroundColor: color }}
                title={color}
                aria-label={`Dominant color ${color}`}
                onClick={() => onSelectColor(color)}
              />
            ) : (
              <span
                key={color}
                className={swatchClassNameInteractive}
                style={{ backgroundColor: color }}
                title={color}
                aria-label={`Dominant color ${color}`}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}
