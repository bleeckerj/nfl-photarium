import { Sparkles } from 'lucide-react';

type AiCharacteristicsLike = {
  aiCharacteristicsDetected?: boolean;
  aiCharacteristicsSources?: Array<'ai-metadata' | 'c2pa-jumbf'>;
};

export function isAiCharacteristicsDetected(asset: AiCharacteristicsLike | null | undefined): boolean {
  return asset?.aiCharacteristicsDetected === true;
}

const sourceLabel = (source: 'ai-metadata' | 'c2pa-jumbf') =>
  source === 'c2pa-jumbf' ? 'C2PA/JUMBF' : 'AI metadata';

export function AiCharacteristicsIndicator({
  asset,
  id,
  showLabel = true,
}: {
  asset: AiCharacteristicsLike | null | undefined;
  id?: string;
  showLabel?: boolean;
}) {
  if (!isAiCharacteristicsDetected(asset)) return null;

  const sources = asset?.aiCharacteristicsSources?.map(sourceLabel) ?? [];
  const detail = sources.length ? ` (${sources.join(', ')})` : '';
  const label = `Embedded AI evidence detected${detail}`;
  return (
    <span
      id={id}
      className={
        showLabel
          ? 'inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700'
          : 'inline-flex items-center justify-center rounded-md border border-gray-200 bg-white/95 p-1 shadow'
      }
      title={label}
      aria-label={label}
    >
      <Sparkles className={showLabel ? 'h-3.5 w-3.5' : 'h-3 w-3'} aria-hidden="true" />
      {showLabel ? 'AI evidence' : null}
    </span>
  );
}
