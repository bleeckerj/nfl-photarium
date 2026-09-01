import { describe, expect, it } from 'vitest';

import { buildPromptThisUserText } from '@/server/apiHandlers/imagePrompt';

describe('Prompt This generation policy', () => {
  const baseOptions = {
    filename: 'portrait.png',
    folder: 'studio',
    detailLevel: 'standard' as const,
  };

  it('preserves the Standard policy while identifying the selected level', () => {
    const prompt = buildPromptThisUserText(baseOptions);

    expect(prompt).toContain('Use the Standard detail level');
    expect(prompt).toContain('Aim for 1200-3000 characters');
    expect(prompt).not.toContain('Additional user guidance for specificity');
  });

  it('adds exhaustive High guidance and user nuance to the vision request', () => {
    const prompt = buildPromptThisUserText({
      ...baseOptions,
      detailLevel: 'high',
      promptNuance: 'Emphasize the exact camera height and the texture of the paper.',
    });

    expect(prompt).toContain('Use the High detail level');
    expect(prompt).toContain('silhouette and geometry');
    expect(prompt).toContain('materials and surface texture');
    expect(prompt).toContain('atmosphere, era, visual medium');
    expect(prompt).toContain('Emphasize the exact camera height and the texture of the paper.');
    expect(prompt).toContain('Aim for 2500-5000 characters');
  });
});
