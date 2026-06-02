import { useCallback, useEffect, useMemo, useState } from 'react';

export interface UploadNamespaceOption {
  value: string;
  label: string;
}

interface UseUploadNamespaceControlsOptions {
  namespace?: string;
  onNamespaceChange?: (value: string) => void;
}

export function useUploadNamespaceControls({
  namespace,
  onNamespaceChange,
}: UseUploadNamespaceControlsOptions) {
  const [registryNamespaces, setRegistryNamespaces] = useState<string[]>([]);
  const [uploadNamespaceSelectValue, setUploadNamespaceSelectValue] = useState('');
  const [uploadNamespaceDraft, setUploadNamespaceDraft] = useState('');

  const uploadNamespace = useMemo(() => {
    const trimmed = (namespace || '').trim();
    if (!trimmed || trimmed === '__all__' || trimmed === '__none__') return null;
    return trimmed;
  }, [namespace]);

  const uploadNamespaceOptions = useMemo(() => {
    const envDefault = (process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '').trim();
    const knownRaw = process.env.NEXT_PUBLIC_KNOWN_NAMESPACES || '';
    const defaults = new Set<string>();
    const known = new Set<string>();
    const registry = new Set<string>();

    if (envDefault) defaults.add(envDefault);

    knownRaw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => {
        if (!defaults.has(entry)) known.add(entry);
      });

    registryNamespaces
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => {
        if (!defaults.has(entry) && !known.has(entry)) registry.add(entry);
      });

    const options = [
      { value: '__all__', label: 'All namespaces' },
    ];

    defaults.forEach((value) => options.push({ value, label: `${value} (default)` }));
    Array.from(known).sort().forEach((value) => options.push({ value, label: value }));
    Array.from(registry).sort().forEach((value) => options.push({ value, label: `${value} (registry)` }));
    options.push({ value: '__custom__', label: 'Enter manually...' });

    if (namespace && namespace !== '__custom__' && !options.some((option) => option.value === namespace)) {
      options.splice(options.length - 1, 0, { value: namespace, label: namespace });
    }

    return options;
  }, [namespace, registryNamespaces]);

  useEffect(() => {
    const nextNamespace = namespace ?? '';
    setUploadNamespaceDraft(nextNamespace && nextNamespace !== '__all__' ? nextNamespace : '');
    if (!nextNamespace) {
      setUploadNamespaceSelectValue('');
      return;
    }
    const hasKnownOption = uploadNamespaceOptions.some((option) => option.value === nextNamespace);
    setUploadNamespaceSelectValue(hasKnownOption ? nextNamespace : '__custom__');
  }, [namespace, uploadNamespaceOptions]);

  useEffect(() => {
    fetch('/api/namespaces', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        const namespaces = Array.isArray(data?.namespaces)
          ? data.namespaces.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          : [];
        setRegistryNamespaces(namespaces);
      })
      .catch((error) => {
        console.warn('Failed to load namespace registry for uploader', error);
      });
  }, []);

  const registerUploadNamespace = useCallback(async (value: string) => {
    const nextNamespace = value.trim();
    if (!nextNamespace || nextNamespace === '__all__' || nextNamespace === '__none__') return;

    try {
      const response = await fetch('/api/namespaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ namespace: nextNamespace }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to register namespace');
      }
      const namespaces = Array.isArray(data?.namespaces)
        ? data.namespaces.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
      setRegistryNamespaces(namespaces);
    } catch (error) {
      console.warn('Failed to register namespace for uploader', error);
    }
  }, []);

  const handleUploadNamespaceSelectChange = useCallback((value: string) => {
    setUploadNamespaceSelectValue(value);
    if (value === '__custom__') return;
    setUploadNamespaceDraft(value && value !== '__all__' ? value : '');
    onNamespaceChange?.(value);
  }, [onNamespaceChange]);

  const handleUploadNamespaceApply = useCallback(() => {
    const nextNamespace = uploadNamespaceDraft.trim();
    if (!nextNamespace) return;
    setUploadNamespaceSelectValue('__custom__');
    void registerUploadNamespace(nextNamespace);
    onNamespaceChange?.(nextNamespace);
  }, [onNamespaceChange, registerUploadNamespace, uploadNamespaceDraft]);

  const handleUploadNamespaceDraftChange = useCallback((value: string) => {
    setUploadNamespaceDraft(value);
    setUploadNamespaceSelectValue('__custom__');
  }, []);

  return {
    uploadNamespace,
    uploadNamespaceSelectValue,
    uploadNamespaceDraft,
    uploadNamespaceOptions,
    handleUploadNamespaceSelectChange,
    handleUploadNamespaceApply,
    handleUploadNamespaceDraftChange,
  };
}
