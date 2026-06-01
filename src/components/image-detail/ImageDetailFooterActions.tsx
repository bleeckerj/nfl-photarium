export const ImageDetailFooterActions = ({
  saving,
  isMetadataSaveDisabled,
  showDeleteFamily,
  onCancel,
  onDeleteImage,
  onDeleteFamily,
  onSave,
}: {
  saving: boolean;
  isMetadataSaveDisabled: boolean;
  showDeleteFamily: boolean;
  onCancel: () => void;
  onDeleteImage: () => void;
  onDeleteFamily: () => void;
  onSave: () => void;
}) => (
  <div className="flex justify-end gap-3 mt-4">
    <button
      onClick={onCancel}
      className="px-4 py-2 text-xs text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
    >
      Cancel
    </button>
    <button
      onClick={onDeleteImage}
      className="px-4 py-2 text-xs border border-red-300 text-red-700 rounded-md hover:bg-red-50"
      disabled={saving}
    >
      Delete image
    </button>
    {showDeleteFamily && (
      <button
        onClick={onDeleteFamily}
        className="px-4 py-2 text-xs border border-red-500 text-red-800 rounded-md bg-red-50 hover:bg-red-100"
        disabled={saving}
        title="Delete this image and all variations in its family"
      >
        Delete family
      </button>
    )}
    <button
      onClick={onSave}
      className="px-4 py-2 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
      disabled={isMetadataSaveDisabled}
    >
      {saving ? 'Saving...' : 'Save changes'}
    </button>
  </div>
);
