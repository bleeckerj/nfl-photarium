import React, { useMemo, useState } from 'react';
import MonoSelect from '@/components/MonoSelect';

type NamespaceMoveSectionProps = {
  currentNamespace?: string;
  namespaceOptions: string[];
  moving: boolean;
  onCreateNamespace: (namespace: string, description?: string) => Promise<boolean>;
  onMove: (namespace: string) => Promise<boolean>;
};

const RESERVED_NAMESPACES = new Set(['__all__', '__none__']);

export function NamespaceMoveSection({
  currentNamespace,
  namespaceOptions,
  moving,
  onCreateNamespace,
  onMove,
}: NamespaceMoveSectionProps) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [namespaceNameInput, setNamespaceNameInput] = useState('');
  const [namespaceDescriptionInput, setNamespaceDescriptionInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creatingNamespace, setCreatingNamespace] = useState(false);

  const cleanCurrentNamespace = currentNamespace?.trim() ?? '';
  const existingOptions = useMemo(
    () =>
      namespaceOptions
        .map((namespace) => namespace.trim())
        .filter((namespace, index, values) =>
          Boolean(namespace) &&
          !RESERVED_NAMESPACES.has(namespace) &&
          values.indexOf(namespace) === index
        )
        .sort((left, right) => left.localeCompare(right))
        .map((namespace) => ({ value: namespace, label: namespace })),
    [namespaceOptions]
  );
  const targetNamespace = mode === 'new' ? namespaceNameInput.trim() : selectedNamespace.trim();
  const disabled =
    moving ||
    creatingNamespace ||
    !targetNamespace ||
    RESERVED_NAMESPACES.has(targetNamespace) ||
    targetNamespace === cleanCurrentNamespace;

  const handleMove = async () => {
    setError(null);
    if (!targetNamespace || RESERVED_NAMESPACES.has(targetNamespace)) {
      setError('Enter a non-empty namespace name.');
      return;
    }
    if (targetNamespace === cleanCurrentNamespace) {
      setError('This image family is already in that namespace.');
      return;
    }

    if (mode === 'new') {
      setCreatingNamespace(true);
      try {
        const created = await onCreateNamespace(targetNamespace, namespaceDescriptionInput);
        if (!created) {
          setError('Could not create namespace.');
          return;
        }
        setSelectedNamespace(targetNamespace);
      } finally {
        setCreatingNamespace(false);
      }
    }

    const moved = await onMove(targetNamespace);
    if (!moved) {
      return;
    }
    setNamespaceNameInput('');
    setNamespaceDescriptionInput('');
    setMode('existing');
  };

  return (
    <div id="namespace-move-section" className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-mono font-medium text-gray-700">Namespace</p>
          <p className="mt-1 text-[11px] text-gray-500">
            Current: <span className="font-mono text-gray-700">{cleanCurrentNamespace || 'Missing namespace'}</span>
          </p>
        </div>
        <p className="max-w-sm text-[11px] text-gray-500">
          Moves this image family to the selected namespace.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-700">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="detail-namespace-mode"
            checked={mode === 'existing'}
            onChange={() => {
              setMode('existing');
              setError(null);
            }}
            className="h-3 w-3"
          />
          Existing
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="detail-namespace-mode"
            checked={mode === 'new'}
            onChange={() => {
              setMode('new');
              setError(null);
            }}
            className="h-3 w-3"
          />
          Create new
        </label>
      </div>

      {mode === 'new' ? (
        <div className="space-y-2">
          <input
            type="text"
            value={namespaceNameInput}
            onChange={(event) => setNamespaceNameInput(event.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs"
            placeholder="Namespace name"
          />
          <textarea
            value={namespaceDescriptionInput}
            onChange={(event) => setNamespaceDescriptionInput(event.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs"
            placeholder="Namespace description (optional)"
            rows={3}
          />
        </div>
      ) : (
        <MonoSelect
          value={selectedNamespace}
          onChange={(value) => {
            setSelectedNamespace(value);
            setError(null);
          }}
          options={existingOptions}
          className="w-full"
          placeholder="Choose namespace"
          searchable
          searchPlaceholder="Search namespaces..."
          size="sm"
        />
      )}

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-gray-500">
          Reserved namespace scopes cannot be selected for moves.
        </p>
        <button
          type="button"
          onClick={handleMove}
          disabled={disabled}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          {moving || creatingNamespace ? 'Moving...' : 'Move family'}
        </button>
      </div>
    </div>
  );
}
