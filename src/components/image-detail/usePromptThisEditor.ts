import { useCallback, useEffect, useRef, useState } from 'react';

type PromptThisMeta = { saved?: boolean; updatedAt?: string; model?: string } | null;
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
        setPromptThisMeta({ saved: true, updatedAt: record.updatedAt, model: record.model });
        setLastSavedPromptThis(record.prompt);
      } else {
        setPromptThisInput('');
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
        });
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
  }, [imageId, lastSavedPromptThis, promptThisInput, toastPush]);

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
        }),
      });
      const data = await response.json();
      if (!response.ok || !data?.record?.prompt) {
        toastPush(data?.error || 'Failed to generate prompt');
        return;
      }
      const promptText: string = data.record.prompt;
      setPromptThisInput(promptText);
      setPromptThisMeta({
        saved: Boolean(data?.saved),
        updatedAt: data?.record?.updatedAt,
        model: data?.record?.model,
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
  }, [imageId, promptThisInput, toastPush]);

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
    generatePromptThis,
  };
};
