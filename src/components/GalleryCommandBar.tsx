'use client';

import { FormEvent, useMemo, useRef, useState } from 'react';
import { useToast } from './Toast';

interface GalleryCommandBarProps {
  hiddenFolders: string[];
  hiddenTags: string[];
  knownFolders: string[];
  knownTags: string[];
  onHideFolder: (folderName: string) => boolean;
  onUnhideFolder: (folderName: string) => boolean;
  onClearHidden: () => boolean;
  onHideTag: (tagName: string) => boolean;
  onUnhideTag: (tagName: string) => boolean;
  onClearHiddenTags: () => boolean;
  onSelectFolder: (folderName: string) => void;
  selectedTag: string;
  onSelectTag: (tagName: string) => void;
  onClearTagFilter: () => void;
  showParentsOnly: boolean;
  onSetParentsOnly: (value: boolean) => void;
  currentPage: number;
  totalPages: number;
  onGoToPage: (page: number) => void;
}

const baseHelp = [
  'Available commands:',
  '- hide folder <name>: Temporarily remove a folder from the gallery',
  '- show folder <name>: Bring a hidden folder back into the gallery',
  '- hide tag <name>: Temporarily remove a tag from the gallery',
  '- show tag <name>: Filter the gallery to a specific tag',
  '- clear tag: Remove the tag filter',
  '- unhide tag <name>: Bring a hidden tag back into the gallery',
  '- list hidden folders: Show currently hidden folders',
  '- list hidden tags: Show currently hidden tags',
  '- clear hidden: Unhide every folder',
  '- clear hidden tags: Unhide every tag',
  '- list folders: List all known folders',
  '- show only folders <a,b>: Hide every folder except the listed ones',
  '- show only tags <a,b>: Hide every tag except the listed ones',
  '- parents only: Only show images that have variants',
  '- show all: Show every image, including solos',
  '- page next/prev or page <n>: Navigate gallery pages',
  '- help: Show this command list'
].join(' ');

export default function GalleryCommandBar({
  hiddenFolders,
  hiddenTags,
  knownFolders,
  knownTags,
  onHideFolder,
  onUnhideFolder,
  onClearHidden,
  onHideTag,
  onUnhideTag,
  onClearHiddenTags,
  onSelectFolder,
  selectedTag,
  onSelectTag,
  onClearTagFilter,
  showParentsOnly,
  onSetParentsOnly,
  currentPage,
  totalPages,
  onGoToPage
}: GalleryCommandBarProps) {
  const [inputValue, setInputValue] = useState('');
  const [statusLine, setStatusLine] = useState(baseHelp);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const suggestions = useMemo(() => {
    const showOnlyMatch = /^\s*show\s+only\s+(folders?|tags?)\s*(.*)$/i.exec(inputValue);
    const baseMatch = /^\s*(hide|show|unhide)\s+(folders?|tags?)\s*(.*)$/i.exec(inputValue);
    if (!showOnlyMatch && !baseMatch) {
      return [];
    }
    const action = (showOnlyMatch ? 'show only' : baseMatch?.[1] || '').toLowerCase();
    const target = (showOnlyMatch ? showOnlyMatch[1] : baseMatch?.[2] || '').toLowerCase().startsWith('tag')
      ? 'tag'
      : 'folder';
    const query = (showOnlyMatch ? showOnlyMatch[2] : baseMatch?.[3] || '').trim().toLowerCase();
    const baseList =
      target === 'folder'
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
  }, [inputValue, knownFolders, knownTags, hiddenFolders, hiddenTags]);

  const applySuggestion = (value: string) => {
    setInputValue(value);
    setSuggestionIndex(-1);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const runCommand = (rawCommand: string) => {
    const trimmed = rawCommand.trim();
    if (!trimmed) {
      setStatusLine('Enter a command or type "help".');
      return;
    }

    if (/^help$/i.test(trimmed)) {
      setStatusLine(baseHelp);
      return;
    }

    if (/^(list|show)\s+hidden\s+tags?$/i.test(trimmed)) {
      setStatusLine(hiddenTags.length ? `Hidden tags: ${hiddenTags.join(', ')}` : 'No hidden tags.');
      return;
    }

    if (/^(list|show)\s+hidden(?:\s+folders?)?$/i.test(trimmed)) {
      setStatusLine(hiddenFolders.length ? `Hidden: ${hiddenFolders.join(', ')}` : 'No hidden folders.');
      return;
    }

    if (/^(list|show)\s+folders$/i.test(trimmed)) {
      setStatusLine(knownFolders.length ? `Folders: ${knownFolders.join(', ')}` : 'No folders yet.');
      return;
    }

    if (/^(list|show)\s+tags$/i.test(trimmed)) {
      setStatusLine(knownTags.length ? `Tags: ${knownTags.join(', ')}` : 'No tags yet.');
      return;
    }

    const showOnlyFoldersMatch = /^show\s+only\s+folders?\s+(.+)$/i.exec(trimmed);
    if (showOnlyFoldersMatch) {
      const requested = showOnlyFoldersMatch[1]
        .split(',')
        .map(folder => folder.trim())
        .filter(Boolean);
      if (requested.length === 0) {
        setStatusLine('Provide at least one folder to show.');
        return;
      }
      const validSet = new Set(
        requested.filter(folder => knownFolders.includes(folder))
      );
      const missing = requested.filter(folder => !knownFolders.includes(folder));
      if (validSet.size === 0) {
        setStatusLine('None of those folders exist.');
        return;
      }
      knownFolders.forEach((folder) => {
        if (validSet.has(folder)) {
          onUnhideFolder(folder);
        } else {
          onHideFolder(folder);
        }
      });
      onSelectFolder('all');
      const summary = Array.from(validSet).join(', ');
      setStatusLine(
        missing.length
          ? `Showing only folders: ${summary}. Unknown: ${missing.join(', ')}.`
          : `Showing only folders: ${summary}.`
      );
      toast.push('Folder visibility updated');
      return;
    }

    const showOnlyTagsMatch = /^show\s+only\s+tags?\s+(.+)$/i.exec(trimmed);
    if (showOnlyTagsMatch) {
      const requested = showOnlyTagsMatch[1]
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);
      if (requested.length === 0) {
        setStatusLine('Provide at least one tag to show.');
        return;
      }
      const validSet = new Set(
        requested.filter(tag => knownTags.includes(tag))
      );
      const missing = requested.filter(tag => !knownTags.includes(tag));
      if (validSet.size === 0) {
        setStatusLine('None of those tags exist.');
        return;
      }
      knownTags.forEach((tag) => {
        if (validSet.has(tag)) {
          onUnhideTag(tag);
        } else {
          onHideTag(tag);
        }
      });
      onClearTagFilter();
      const summary = Array.from(validSet).join(', ');
      setStatusLine(
        missing.length
          ? `Showing only tags: ${summary}. Unknown: ${missing.join(', ')}.`
          : `Showing only tags: ${summary}.`
      );
      toast.push('Tag visibility updated');
      return;
    }

    if (/^(clear|reset)\s+tag$/i.test(trimmed)) {
      if (!selectedTag) {
        setStatusLine('No tag filter is active.');
        return;
      }
      onClearTagFilter();
      setStatusLine('Tag filter cleared.');
      toast.push('Tag filter cleared');
      return;
    }

    if (/^(clear|reset)\s+hidden$/i.test(trimmed)) {
      const cleared = onClearHidden();
      setStatusLine(cleared ? 'Hidden list cleared.' : 'Nothing to clear.');
      if (cleared) {
        toast.push('All hidden folders cleared');
      }
      return;
    }

    if (/^(clear|reset)\s+hidden\s+tags?$/i.test(trimmed)) {
      const cleared = onClearHiddenTags();
      setStatusLine(cleared ? 'Hidden tags cleared.' : 'No hidden tags to clear.');
      if (cleared) {
        toast.push('All hidden tags cleared');
      }
      return;
    }

    if (/^(parents\s+only|only\s+parents|hide\s+solo(?:\s+images)?|hide\s+solos)$/i.test(trimmed)) {
      if (!showParentsOnly) {
        onSetParentsOnly(true);
        toast.push('Parents-only filter enabled');
      }
      setStatusLine('Showing only images with variants.');
      return;
    }

    if (/^(show\s+all|show\s+solos|allow\s+solo(?:\s+images)?|include\s+solo(?:\s+images)?)$/i.test(trimmed)) {
      if (showParentsOnly) {
        onSetParentsOnly(false);
        toast.push('Solo images restored');
      }
      setStatusLine('Showing all images.');
      return;
    }

    if (/^(page\s+next|next\s+page)$/i.test(trimmed)) {
      if (currentPage >= totalPages) {
        setStatusLine('Already on last page.');
      } else {
        onGoToPage(currentPage + 1);
        setStatusLine(`Moved to page ${currentPage + 1}.`);
      }
      return;
    }

    if (/^(page\s+prev|prev\s+page)$/i.test(trimmed)) {
      if (currentPage <= 1) {
        setStatusLine('Already on first page.');
      } else {
        onGoToPage(currentPage - 1);
        setStatusLine(`Moved to page ${currentPage - 1}.`);
      }
      return;
    }

    const jumpMatch = /^page\s+(\d+)$/i.exec(trimmed);
    if (jumpMatch) {
      const target = Number(jumpMatch[1]);
      if (Number.isNaN(target) || target < 1 || target > totalPages) {
        setStatusLine(`Page must be between 1 and ${totalPages}.`);
      } else {
        onGoToPage(target);
        setStatusLine(`Jumped to page ${target}.`);
      }
      return;
    }

    const hideTagMatch = /^(hide)\s+tags?\s+(.+)$/i.exec(trimmed);
    if (hideTagMatch) {
      const tagList = hideTagMatch[2]
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);
      if (tagList.length === 0) {
        setStatusLine('Provide at least one tag to hide.');
        return;
      }
      const addedTags = tagList.filter(tag => onHideTag(tag));
      if (addedTags.length > 0) {
        const summary = addedTags.join(', ');
        setStatusLine(`Hiding tag${addedTags.length > 1 ? 's' : ''}: ${summary}.`);
        toast.push(`Hidden tag${addedTags.length > 1 ? 's' : ''}: ${summary}`);
      } else {
        setStatusLine('All provided tags are already hidden.');
      }
      return;
    }

    const showTagMatch = /^(show)\s+tags?\s+(.+)$/i.exec(trimmed);
    if (showTagMatch) {
      const tagList = showTagMatch[2]
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);
      if (tagList.length === 0) {
        setStatusLine('Provide at least one tag to show.');
        return;
      }
      const [primaryTag, ...extraTags] = tagList;
      if (primaryTag) {
        onSelectTag(primaryTag);
        onUnhideTag(primaryTag);
        if (extraTags.length > 0) {
          setStatusLine(`Filtering by "${primaryTag}". Ignored: ${extraTags.join(', ')}.`);
        } else {
          setStatusLine(`Filtering by tag "${primaryTag}".`);
        }
        toast.push(`Filtering by tag "${primaryTag}"`);
      }
      return;
    }

    const unhideTagMatch = /^(unhide)\s+tags?\s+(.+)$/i.exec(trimmed);
    if (unhideTagMatch) {
      const tagList = unhideTagMatch[2]
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);
      if (tagList.length === 0) {
        setStatusLine('Provide at least one tag to unhide.');
        return;
      }
      const removedTags = tagList.filter(tag => onUnhideTag(tag));
      if (removedTags.length > 0) {
        const summary = removedTags.join(', ');
        setStatusLine(`Unhid tag${removedTags.length > 1 ? 's' : ''}: ${summary}.`);
        toast.push(`Visible tag${removedTags.length > 1 ? 's' : ''}: ${summary}`);
      } else {
        setStatusLine('None of those tags were hidden.');
      }
      return;
    }

    const hideMatch = /^(hide)\s+(?:folder\s+)?(.+)$/i.exec(trimmed);
    if (hideMatch) {
      const folderName = hideMatch[2].trim();
      if (!folderName) {
        setStatusLine('Provide a folder name to hide.');
        return;
      }
      const added = onHideFolder(folderName);
      setStatusLine(added ? `Hiding folder "${folderName}".` : `"${folderName}" is already hidden.`);
      if (added) {
        toast.push(`"${folderName}" hidden from gallery`);
      }
      return;
    }

    const showMatch = /^(unhide|show)\s+(?:folder\s+)?(.+)$/i.exec(trimmed);
    if (showMatch) {
      const folderName = showMatch[2].trim();
      if (!folderName) {
        setStatusLine('Provide a folder name to show.');
        return;
      }
      const removed = onUnhideFolder(folderName);
      setStatusLine(removed ? `Showing folder "${folderName}".` : `"${folderName}" was not hidden.`);
      if (removed) {
        toast.push(`"${folderName}" is now visible`);
      }
      return;
    }

    setStatusLine(`Unknown command "${trimmed}". Type "help".`);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runCommand(inputValue);
    setInputValue('');
    setSuggestionIndex(-1);
  };

  return (
    <div className="bg-slate-950/90 border border-slate-800 rounded-lg px-3 py-3">
      <div className="flex items-center gap-2 text-[0.6rem] uppercase tracking-wide text-slate-400">
        <span className="text-green-300">Gallery CLI</span>
        <span className="text-slate-500 lowercase">
          hide folder maintenance | page {currentPage}/{totalPages}
        </span>
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
