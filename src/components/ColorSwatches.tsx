'use client';

import clsx from 'clsx';

export interface ColorSwatchesProps {
  dominantColors?: string[];
  averageColor?: string;
  size?: 'compact' | 'default';
  showLabels?: boolean;
  className?: string;
  onSelectColor?: (hex: string) => void;
}

const MAX_SWATCHES = 5;

export function ColorSwatches({
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
  const swatchClassNameInteractive = clsx(
    'inline-block rounded-sm border border-gray-300 shadow-sm',
    swatchClassName,
    onSelectColor
      ? 'cursor-pointer transition hover:scale-105 hover:ring-2 hover:ring-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400'
      : ''
  );

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
            <span className={clsx('mr-1 uppercase tracking-wide text-gray-400', labelClassName)}>
              palette
            </span>
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
