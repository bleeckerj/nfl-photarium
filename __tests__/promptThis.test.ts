import { beforeEach, describe, expect, it, vi } from 'vitest';

const extrasState = new Map<string, unknown>();

vi.mock('@/server/extrasStorage', () => ({
  getExtrasStorage: () => ({
    get: async <T>(key: string) => (extrasState.has(key) ? extrasState.get(key) as T : null),
    getMany: async <T>(keys: string[]) => Object.fromEntries(
      keys.map((key) => [key, extrasState.has(key) ? extrasState.get(key) as T : null]),
    ),
    set: async <T>(key: string, value: T) => { extrasState.set(key, value); },
    delete: async (key: string) => { extrasState.delete(key); },
    exists: async (key: string) => extrasState.has(key),
  }),
}));

import { getPromptThisRecord, getPromptThisKey, setPromptThisRecord } from '@/server/promptThis';

describe('Prompt This persistence', () => {
  beforeEach(() => extrasState.clear());

  it('round-trips High detail settings with the current prompt', async () => {
    await setPromptThisRecord({
      imageId: 'image-1',
      prompt: 'A highly specific prompt',
      model: 'prompt-model',
      provider: 'openai',
      detailLevel: 'high',
      promptNuance: 'Emphasize the worn metal and side lighting.',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });

    await expect(getPromptThisRecord('image-1')).resolves.toMatchObject({
      detailLevel: 'high',
      promptNuance: 'Emphasize the worn metal and side lighting.',
    });
  });

  it('defaults legacy prompt records to Standard during migration', async () => {
    extrasState.set(getPromptThisKey('legacy-image'), {
      imageId: 'legacy-image',
      prompt: 'A legacy prompt',
      model: 'old-model',
      provider: 'openai',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });

    await expect(getPromptThisRecord('legacy-image')).resolves.toMatchObject({ detailLevel: 'standard' });
    expect((extrasState.get('image-extras:legacy-image') as { promptThis?: { detailLevel?: string } })?.promptThis?.detailLevel)
      .toBe('standard');
  });
});
