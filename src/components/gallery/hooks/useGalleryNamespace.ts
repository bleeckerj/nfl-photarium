import { useCallback, useEffect, useMemo, useState } from 'react';

const DEFAULT_NAMESPACE = 'cf-default';
const PROTECTED_NAMESPACE_VALUES = new Set(['__all__', '__none__', DEFAULT_NAMESPACE, 'cf-site-misc']);

interface NamespaceImage {
  namespace?: string;
}

interface UseGalleryNamespaceOptions {
  images: NamespaceImage[];
  namespace?: string;
  onNamespaceChange?: (value: string) => void;
  toastPush: (message: string) => void;
}

export const useGalleryNamespace = ({
  images,
  namespace,
  onNamespaceChange,
  toastPush,
}: UseGalleryNamespaceOptions) => {
  const [namespaceSettingsOpen, setNamespaceSettingsOpen] = useState(false);
  const [namespaceDeleting, setNamespaceDeleting] = useState(false);
  const [namespaceRenaming, setNamespaceRenaming] = useState(false);
  const [namespaceDraft, setNamespaceDraft] = useState(namespace ?? '');
  const [namespaceRenameTarget, setNamespaceRenameTarget] = useState('');
  const [namespaceSelectValue, setNamespaceSelectValue] = useState('');
  const [registryNamespaces, setRegistryNamespaces] = useState<string[]>([]);

  useEffect(() => {
    const next = namespace ?? '';
    setNamespaceDraft(next === '__all__' ? '' : next);
    setNamespaceSelectValue(next || '');
  }, [namespace]);

  const fetchNamespaces = useCallback(async (cache: RequestCache = 'no-store') => {
    try {
      const response = await fetch('/api/namespaces', { cache });
      const data = await response.json();
      const payload = Array.isArray(data?.namespaces) ? data.namespaces : [];
      setRegistryNamespaces(payload.filter((entry: unknown): entry is string => typeof entry === 'string'));
    } catch (error) {
      console.warn('Failed to load namespace registry', error);
    }
  }, []);

  useEffect(() => {
    void fetchNamespaces('no-store');
  }, [fetchNamespaces]);

  const registerNamespace = useCallback(async (value: string, description?: string) => {
    const namespace = value.trim();
    if (!namespace || namespace === '__all__' || namespace === '__none__') {
      return false;
    }

    try {
      const response = await fetch('/api/namespaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ namespace, description: description?.trim() ?? '' }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to register namespace');
      }
      const payload = Array.isArray(data?.namespaces) ? data.namespaces : [];
      setRegistryNamespaces(payload.filter((entry: unknown): entry is string => typeof entry === 'string'));
      return true;
    } catch (error) {
      console.warn('Failed to register namespace', error);
      void fetchNamespaces('no-store');
      return false;
    }
  }, [fetchNamespaces]);

  const namespaceOptions = useMemo(() => {
    const rawSeen = new Set(images.map((image) => image.namespace).filter((ns): ns is string => Boolean(ns)));
    const envDefault = process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
    const knownRaw = process.env.NEXT_PUBLIC_KNOWN_NAMESPACES || '';
    const registryRaw = registryNamespaces;
    const defaults = new Set<string>();
    if (envDefault) defaults.add(envDefault);

    const known = new Set<string>();
    knownRaw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => {
        if (!defaults.has(entry)) known.add(entry);
      });

    const registry = new Set<string>();
    registryRaw
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => {
        if (!defaults.has(entry) && !known.has(entry)) registry.add(entry);
      });

    const discovered = new Set<string>();
    rawSeen.forEach((entry) => {
      if (!defaults.has(entry) && !known.has(entry) && !registry.has(entry)) discovered.add(entry);
    });

    const options = [{ value: '__all__', label: 'All namespaces' }];
    defaults.forEach((value) => options.push({ value, label: `${value} (default)` }));
    Array.from(known).sort().forEach((value) => options.push({ value, label: value }));
    Array.from(registry).sort().forEach((value) => options.push({ value, label: `${value} (registry)` }));
    Array.from(discovered).sort().forEach((value) => options.push({ value, label: `${value} (discovered)` }));
    options.push({ value: '__custom__', label: 'Enter manually...' });

    if (namespace && !options.some((option) => option.value === namespace) && namespace !== '__custom__') {
      options.splice(options.length - 1, 0, { value: namespace, label: namespace });
    }

    return options;
  }, [images, namespace, registryNamespaces]);

  const namespaceLabel = namespace === '__all__'
    ? 'All namespaces'
    : namespace
      ? namespace
      : DEFAULT_NAMESPACE;

  const handleNamespaceSelectChange = useCallback(
    (value: string) => {
      setNamespaceSelectValue(value);
      if (value === '__custom__') return;
      setNamespaceDraft(value);
      onNamespaceChange?.(value);
      setNamespaceSettingsOpen(false);
    },
    [onNamespaceChange]
  );

  const handleNamespaceDraftChange = useCallback((value: string) => {
    setNamespaceDraft(value);
    setNamespaceSelectValue('__custom__');
  }, []);

  const selectedNamespaceForDelete = useMemo(() => {
    const selected = namespaceSelectValue === '__custom__'
      ? namespaceDraft.trim()
      : namespaceSelectValue.trim();
    if (!selected || selected === '__custom__') return '';
    return selected;
  }, [namespaceDraft, namespaceSelectValue]);

  const canDeleteSelectedNamespace =
    Boolean(selectedNamespaceForDelete) && !PROTECTED_NAMESPACE_VALUES.has(selectedNamespaceForDelete);
  const trimmedNamespaceRenameTarget = namespaceRenameTarget.trim();
  const canRenameSelectedNamespace =
    canDeleteSelectedNamespace &&
    Boolean(trimmedNamespaceRenameTarget) &&
    trimmedNamespaceRenameTarget !== selectedNamespaceForDelete &&
    !PROTECTED_NAMESPACE_VALUES.has(trimmedNamespaceRenameTarget);

  const handleNamespaceSave = useCallback(() => {
    const next = namespaceSelectValue === '__custom__'
      ? namespaceDraft.trim()
      : namespaceSelectValue;
    if (namespaceSelectValue === '__custom__' && next) {
      void registerNamespace(next);
    }
    onNamespaceChange?.(next);
    setNamespaceSettingsOpen(false);
  }, [namespaceDraft, namespaceSelectValue, onNamespaceChange, registerNamespace]);

  const handleNamespaceDelete = useCallback(async () => {
    if (!selectedNamespaceForDelete || !canDeleteSelectedNamespace) return;

    setNamespaceDeleting(true);
    try {
      const dryRunResponse = await fetch('/api/namespaces', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ namespace: selectedNamespaceForDelete, dryRun: true }),
      });
      const dryRunPayload = await dryRunResponse.json().catch(() => null);
      if (!dryRunResponse.ok) {
        toastPush(
          typeof dryRunPayload?.error === 'string'
            ? dryRunPayload.error
            : 'Could not preview namespace deletion'
        );
        return;
      }

      const imageCount = typeof dryRunPayload?.imageCount === 'number' ? dryRunPayload.imageCount : 0;
      const videoCount = typeof dryRunPayload?.videoCount === 'number' ? dryRunPayload.videoCount : 0;
      const assetCount = imageCount + videoCount;
      const confirmed = typeof window === 'undefined'
        ? true
        : window.confirm(
            `Delete namespace "${selectedNamespaceForDelete}"?\n\n${assetCount} asset${assetCount === 1 ? '' : 's'} will be moved to ${DEFAULT_NAMESPACE}. No files will be deleted.`
          );
      if (!confirmed) return;

      const response = await fetch('/api/namespaces', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ namespace: selectedNamespaceForDelete, dryRun: false }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.partialFailure) {
        const failureCount = Array.isArray(payload?.failures) ? payload.failures.length : 0;
        toastPush(
          failureCount > 0
            ? `Namespace delete partially failed for ${failureCount} asset${failureCount === 1 ? '' : 's'}`
            : typeof payload?.error === 'string'
              ? payload.error
              : 'Namespace delete failed'
        );
        void fetchNamespaces('no-store');
        return;
      }

      const movedImageCount = Array.isArray(payload?.movedImageIds) ? payload.movedImageIds.length : 0;
      const movedVideoCount = Array.isArray(payload?.movedVideoIds) ? payload.movedVideoIds.length : 0;
      const movedCount = movedImageCount + movedVideoCount;
      const namespaces = Array.isArray(payload?.namespaces) ? payload.namespaces : [];
      if (namespaces.length > 0) {
        setRegistryNamespaces(namespaces.filter((entry: unknown): entry is string => typeof entry === 'string'));
      } else {
        void fetchNamespaces('no-store');
      }
      setNamespaceDraft(DEFAULT_NAMESPACE);
      setNamespaceSelectValue(DEFAULT_NAMESPACE);
      onNamespaceChange?.(DEFAULT_NAMESPACE);
      setNamespaceSettingsOpen(false);
      toastPush(
        `Deleted namespace "${selectedNamespaceForDelete}" and moved ${movedCount} asset${movedCount === 1 ? '' : 's'}`
      );
    } catch (error) {
      console.error('Failed to delete namespace', error);
      toastPush('Namespace delete failed');
    } finally {
      setNamespaceDeleting(false);
    }
  }, [
    canDeleteSelectedNamespace,
    fetchNamespaces,
    onNamespaceChange,
    selectedNamespaceForDelete,
    toastPush,
  ]);

  const handleNamespaceRename = useCallback(async () => {
    if (!selectedNamespaceForDelete || !canRenameSelectedNamespace) return;

    const targetNamespace = trimmedNamespaceRenameTarget;
    setNamespaceRenaming(true);
    try {
      const dryRunResponse = await fetch('/api/namespaces', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          namespace: selectedNamespaceForDelete,
          targetNamespace,
          dryRun: true,
        }),
      });
      const dryRunPayload = await dryRunResponse.json().catch(() => null);
      if (!dryRunResponse.ok) {
        toastPush(
          typeof dryRunPayload?.error === 'string'
            ? dryRunPayload.error
            : 'Could not preview namespace rename'
        );
        return;
      }

      const imageCount = typeof dryRunPayload?.imageCount === 'number' ? dryRunPayload.imageCount : 0;
      const videoCount = typeof dryRunPayload?.videoCount === 'number' ? dryRunPayload.videoCount : 0;
      const assetCount = imageCount + videoCount;
      const confirmed = typeof window === 'undefined'
        ? true
        : window.confirm(
            `Rename namespace "${selectedNamespaceForDelete}" to "${targetNamespace}"?\n\n${assetCount} asset${assetCount === 1 ? '' : 's'} will be moved to the new namespace.`
          );
      if (!confirmed) return;

      const response = await fetch('/api/namespaces', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          namespace: selectedNamespaceForDelete,
          targetNamespace,
          dryRun: false,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.partialFailure) {
        const failureCount = Array.isArray(payload?.failures) ? payload.failures.length : 0;
        toastPush(
          failureCount > 0
            ? `Namespace rename partially failed for ${failureCount} asset${failureCount === 1 ? '' : 's'}`
            : typeof payload?.error === 'string'
              ? payload.error
              : 'Namespace rename failed'
        );
        void fetchNamespaces('no-store');
        return;
      }

      const movedImageCount = Array.isArray(payload?.movedImageIds) ? payload.movedImageIds.length : 0;
      const movedVideoCount = Array.isArray(payload?.movedVideoIds) ? payload.movedVideoIds.length : 0;
      const movedCount = movedImageCount + movedVideoCount;
      const namespaces = Array.isArray(payload?.namespaces) ? payload.namespaces : [];
      if (namespaces.length > 0) {
        setRegistryNamespaces(namespaces.filter((entry: unknown): entry is string => typeof entry === 'string'));
      } else {
        void fetchNamespaces('no-store');
      }
      setNamespaceDraft(targetNamespace);
      setNamespaceSelectValue(targetNamespace);
      setNamespaceRenameTarget('');
      onNamespaceChange?.(targetNamespace);
      setNamespaceSettingsOpen(false);
      toastPush(
        `Renamed namespace "${selectedNamespaceForDelete}" to "${targetNamespace}" and moved ${movedCount} asset${movedCount === 1 ? '' : 's'}`
      );
    } catch (error) {
      console.error('Failed to rename namespace', error);
      toastPush('Namespace rename failed');
    } finally {
      setNamespaceRenaming(false);
    }
  }, [
    canRenameSelectedNamespace,
    fetchNamespaces,
    onNamespaceChange,
    selectedNamespaceForDelete,
    toastPush,
    trimmedNamespaceRenameTarget,
  ]);

  return {
    namespaceSettingsOpen,
    setNamespaceSettingsOpen,
    namespaceDeleting,
    namespaceRenaming,
    namespaceDraft,
    namespaceRenameTarget,
    setNamespaceRenameTarget,
    namespaceSelectValue,
    registryNamespaces,
    fetchNamespaces,
    registerNamespace,
    namespaceOptions,
    namespaceLabel,
    handleNamespaceSelectChange,
    handleNamespaceDraftChange,
    selectedNamespaceForDelete,
    canDeleteSelectedNamespace,
    canRenameSelectedNamespace,
    handleNamespaceSave,
    handleNamespaceDelete,
    handleNamespaceRename,
  };
};
