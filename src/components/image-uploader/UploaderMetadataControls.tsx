import type { Dispatch, SetStateAction } from 'react';

import MonoSelect from '@/components/MonoSelect';

interface SelectOption {
  value: string;
  label: string;
}

interface UploaderMetadataControlsProps {
  selectedFolder: string;
  setSelectedFolder: (value: string) => void;
  newFolder: string;
  setNewFolder: (value: string) => void;
  folders: string[];
  setFolders: Dispatch<SetStateAction<string[]>>;
  folderSelectOptions: SelectOption[];
  tags: string;
  setTags: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  originalUrl: string;
  setOriginalUrl: (value: string) => void;
  omitOriginalUrl: boolean;
  setOmitOriginalUrl: (value: boolean) => void;
  sourceUrl: string;
  setSourceUrl: (value: string) => void;
}

export default function UploaderMetadataControls({
  selectedFolder,
  setSelectedFolder,
  newFolder,
  setNewFolder,
  folders,
  setFolders,
  folderSelectOptions,
  tags,
  setTags,
  description,
  setDescription,
  originalUrl,
  setOriginalUrl,
  omitOriginalUrl,
  setOmitOriginalUrl,
  sourceUrl,
  setSourceUrl,
}: UploaderMetadataControlsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
      <div>
        <label htmlFor="folder-select" className="block text-xs fonto-mono text-gray-700 mb-2">
          Folder (Optional)
        </label>
        <div className="flex space-x-2">
          <MonoSelect
            id="folder-select"
            value={selectedFolder}
            onChange={setSelectedFolder}
            options={folderSelectOptions}
            placeholder="Choose folder"
            className="flex-1"
          />
          <input
            type="text"
            placeholder="New folder"
            value={newFolder}
            onChange={(event) => setNewFolder(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && newFolder.trim()) {
                event.preventDefault();
                const folderName = newFolder.trim().toLowerCase().replace(/\s+/g, '-');
                if (!folders.includes(folderName)) {
                  setFolders((prev) => [...prev, folderName]);
                  setSelectedFolder(folderName);
                }
                setNewFolder('');
              }
            }}
            className="w-32 border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">Press Enter to create new folder</p>
      </div>

      <div>
        <label htmlFor="tags-input" className="block text-xs font-mono font-medium text-gray-700 mb-2">
          Tags (Optional)
        </label>
        <input
          id="tags-input"
          type="text"
          placeholder="logo, header, banner (comma separated)"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">Separate tags with commas</p>
      </div>

      <div>
        <label htmlFor="description-input" className="block text-xs font-mono font-medium text-gray-700 mb-2">
          Description (Optional)
        </label>
        <textarea
          id="description-input"
          placeholder="Brief description of the image..."
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical"
        />
        <p className="text-xs text-gray-500 mt-1">Optional description for the image</p>
      </div>

      <div>
        <label htmlFor="original-url-input" className="block text-xs font-mono font-medium text-gray-700 mb-2">
          Original URL (Optional)
        </label>
        <label className="mb-2 flex items-center gap-2 text-[11px] text-gray-600">
          <input
            type="checkbox"
            checked={omitOriginalUrl}
            onChange={(event) => {
              setOmitOriginalUrl(event.target.checked);
              if (event.target.checked) {
                setOriginalUrl('');
              }
            }}
            className="h-3 w-3"
          />
          Do not store original URL
        </label>
        <input
          id="original-url-input"
          type="url"
          placeholder="https://example.com/original-image.jpg"
          value={originalUrl}
          onChange={(event) => setOriginalUrl(event.target.value)}
          disabled={omitOriginalUrl}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        />
      </div>

      <div>
        <label htmlFor="source-url-input" className="block text-xs font-mono font-medium text-gray-700 mb-2">
          Source URL (Optional)
        </label>
        <input
          id="source-url-input"
          type="url"
          placeholder="https://example.com/page-or-collection"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">Where the image was found (page or site)</p>
      </div>
    </div>
  );
}
