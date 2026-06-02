"use client";

import MonoSelect from "../MonoSelect";

interface NamespaceOption {
  value: string;
  label: string;
}

interface NamespaceModalProps {
  open: boolean;
  namespaceSelectValue: string;
  namespaceDraft: string;
  namespaceOptions: NamespaceOption[];
  onSelectChange: (value: string) => void;
  onDraftChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}

const NamespaceModal = ({
  open,
  namespaceSelectValue,
  namespaceDraft,
  namespaceOptions,
  onSelectChange,
  onDraftChange,
  onClose,
  onSave,
}: NamespaceModalProps) => {
  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-[100000]"
        onClick={onClose}
      />
      <div className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 bg-white rounded-lg shadow-xl z-[100001] text-[0.75em] font-mono text-gray-800 border">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="text-[0.8em] font-mono font-medium">Namespace</div>
          <button
            onClick={onClose}
            className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-[0.75em] font-mono"
            title="Close"
          >
            ×
          </button>
        </div>
        <div className="p-3 space-y-3">
          <label className="block text-[0.75em] text-gray-600">
            Namespace
            <div className="mt-1 space-y-2">
              <MonoSelect
                id="namespace-select"
                value={namespaceSelectValue}
                onChange={onSelectChange}
                options={namespaceOptions}
                className="w-full"
                size="sm"
              />
              <input
                value={namespaceDraft}
                onChange={(e) => onDraftChange(e.target.value)}
                placeholder="Custom namespace (optional)"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-[0.85em] focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={namespaceSelectValue !== "__custom__"}
              />
            </div>
          </label>
          <p className="text-[0.7em] text-gray-500">
            Only images in this namespace are shown and used for duplicate checks (unless you pick &quot;All namespaces&quot;).
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 p-3 border-t">
          <button
            onClick={onClose}
            className="px-3 py-1 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
};

export default NamespaceModal;
