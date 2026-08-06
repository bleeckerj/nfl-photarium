import type { GalleryCommandBarProps } from '@/components/GalleryCommandBar';
import { GALLERY_COMMAND_HELP } from '@/components/galleryCommandHelp';

type CommandRunnerOptions = Pick<GalleryCommandBarProps,
  | 'hiddenFolders'
  | 'hiddenTags'
  | 'hiddenNamespaces'
  | 'knownFolders'
  | 'knownTags'
  | 'knownNamespaces'
  | 'onHideFolder'
  | 'onUnhideFolder'
  | 'onClearHidden'
  | 'onHideTag'
  | 'onUnhideTag'
  | 'onClearHiddenTags'
  | 'onHideNamespace'
  | 'onUnhideNamespace'
  | 'onClearHiddenNamespaces'
  | 'onSelectFolder'
  | 'selectedTag'
  | 'onSelectTag'
  | 'onClearTagFilter'
  | 'showParentsOnly'
  | 'onSetParentsOnly'
  | 'currentPage'
  | 'totalPages'
  | 'onGoToPage'
  | 'embeddingFilter'
  | 'onSetEmbeddingFilter'
  | 'onShowLastUploaded'
  | 'showComfyOnly'
  | 'onSetComfyOnly'> & {
  setStatusLine: (value: string) => void;
  toast: { push: (message: string) => void };
};

export function createGalleryCommandRunner(options: CommandRunnerOptions) {
  const {
    hiddenFolders, hiddenTags, hiddenNamespaces, knownFolders, knownTags,
    onHideFolder, onUnhideFolder, onClearHidden, onHideTag, onUnhideTag, onClearHiddenTags,
    onHideNamespace, onUnhideNamespace, onClearHiddenNamespaces, onSelectFolder, selectedTag,
    onSelectTag, onClearTagFilter, showParentsOnly, onSetParentsOnly, currentPage, totalPages,
    onGoToPage, embeddingFilter, onSetEmbeddingFilter, onShowLastUploaded, showComfyOnly,
    onSetComfyOnly, setStatusLine, toast,
  } = options;

  return (rawCommand: string) => {
    const trimmed = rawCommand.trim();
    if (!trimmed) {
      setStatusLine('Enter a command or type "help".');
      return;
    }

    if (/^help$/i.test(trimmed)) {
      setStatusLine(GALLERY_COMMAND_HELP);
      return;
    }

    if (/^(list|show)\s+hidden\s+tags?$/i.test(trimmed)) {
      setStatusLine(hiddenTags.length ? `Hidden tags: ${hiddenTags.join(', ')}` : 'No hidden tags.');
      return;
    }

    if (/^(list|show)\s+hidden\s+namespaces?$/i.test(trimmed)) {
      setStatusLine(hiddenNamespaces.length ? `Hidden namespaces: ${hiddenNamespaces.join(', ')}` : 'No hidden namespaces.');
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
      const wantsNoFolder = requested.some((folder) => {
        const normalized = folder.trim().toLowerCase();
        return normalized === 'no-folder' || normalized === 'no folder';
      });
      const requestedFolders = requested.filter((folder) => {
        const normalized = folder.trim().toLowerCase();
        return normalized !== 'no-folder' && normalized !== 'no folder';
      });
      const validSet = new Set(
        requestedFolders.filter(folder => knownFolders.includes(folder))
      );
      const missing = requestedFolders.filter(folder => !knownFolders.includes(folder));
      if (validSet.size === 0 && !wantsNoFolder) {
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
      if (wantsNoFolder) {
        onUnhideFolder('no-folder');
      } else {
        onHideFolder('no-folder');
      }
      onSelectFolder('all');
      const summary = [
        ...Array.from(validSet),
        ...(wantsNoFolder ? ['no-folder'] : [])
      ].join(', ');
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

    if (/^(clear|reset)\s+hidden\s+namespaces?$/i.test(trimmed)) {
      const cleared = onClearHiddenNamespaces();
      setStatusLine(cleared ? 'Hidden namespaces cleared.' : 'No hidden namespaces to clear.');
      if (cleared) {
        toast.push('All hidden namespaces cleared');
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

    if (/^(show\s+)?last\s+uploaded$/i.test(trimmed)) {
      if (!onShowLastUploaded) {
        setStatusLine('Last uploaded filter is not available in this view.');
        return;
      }
      const result = onShowLastUploaded();
      if (!result) {
        setStatusLine('No uploads available to filter.');
        return;
      }
      const label = new Date(`${result.dateKey}T00:00:00`).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      const suffix = result.count === 1 ? '' : 's';
      setStatusLine(`Showing ${result.count} image${suffix} from ${label}.`);
      toast.push(`Filtered to latest upload date (${label})`);
      return;
    }

    // Embedding filter commands
    if (/^show\s+(missing\s+)?clip$/i.test(trimmed) || /^(missing|no)\s+clip$/i.test(trimmed)) {
      onSetEmbeddingFilter('missing-clip');
      toast.push('Filtering: missing CLIP embeddings');
      setStatusLine('Showing images without CLIP embeddings.');
      return;
    }

    if (/^show\s+(missing\s+)?color$/i.test(trimmed) || /^(missing|no)\s+color$/i.test(trimmed)) {
      onSetEmbeddingFilter('missing-color');
      toast.push('Filtering: missing color embeddings');
      setStatusLine('Showing images without color embeddings.');
      return;
    }

    if (/^show\s+no\s+embeddings?$/i.test(trimmed) || /^no\s+embeddings?$/i.test(trimmed)) {
      onSetEmbeddingFilter('missing-both');
      toast.push('Filtering: no embeddings');
      setStatusLine('Showing images with no CLIP and no color embeddings.');
      return;
    }

    if (/^show\s+(missing\s+)?(embeddings?|any)$/i.test(trimmed) || /^missing\s+embeddings?$/i.test(trimmed)) {
      onSetEmbeddingFilter('missing-any');
      toast.push('Filtering: missing any embedding');
      setStatusLine('Showing images missing CLIP or color embeddings.');
      return;
    }

    if (/^(clear|reset)\s+embed(ding)?(\s+filter)?$/i.test(trimmed)) {
      if (embeddingFilter !== 'none') {
        onSetEmbeddingFilter('none');
        toast.push('Embedding filter cleared');
      }
      setStatusLine('Embedding filter cleared.');
      return;
    }

    if (/^(show\s+only\s+comfy(ui)?|comfy(ui)?\s+only|only\s+comfy(ui)?|show\s+comfy(ui)?)$/i.test(trimmed)) {
      if (!onSetComfyOnly) {
        setStatusLine('Comfy filter is not available in this view.');
        return;
      }
      onSetComfyOnly(true);
      toast.push('Filtering: Comfy images only');
      setStatusLine('Showing images with detected ComfyUI workflow metadata.');
      return;
    }

    if (/^(clear|reset)\s+comfy(\s+filter)?$/i.test(trimmed)) {
      if (!onSetComfyOnly) {
        setStatusLine('Comfy filter is not available in this view.');
        return;
      }
      if (showComfyOnly) {
        onSetComfyOnly(false);
        toast.push('Comfy filter cleared');
      }
      setStatusLine('Comfy filter cleared.');
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

    const hideNamespaceMatch = /^(hide)\s+namespaces?\s+(.+)$/i.exec(trimmed);
    if (hideNamespaceMatch) {
      const namespaceList = hideNamespaceMatch[2]
        .split(',')
        .map(namespace => namespace.trim())
        .filter(Boolean);
      if (namespaceList.length === 0) {
        setStatusLine('Provide at least one namespace to hide.');
        return;
      }
      const addedNamespaces = namespaceList.filter(namespace => onHideNamespace(namespace));
      if (addedNamespaces.length > 0) {
        const summary = addedNamespaces.join(', ');
        setStatusLine(`Hiding namespace${addedNamespaces.length > 1 ? 's' : ''}: ${summary}.`);
        toast.push(`Hidden namespace${addedNamespaces.length > 1 ? 's' : ''}: ${summary}`);
      } else {
        setStatusLine('All provided namespaces are already hidden.');
      }
      return;
    }

    const showNamespaceMatch = /^(unhide|show)\s+namespaces?\s+(.+)$/i.exec(trimmed);
    if (showNamespaceMatch) {
      const namespaceList = showNamespaceMatch[2]
        .split(',')
        .map(namespace => namespace.trim())
        .filter(Boolean);
      if (namespaceList.length === 0) {
        setStatusLine('Provide at least one namespace to show.');
        return;
      }
      const removedNamespaces = namespaceList.filter(namespace => onUnhideNamespace(namespace));
      if (removedNamespaces.length > 0) {
        const summary = removedNamespaces.join(', ');
        setStatusLine(`Showing namespace${removedNamespaces.length > 1 ? 's' : ''}: ${summary}.`);
        toast.push(`Visible namespace${removedNamespaces.length > 1 ? 's' : ''}: ${summary}`);
      } else {
        setStatusLine('None of those namespaces were hidden.');
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
}
