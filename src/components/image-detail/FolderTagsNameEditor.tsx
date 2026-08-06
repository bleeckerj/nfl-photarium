import { Sparkles } from 'lucide-react';
import FolderManagerButton from '@/components/FolderManagerButton';
import MonoSelect from '@/components/MonoSelect';
import { parseTagDraft, serializeTagDraft, type TagCorpusEntry } from './tagEditor';
import { TagPillEditor } from './TagPillEditor';

export const FolderTagsNameEditor = ({
  folderSelect,
  newFolderInput,
  detailFolderOptions,
  hasVariations,
  bulkFolderApplying,
  effectiveParentFolder,
  tagsInput,
  tagGenerationCount,
  tagGenerationLoading,
  parentTags,
  tagCorpus,
  tagCorpusLoading,
  tagCorpusError,
  bulkTagsAppending,
  bulkTagsReplacing,
  displayNameInput,
  displayNameGenerating,
  immutableFilename,
  onFolderSelectChange,
  onNewFolderInputChange,
  onFoldersChanged,
  onApplyFolderToVariations,
  onTagsInputChange,
  onTagGenerationCountChange,
  onGenerateSemanticTags,
  onApplyTagsToVariations,
  onDisplayNameInputChange,
  onGenerateDisplayName,
}: {
  folderSelect: string;
  newFolderInput: string;
  detailFolderOptions: Array<{ value: string; label: string }>;
  hasVariations: boolean;
  bulkFolderApplying: boolean;
  effectiveParentFolder?: string;
  tagsInput: string;
  tagGenerationCount: number;
  tagGenerationLoading: boolean;
  parentTags: string[];
  tagCorpus: readonly TagCorpusEntry[];
  tagCorpusLoading: boolean;
  tagCorpusError: string | null;
  bulkTagsAppending: boolean;
  bulkTagsReplacing: boolean;
  displayNameInput: string;
  displayNameGenerating: boolean;
  immutableFilename: string;
  onFolderSelectChange: (value: string) => void;
  onNewFolderInputChange: (value: string) => void;
  onFoldersChanged: () => void;
  onApplyFolderToVariations: () => void;
  onTagsInputChange: (value: string) => void;
  onTagGenerationCountChange: (value: number) => void;
  onGenerateSemanticTags: () => void;
  onApplyTagsToVariations: (mode: 'append' | 'replace') => void;
  onDisplayNameInputChange: (value: string) => void;
  onGenerateDisplayName: () => void;
}) => (
  <>
    <div id="folder-section">
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono font-medum text-gray-700">Folder</p>
        <FolderManagerButton size="sm" label="Edit Folders" onFoldersChanged={onFoldersChanged} />
      </div>
      <div className="mt-2">
        <MonoSelect
          value={folderSelect}
          onChange={onFolderSelectChange}
          options={detailFolderOptions}
          className="w-full"
          placeholder="[none]"
          searchable
          searchPlaceholder="Search folders..."
        />
        {folderSelect === '__create__' && (
          <input
            value={newFolderInput}
            onChange={(event) => onNewFolderInputChange(event.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs mt-2"
            placeholder="Type new folder name"
          />
        )}
        {hasVariations && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <button
              onClick={onApplyFolderToVariations}
              disabled={bulkFolderApplying || !effectiveParentFolder}
              className="px-2 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {bulkFolderApplying ? 'Applying...' : 'Apply folder to variations'}
            </button>
            {!effectiveParentFolder && <span className="text-gray-500">Set a folder to enable.</span>}
          </div>
        )}
      </div>
    </div>

    <div id="tags-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-mono font-medum text-gray-700">Tags</p>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <label className="flex items-center gap-2 text-gray-600">
            <span>AI count</span>
            <input
              type="number"
              min={1}
              max={12}
              value={tagGenerationCount}
              onChange={(event) => onTagGenerationCountChange(Math.min(12, Math.max(1, Number.parseInt(event.target.value || '6', 10) || 6)))}
              className="w-16 rounded border border-gray-300 px-2 py-1 text-[11px]"
            />
          </label>
          <button
            type="button"
            onClick={onGenerateSemanticTags}
            disabled={tagGenerationLoading}
            className="inline-flex items-center gap-2 rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-700 hover:border-gray-300 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {tagGenerationLoading ? 'Generating tags...' : 'Generate semantic tags'}
          </button>
          {hasVariations && (
            <>
              <button
                onClick={() => onApplyTagsToVariations('append')}
                disabled={bulkTagsAppending || parentTags.length === 0}
                className="px-2 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {bulkTagsAppending ? 'Appending...' : 'Append to variations'}
              </button>
              <button
                onClick={() => onApplyTagsToVariations('replace')}
                disabled={bulkTagsReplacing}
                className="px-2 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {bulkTagsReplacing ? 'Replacing...' : 'Replace on variations'}
              </button>
            </>
          )}
        </div>
      </div>
      <TagPillEditor
        value={tagsInput}
        corpus={tagCorpus}
        corpusLoading={tagCorpusLoading}
        corpusError={tagCorpusError}
        onChange={onTagsInputChange}
      />
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <span className="text-[10px] text-gray-500">Exclude from:</span>
        {(['x-clip', 'x-color', 'x-search'] as const).map((tag) => {
          const parsedTags = parseTagDraft(tagsInput);
          const hasTag = parsedTags.controlTags.includes(tag);
          const toggleTag = () => {
            onTagsInputChange(serializeTagDraft({
              semanticTags: parsedTags.semanticTags,
              controlTags: hasTag
                ? parsedTags.controlTags.filter((value) => value !== tag)
                : [...parsedTags.controlTags, tag],
            }));
          };
          const label = tag === 'x-clip' ? 'Semantic' : tag === 'x-color' ? 'Color' : 'All Search';
          return (
            <button
              key={tag}
              onClick={toggleTag}
              className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                hasTag ? 'border-red-400 bg-red-50 text-red-700 hover:bg-red-100' : 'border-gray-300 text-gray-500 hover:bg-gray-50'
              }`}
              title={hasTag ? `Remove ${tag} tag` : `Add ${tag} tag to exclude from ${label.toLowerCase()} search`}
            >
              {hasTag ? 'yes ' : ''}{label}
            </button>
          );
        })}
      </div>
      {hasVariations && parentTags.length === 0 && (
        <p className="text-[10px] text-gray-500 mt-1">Add tags to enable appending.</p>
      )}
    </div>

    <div id="name-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-mono font-medum text-gray-700">Display name (editable)</p>
        <button
          onClick={onGenerateDisplayName}
          disabled={displayNameGenerating}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {displayNameGenerating ? 'Generating...' : 'Generate short name'}
        </button>
      </div>
      <input
        value={displayNameInput}
        onChange={(event) => onDisplayNameInputChange(event.target.value)}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs mt-2"
        placeholder="Display name (defaults to filename)"
      />
      <p className="text-[11px] text-gray-600 mt-1">
        Immutable filename: <span className="font-mono">{immutableFilename}</span>
      </p>
    </div>
  </>
);
