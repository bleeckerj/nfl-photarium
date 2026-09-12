import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiCharacteristicsIndicator, isAiCharacteristicsDetected } from '@/components/asset-detail/AiCharacteristicsIndicator';

describe('AiCharacteristicsIndicator', () => {
  it('stays hidden without a positive persisted marker', () => {
    expect(isAiCharacteristicsDetected({ aiCharacteristicsDetected: false })).toBe(false);
    expect(renderToStaticMarkup(React.createElement(AiCharacteristicsIndicator, {
      asset: { aiCharacteristicsDetected: false },
    }))).toBe('');
  });

  it('renders an accessible source-aware label for positive evidence', () => {
    const markup = renderToStaticMarkup(React.createElement(AiCharacteristicsIndicator, {
      asset: {
        aiCharacteristicsDetected: true,
        aiCharacteristicsSources: ['ai-metadata', 'c2pa-jumbf'],
      },
    }));

    expect(markup).toContain('Embedded AI evidence detected (AI metadata, C2PA/JUMBF)');
    expect(markup).toContain('aria-label="Embedded AI evidence detected (AI metadata, C2PA/JUMBF)"');
    expect(markup).toContain('AI evidence');
  });
});
