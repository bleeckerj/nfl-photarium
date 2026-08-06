'use client';

import MonoSelect from '@/components/MonoSelect';

export interface BulkEditMetadataSectionsProps {
  bulkApplyDescription: boolean;
  onBulkApplyDescriptionChange: (value: boolean) => void;
  bulkDescriptionAppendInput: string;
  onBulkDescriptionAppendInputChange: (value: string) => void;
  bulkApplyFolder: boolean;
  onBulkApplyFolderChange: (value: boolean) => void;
  bulkFolderMode: 'existing' | 'new';
  bulkFolderInput: string;
  onBulkFolderInputChange: (value: string) => void;
  bulkFolderOptions: Array<{ value: string; label: string }>;
  onBulkFolderSelect: (value: string) => void;
  bulkApplyTags: boolean;
  onBulkApplyTagsChange: (value: boolean) => void;
  bulkTagsMode: 'replace' | 'append' | 'ai';
  onBulkTagsModeChange: (value: 'replace' | 'append' | 'ai') => void;
  bulkTagsInput: string;
  onBulkTagsInputChange: (value: string) => void;
  bulkTagsAiCount: string;
  onBulkTagsAiCountChange: (value: string) => void;
  bulkApplyDisplayName: boolean;
  onBulkApplyDisplayNameChange: (value: boolean) => void;
  bulkDisplayNameMode: 'custom' | 'auto' | 'clear' | 'ai';
  onBulkDisplayNameModeChange: (value: 'custom' | 'auto' | 'clear' | 'ai') => void;
  bulkDisplayNameInput: string;
  onBulkDisplayNameInputChange: (value: string) => void;
}

export function BulkEditMetadataSections({
  bulkApplyDescription, onBulkApplyDescriptionChange, bulkDescriptionAppendInput, onBulkDescriptionAppendInputChange,
  bulkApplyFolder, onBulkApplyFolderChange, bulkFolderMode, bulkFolderInput, onBulkFolderInputChange, bulkFolderOptions, onBulkFolderSelect,
  bulkApplyTags, onBulkApplyTagsChange, bulkTagsMode, onBulkTagsModeChange, bulkTagsInput, onBulkTagsInputChange, bulkTagsAiCount, onBulkTagsAiCountChange,
  bulkApplyDisplayName, onBulkApplyDisplayNameChange, bulkDisplayNameMode, onBulkDisplayNameModeChange, bulkDisplayNameInput, onBulkDisplayNameInputChange,
}: BulkEditMetadataSectionsProps) {
  return <>
    <div className="space-y-3">
      <label className="flex items-center gap-2"><input type="checkbox" checked={bulkApplyDescription} onChange={(event) => onBulkApplyDescriptionChange(event.target.checked)} className="h-3 w-3" />Append to description</label>
      {bulkApplyDescription && <div className="space-y-2"><textarea value={bulkDescriptionAppendInput} onChange={(event) => onBulkDescriptionAppendInputChange(event.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" placeholder="Text to append to each selected image description" rows={3} /><p className="text-[0.6rem] text-gray-500">Appends text to existing descriptions with a blank line separator.</p></div>}
    </div>
    <div className="space-y-3">
      <label className="flex items-center gap-2"><input type="checkbox" checked={bulkApplyFolder} onChange={(event) => onBulkApplyFolderChange(event.target.checked)} className="h-3 w-3" />Update folder</label>
      {bulkApplyFolder && <div className="space-y-2">{bulkFolderMode === 'existing' ? <><MonoSelect value={bulkFolderInput} onChange={onBulkFolderSelect} options={bulkFolderOptions} className="w-full" placeholder="[none]" size="sm" /><p className="text-[0.6rem] text-gray-500">Choose an existing folder or pick “Create new folder…” to type a new name.</p></> : <div className="space-y-2"><input type="text" value={bulkFolderInput} onChange={(event) => onBulkFolderInputChange(event.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" placeholder="Type new folder name" /><button type="button" onClick={() => onBulkFolderSelect('')} className="text-[0.6rem] text-blue-600 underline">← Back to folder list</button></div>}</div>}
    </div>
    <div className="space-y-3">
      <label className="flex items-center gap-2"><input type="checkbox" checked={bulkApplyTags} onChange={(event) => onBulkApplyTagsChange(event.target.checked)} className="h-3 w-3" />Update tags</label>
      {bulkApplyTags && <div className="space-y-2"><div className="flex items-center gap-4 text-[0.65rem] text-gray-600">{(['replace', 'append', 'ai'] as const).map((value) => <label key={value} className="flex items-center gap-2"><input type="radio" name="bulk-tags-mode" checked={bulkTagsMode === value} onChange={() => onBulkTagsModeChange(value)} className="h-3 w-3" />{value === 'ai' ? 'Append (GenAI)' : value[0].toUpperCase() + value.slice(1)}</label>)}</div>{bulkTagsMode === 'ai' ? <label className="block text-[0.65rem] text-gray-600">Tags per image<input type="number" min="1" max="12" value={bulkTagsAiCount} onChange={(event) => onBulkTagsAiCountChange(event.target.value)} className="mt-1 w-24 border border-gray-300 rounded px-3 py-2" /></label> : <textarea value={bulkTagsInput} onChange={(event) => onBulkTagsInputChange(event.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" placeholder="Comma-separated tags" rows={3} />}<p className="text-[0.6rem] text-gray-500">{bulkTagsMode === 'replace' ? 'Replace tags with this list (empty clears tags).' : bulkTagsMode === 'append' ? 'Append tags to each image (empty keeps existing tags).' : 'Generate semantic tags for each selected image and append only new tags.'}</p></div>}
    </div>
    <div className="space-y-3">
      <label className="flex items-center gap-2"><input type="checkbox" checked={bulkApplyDisplayName} onChange={(event) => onBulkApplyDisplayNameChange(event.target.checked)} className="h-3 w-3" />Update display name</label>
      {bulkApplyDisplayName && <div className="space-y-2"><div className="flex flex-wrap items-center gap-4 text-[0.65rem] text-gray-600">{(['custom', 'auto', 'ai', 'clear'] as const).map((value) => <label key={value} className="flex items-center gap-2"><input type="radio" name="bulk-display-name-mode" checked={bulkDisplayNameMode === value} onChange={() => onBulkDisplayNameModeChange(value)} className="h-3 w-3" />{value === 'auto' ? 'Auto (trim filename)' : value === 'ai' ? 'AI (generate)' : value[0].toUpperCase() + value.slice(1)}</label>)}</div>{bulkDisplayNameMode === 'custom' && <input type="text" value={bulkDisplayNameInput} onChange={(event) => onBulkDisplayNameInputChange(event.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" placeholder="Display name" />}<p className="text-[0.6rem] text-gray-500">Auto mode uses the filename trimmed to 64 characters. AI mode generates a short name per image.</p></div>}
    </div>
  </>;
}
