'use client';

import { useEffect, useState } from 'react';
import { useToast } from './Toast';

interface FolderManagerButtonProps {
  onFoldersChanged?: () => Promise<void> | void;
  size?: 'sm' | 'md';
  className?: string;
  label?: string;
  namespace?: string;
}

interface FolderResponse {
  folders: string[];
}

export default function FolderManagerButton({
  onFoldersChanged,
  size = 'sm',
  className = 'font-mono',
  label = 'Manage',
  namespace,
}: FolderManagerButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const toast = useToast();

  useEffect(() => {
    if (open) {
      void loadFolders();
    }
  }, [open]);

  const buttonClasses = size === 'sm'
    ? 'text-[0.7em] font-mono font-mono px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-100'
    : 'text-sm font-mono px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-100';

  const getNamespaceQuery = () => {
    if (namespace === undefined) return '';
    if (namespace === '__all__') return 'namespace=__all__';
    if (namespace === '') return 'namespace=__none__';
    return `namespace=${encodeURIComponent(namespace)}`;
  };

  const loadFolders = async () => {
    try {
      setLoading(true);
      setError(null);
      const query = getNamespaceQuery();
      const resp = await fetch(query ? `/api/folders?${query}` : '/api/folders');
      if (!resp.ok) {
        throw new Error('Failed to load folders');
      }
      const data = (await resp.json()) as FolderResponse;
      setFolders(data.folders || []);
    } catch (err) {
      console.error('Load folders error', err);
      setError(err instanceof Error ? err.message : 'Failed to load folders');
    } finally {
      setLoading(false);
    }
  };

  const afterMutation = async (message: string) => {
    toast.push(message);
    await loadFolders();
    if (onFoldersChanged) {
      await onFoldersChanged();
    }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      setLoading(true);
      const resp = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName.trim() })
      });
      if (!resp.ok) {
        const body = await resp.json();
        throw new Error(body.error || 'Failed to create folder');
      }
      setNewFolderName('');
      await afterMutation('Folder created');
    } catch (err) {
      console.error('Create folder failed', err);
      toast.push(err instanceof Error ? err.message : 'Failed to create folder');
    } finally {
      setLoading(false);
    }
  };

  const startRename = (folder: string) => {
    setEditingFolder(folder);
    setRenameValue(folder);
  };

  const cancelRename = () => {
    setEditingFolder(null);
    setRenameValue('');
  };

  const submitRename = async (folder: string) => {
    if (!renameValue.trim() || renameValue.trim() === folder) {
      cancelRename();
      return;
    }
    try {
      setLoading(true);
      const query = getNamespaceQuery();
      const resp = await fetch(`${`/api/folders/${encodeURIComponent(folder)}`}${query ? `?${query}` : ''}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: renameValue.trim() })
      });
      if (!resp.ok) {
        const body = await resp.json();
        throw new Error(body.error || 'Failed to rename folder');
      }
      cancelRename();
      await afterMutation('Folder renamed');
    } catch (err) {
      console.error('Rename folder failed', err);
      toast.push(err instanceof Error ? err.message : 'Failed to rename folder');
    } finally {
      setLoading(false);
    }
  };

  const deleteFolder = async (folder: string) => {
    if (!confirm(`Delete folder "${folder}"? Images will be set to [none].`)) {
      return;
    }
    try {
      setLoading(true);
      const query = getNamespaceQuery();
      const resp = await fetch(`${`/api/folders/${encodeURIComponent(folder)}`}${query ? `?${query}` : ''}`, {
        method: 'DELETE'
      });
      if (!resp.ok) {
        const body = await resp.json();
        throw new Error(body.error || 'Failed to delete folder');
      }
      await afterMutation('Folder deleted');
    } catch (err) {
      console.error('Delete folder failed', err);
      toast.push(err instanceof Error ? err.message : 'Failed to delete folder');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`${buttonClasses} ${className}`.trim()}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-md z-[110000]"
            onClick={() => setOpen(false)}
          />
          <div className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[420px] bg-white rounded-lg shadow-xl z-[110001] text-[0.7em] font-mono font-mono text-gray-800 border">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <p className="text-[0.7em] font-mono font-mono font-semibold">Manage folders</p>
              <button
                onClick={() => setOpen(false)}
                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
              >
                ×
              </button>
            </div>
            <div className="p-4 space-y-3 max-h-[70vh] overflow-auto">
              <div className="space-y-2">
                <label className="text-[11px] font-mono uppercase tracking-wide text-gray-500">Create folder</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-[0.7em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="marketing-assets"
                  />
                  <button
                    onClick={createFolder}
                    disabled={loading || !newFolderName.trim()}
                    className="px-3 py-1 text-[0.7em] font-mono bg-blue-600 text-white rounded-md disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Existing folders</p>
                {error && <p className="text-red-600 text-[0.7em] font-mono mb-2">{error}</p>}
                {loading && folders.length === 0 ? (
                  <p className="text-[0.7em] font-mono text-gray-500">Loading…</p>
                ) : folders.length === 0 ? (
                  <p className="text-[0.7em] font-mono text-gray-500">No folders yet</p>
                ) : (
                  <div className="space-y-2">
                    {folders.map((folder) => (
                      <div key={folder} className="flex items-center gap-2 border border-gray-200 rounded-md px-3 py-2">
                        {editingFolder === folder ? (
                          <>
                            <input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-[0.7em] font-mono"
                            />
                            <button
                              onClick={() => submitRename(folder)}
                              className="px-2 py-1 text-[0.7em] font-mono bg-blue-600 text-white rounded-md"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelRename}
                              className="px-2 py-1 text-[0.7em] font-mono border border-gray-300 rounded-md"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-[0.7em] font-mono font-mono">{folder}</span>
                            <button
                              onClick={() => startRename(folder)}
                              className="px-2 py-1 text-[11px] border border-gray-300 rounded-md"
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => deleteFolder(folder)}
                              className="px-2 py-1 text-[11px] border border-red-400 text-red-600 rounded-md"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
