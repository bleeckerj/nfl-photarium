import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromptThisDetailLevel } from '@/server/promptThisOptions';

type PromptThisMeta = {
  saved?: boolean;
  updatedAt?: string;
  model?: string;
  detailLevel?: PromptThisDetailLevel;
  promptNuance?: string;
} | null;
type SavePromptThisOptions = {
  prompt?: string;
  suppressSuccessToast?: boolean;
};

const PROMPT_THIS_AUTOSAVE_DELAY_MS = 900;

export const usePromptThisEditor = ({
  imageId,
  toastPush,
}: {
  imageId?: string;
  toastPush: (message: string) => void;
}) => {
  const [promptThisInput, setPromptThisInput] = useState('');
  const [promptThisLoading, setPromptThisLoading] = useState(false);
  const [promptThisGenerating, setPromptThisGenerating] = useState(false);
  const [promptThisSaving, setPromptThisSaving] = useState(false);
  const [lastSavedPromptThis, setLastSavedPromptThis] = useState<string>('');
  const [promptDetailLevel, setPromptDetailLevel] = useState<PromptThisDetailLevel>('standard');
  const [promptNuance, setPromptNuance] = useState('');
  const [promptThisMeta, setPromptThisMeta] = useState<PromptThisMeta>(null);
  const promptThisInputRef = useRef('');
  const saveSequenceRef = useRef(0);

  useEffect(() => {
    promptThisInputRef.current = promptThisInput;
  }, [promptThisInput]);

  const refreshPromptThis = useCallback(async () => {
    if (!imageId) {
      return;
    }
    setPromptThisLoading(true);
    try {
      const response = await fetch(`/api/images/${imageId}/prompt`, { method: 'GET' });
      const data = await response.json();
      if (!response.ok) {
        return;
      }
      const record = data?.record;
      if (record?.prompt && typeof record.prompt === 'string') {
        setPromptThisInput(record.prompt);
        const detailLevel = record.detailLevel === 'high' ? 'high' : 'standard';
        const storedNuance = typeof record.promptNuance === 'string' ? record.promptNuance : '';
        setPromptDetailLevel(detailLevel);
        setPromptNuance(storedNuance);
        setPromptThisMeta({
          saved: true,
          updatedAt: record.updatedAt,
          model: record.model,
          detailLevel,
          promptNuance: storedNuance || undefined,
        });
        setLastSavedPromptThis(record.prompt);
      } else {
        setPromptThisInput('');
        setPromptDetailLevel('standard');
        setPromptNuance('');
        setPromptThisMeta(null);
        setLastSavedPromptThis('');
      }
    } catch (error) {
      console.warn('Failed to refresh Prompt This:', error);
    } finally {
      setPromptThisLoading(false);
    }
  }, [imageId]);

  const savePromptThisEdits = useCallback(async (options?: SavePromptThisOptions) => {
    if (!imageId) return;

    const promptToSave = options?.prompt ?? promptThisInput;
    const trimmed = (promptToSave || '').trim();
    const lastSavedTrimmed = (lastSavedPromptThis || '').trim();

    if (!trimmed || trimmed === lastSavedTrimmed) {
      return;
    }

    const saveSequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = saveSequence;
    setPromptThisSaving(true);
    try {
      const response = await fetch(`/api/images/${imageId}/prompt`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmed }),
      });
      const data = await response.json();
      if (!response.ok || !data?.record?.prompt) {
        toastPush(data?.error || 'Failed to save prompt');
        return;
      }

      if (saveSequence === saveSequenceRef.current) {
        if ((promptThisInputRef.current || '').trim() === trimmed) {
          setPromptThisInput(data.record.prompt);
        }
        setLastSavedPromptThis(data.record.prompt);
        setPromptThisMeta({
          saved: Boolean(data?.saved),
          updatedAt: data?.record?.updatedAt,
          model: data?.record?.model,
          detailLevel: data?.record?.detailLevel === 'high' ? 'high' : promptDetailLevel,
          promptNuance: typeof data?.record?.promptNuance === 'string'
            ? data.record.promptNuance
            : promptDetailLevel === 'high' ? promptNuance || undefined : undefined,
        });
        setPromptDetailLevel(data?.record?.detailLevel === 'high' ? 'high' : promptDetailLevel);
        setPromptNuance(typeof data?.record?.promptNuance === 'string'
          ? data.record.promptNuance
          : promptDetailLevel === 'high' ? promptNuance : '');
        if (!options?.suppressSuccessToast) {
          toastPush('Prompt saved');
        }
      }
    } catch (error) {
      console.error('Failed to save prompt:', error);
      toastPush('Failed to save prompt');
    } finally {
      if (saveSequence === saveSequenceRef.current) {
        setPromptThisSaving(false);
      }
    }
  }, [imageId, lastSavedPromptThis, promptNuance, promptDetailLevel, promptThisInput, toastPush]);

  const generatePromptThis = useCallback(async (force?: boolean) => {
    if (!imageId) {
      return;
    }
    setPromptThisGenerating(true);
    try {
      const response = await fetch(`/api/images/${imageId}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          force: Boolean(force),
          existingPrompt: promptThisInput || '',
          detailLevel: promptDetailLevel,
          promptNuance: promptDetailLevel === 'high' ? promptNuance : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data?.record?.prompt) {
        toastPush(data?.error || 'Failed to generate prompt');
        return;
      }
      const promptText: string = data.record.prompt;
      setPromptThisInput(promptText);
      const detailLevel = data?.record?.detailLevel === 'high' ? 'high' : promptDetailLevel;
      const storedNuance = typeof data?.record?.promptNuance === 'string'
        ? data.record.promptNuance
        : detailLevel === 'high' ? promptNuance : '';
      setPromptDetailLevel(detailLevel);
      setPromptNuance(storedNuance);
      setPromptThisMeta({
        saved: Boolean(data?.saved),
        updatedAt: data?.record?.updatedAt,
        model: data?.record?.model,
        detailLevel,
        promptNuance: storedNuance || undefined,
      });
      if (data?.saved) {
        setLastSavedPromptThis(promptText);
      }
      toastPush(data?.generated ? 'Prompt generated' : 'Prompt loaded');
    } catch (error) {
      console.error('Failed to generate prompt:', error);
      toastPush('Failed to generate prompt');
    } finally {
      setPromptThisGenerating(false);
    }
  }, [imageId, promptNuance, promptDetailLevel, promptThisInput, toastPush]);

  useEffect(() => {
    refreshPromptThis();
  }, [refreshPromptThis]);

  useEffect(() => {
    if (!imageId) {
      return;
    }

    const trimmed = (promptThisInput || '').trim();
    const lastSavedTrimmed = (lastSavedPromptThis || '').trim();
    if (!trimmed || trimmed === lastSavedTrimmed) {
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      void savePromptThisEdits({ prompt: promptThisInput, suppressSuccessToast: true });
    }, PROMPT_THIS_AUTOSAVE_DELAY_MS);

    return () => globalThis.clearTimeout(timeoutId);
  }, [imageId, lastSavedPromptThis, promptThisInput, savePromptThisEdits]);

  return {
    promptThisInput,
    setPromptThisInput,
    promptThisLoading,
    promptThisGenerating,
    promptThisSaving,
    promptThisMeta,
    promptDetailLevel,
    setPromptDetailLevel,
    promptNuance,
    setPromptNuance,
    generatePromptThis,
  };
};
