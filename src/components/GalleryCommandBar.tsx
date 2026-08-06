'use client';

import { FormEvent, useMemo, useRef, useState } from 'react';
import GalleryHiddenInventory from './gallery/GalleryHiddenInventory';
import { useToast } from './Toast';
import { GALLERY_COMMAND_HELP } from './galleryCommandHelp';
import { createGalleryCommandRunner } from '@/utils/galleryCommandRunner';

export interface GalleryCommandBarProps {
  hiddenFolders: string[];
  hiddenTags: string[];
  hiddenNamespaces: string[];
  knownFolders: string[];
  knownTags: string[];
  knownNamespaces: string[];
  onHideFolder: (folderName: string) => boolean;
  onUnhideFolder: (folderName: string) => boolean;
  onClearHidden: () => boolean;
  onHideTag: (tagName: string) => boolean;
  onUnhideTag: (tagName: string) => boolean;
  onClearHiddenTags: () => boolean;
  onHideNamespace: (namespaceName: string) => boolean;
  onUnhideNamespace: (namespaceName: string) => boolean;
  onClearHiddenNamespaces: () => boolean;
  onSelectFolder: (folderName: string) => void;
  selectedTag: string;
  onSelectTag: (tagName: string) => void;
  onClearTagFilter: () => void;
  showParentsOnly: boolean;
  onSetParentsOnly: (value: boolean) => void;
  currentPage: number;
  totalPages: number;
  onGoToPage: (page: number) => void;
  embeddingFilter: 'none' | 'missing-clip' | 'missing-color' | 'missing-any' | 'missing-both';
  onSetEmbeddingFilter: (filter: 'none' | 'missing-clip' | 'missing-color' | 'missing-any' | 'missing-both') => void;
  onShowLastUploaded?: () => { dateKey: string; count: number } | null;
  showComfyOnly?: boolean;
  onSetComfyOnly?: (value: boolean) => void;
  onClose?: () => void;
}

export default function GalleryCommandBar({
  hiddenFolders,
  hiddenTags,
  hiddenNamespaces,
  knownFolders,
  knownTags,
  knownNamespaces,
  onHideFolder,
  onUnhideFolder,
  onClearHidden,
  onHideTag,
  onUnhideTag,
  onClearHiddenTags,
  onHideNamespace,
  onUnhideNamespace,
  onClearHiddenNamespaces,
  onSelectFolder,
  selectedTag,
  onSelectTag,
  onClearTagFilter,
  showParentsOnly,
  onSetParentsOnly,
  currentPage,
  totalPages,
  onGoToPage,
  embeddingFilter,
  onSetEmbeddingFilter,
  onShowLastUploaded,
  showComfyOnly = false,
  onSetComfyOnly,
  onClose
}: GalleryCommandBarProps) {
  const [inputValue, setInputValue] = useState('');
  const [statusLine, setStatusLine] = useState(GALLERY_COMMAND_HELP);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const runCommand = createGalleryCommandRunner({
    hiddenFolders, hiddenTags, hiddenNamespaces, knownFolders, knownTags, knownNamespaces,
    onHideFolder, onUnhideFolder, onClearHidden, onHideTag, onUnhideTag, onClearHiddenTags,
    onHideNamespace, onUnhideNamespace, onClearHiddenNamespaces, onSelectFolder, selectedTag,
    onSelectTag, onClearTagFilter, showParentsOnly, onSetParentsOnly, currentPage, totalPages,
    onGoToPage, embeddingFilter, onSetEmbeddingFilter, onShowLastUploaded, showComfyOnly,
    onSetComfyOnly, setStatusLine, toast,
  });

  const suggestions = useMemo(() => {
    const showOnlyMatch = /^\s*show\s+only\s+(folders?|tags?)\s*(.*)$/i.exec(inputValue);
    const baseMatch = /^\s*(hide|show|unhide)\s+(folders?|tags?|namespaces?)\s*(.*)$/i.exec(inputValue);
    if (!showOnlyMatch && !baseMatch) {
      return [];
    }
    const action = (showOnlyMatch ? 'show only' : baseMatch?.[1] || '').toLowerCase();
    const targetValue = (showOnlyMatch ? showOnlyMatch[1] : baseMatch?.[2] || '').toLowerCase();
    const target = targetValue.startsWith('tag')
      ? 'tag'
      : targetValue.startsWith('namespace')
        ? 'namespace'
        : 'folder';
    const query = (showOnlyMatch ? showOnlyMatch[2] : baseMatch?.[3] || '').trim().toLowerCase();
    const baseList =
      target === 'namespace'
        ? action === 'hide'
          ? knownNamespaces.filter(namespace => !hiddenNamespaces.some(hidden => hidden.toLowerCase() === namespace.toLowerCase()))
          : hiddenNamespaces.length
            ? hiddenNamespaces
            : knownNamespaces
        : target === 'folder'
        ? action === 'hide'
          ? knownFolders.filter(folder => !hiddenFolders.includes(folder))
          : action === 'show' || action === 'unhide'
            ? hiddenFolders.length
              ? hiddenFolders
              : knownFolders
            : knownFolders
        : action === 'hide'
          ? knownTags.filter(tag => !hiddenTags.includes(tag))
          : action === 'unhide'
            ? hiddenTags.length
              ? hiddenTags
              : knownTags
            : knownTags;
    const filtered = query
      ? baseList.filter((item) => item.toLowerCase().includes(query))
      : baseList;
    return filtered
      .slice()
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .slice(0, 8)
      .map((item) => `${action} ${target} ${item}`);
  }, [inputValue, knownFolders, knownTags, knownNamespaces, hiddenFolders, hiddenTags, hiddenNamespaces]);

  const applySuggestion = (value: string) => {
    setInputValue(value);
    setSuggestionIndex(-1);
    setTimeout(() => inputRef.current?.focus(), 0);
  };


  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runCommand(inputValue);
    setInputValue('');
    setSuggestionIndex(-1);
  };

  return (
    <div className="bg-slate-950/90 border border-slate-800 rounded-lg px-3 py-3">
      <div className="flex items-center justify-between gap-2 text-[0.6rem] uppercase tracking-wide text-slate-400">
        <div className="flex items-center gap-2">
          <span className="text-green-300">Gallery CLI</span>
          <span className="text-slate-500 lowercase">
            hide folder maintenance | page {currentPage}/{totalPages}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200"
            aria-label="Hide CLI"
          >
            ✕
          </button>
        )}
      </div>
      <form onSubmit={handleSubmit} className="flex items-center gap-2 mt-2">
        <span className="text-green-300 text-sm">$</span>
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(event) => {
            setInputValue(event.target.value);
            setSuggestionIndex(-1);
          }}
          onKeyDown={(event) => {
            if (suggestions.length === 0) return;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSuggestionIndex((prev) => (prev + 1) % suggestions.length);
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSuggestionIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (event.key === 'Tab') {
              event.preventDefault();
              const pick = suggestions[suggestionIndex >= 0 ? suggestionIndex : 0];
              if (pick) {
                applySuggestion(pick);
              }
              return;
            }
            if (event.key === 'Enter' && suggestionIndex >= 0) {
              event.preventDefault();
              const pick = suggestions[suggestionIndex];
              if (pick) {
                applySuggestion(pick);
              }
            }
          }}
          placeholder='Try "hide folder ops"'
          className="flex-1 bg-transparent border-b border-slate-700 text-[0.75rem] font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-400"
        />
        <button
          type="submit"
          className="text-[0.6rem] uppercase tracking-wide px-2 py-1 border border-slate-700 rounded text-slate-200 hover:border-slate-400"
        >
          Run
        </button>
      </form>
      <GalleryHiddenInventory
        hiddenFolders={hiddenFolders}
        hiddenTags={hiddenTags}
        hiddenNamespaces={hiddenNamespaces}
        onClearHiddenFolders={onClearHidden}
        onClearHiddenTags={onClearHiddenTags}
        onClearHiddenNamespaces={onClearHiddenNamespaces}
        variant="cli"
      />
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => applySuggestion(suggestion)}
              className={`px-2 py-1 text-[0.6rem] font-mono rounded border ${
                index === suggestionIndex
                  ? 'border-emerald-300 text-emerald-200 bg-emerald-500/10'
                  : 'border-slate-700 text-slate-200 hover:border-slate-500'
              }`}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <p className="mt-2 text-[0.6rem] text-slate-300 break-words min-h-[1.5rem]">{statusLine}</p>
    </div>
  );
}
