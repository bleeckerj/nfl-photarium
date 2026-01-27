/**
 * EditImageModal Component
 * 
 * Modal for editing a single image's metadata (filename, alt tag, tags).
 */

'use client';

import React, { CSSProperties, useState, useEffect } from 'react';
import type { CloudflareImage } from '../types';

interface EditImageModalProps {
  image: CloudflareImage;
  editedAltTag: string;
  editedTags: string;
  editedFilename: string;
  onAltTagChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onFilenameChange: (value: string) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
  onGenerateAltTag: () => Promise<void>;
  isGeneratingAlt?: boolean;
}

export const EditImageModal: React.FC<EditImageModalProps> = ({
  image,
  editedAltTag,
  editedTags,
  editedFilename,
  onAltTagChange,
  onTagsChange,
  onFilenameChange,
  onSave,
  onCancel,
  onGenerateAltTag,
  isGeneratingAlt = false,
}) => {
  const [isSaving, setIsSaving] = useState(false);

  const blurOverlayStyle: CSSProperties = {
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave();
    } finally {
      setIsSaving(false);
    }
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <>
      {/* Modal backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-[100000]"
        style={blurOverlayStyle}
        onClick={(e) => {
          e.stopPropagation();
          onCancel();
        }}
      />
      
      {/* Modal content */}
      <div
        className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-xl bg-white rounded-lg shadow-xl z-[100001] text-[0.7em] font-mono text-gray-800 border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="font-medium">Edit Image Metadata</div>
          <button
            onClick={onCancel}
            className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <div className="p-4 space-y-4">
          {/* Filename */}
          <div className="space-y-1">
            <label className="block text-gray-600 text-[0.9em]">Filename</label>
            <input
              type="text"
              value={editedFilename}
              onChange={(e) => onFilenameChange(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
              placeholder="Image filename..."
            />
          </div>

          {/* Alt Tag */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="block text-gray-600 text-[0.9em]">Alt Text</label>
              <button
                onClick={onGenerateAltTag}
                disabled={isGeneratingAlt}
                className="px-2 py-1 text-[0.85em] bg-purple-100 hover:bg-purple-200 disabled:opacity-50 rounded transition"
                title="Generate alt text using AI"
              >
                {isGeneratingAlt ? 'Generating...' : '✨ Generate'}
              </button>
            </div>
            <textarea
              value={editedAltTag}
              onChange={(e) => onAltTagChange(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-300 min-h-[80px] resize-y"
              placeholder="Describe this image..."
            />
          </div>

          {/* Tags */}
          <div className="space-y-1">
            <label className="block text-gray-600 text-[0.9em]">
              Tags <span className="text-gray-400">(comma-separated)</span>
            </label>
            <input
              type="text"
              value={editedTags}
              onChange={(e) => onTagsChange(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
              placeholder="tag1, tag2, tag3..."
            />
            {editedTags && (
              <div className="flex flex-wrap gap-1 mt-2">
                {editedTags.split(',').map((tag, i) => {
                  const trimmed = tag.trim();
                  if (!trimmed) return null;
                  return (
                    <span
                      key={i}
                      className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[0.85em]"
                    >
                      {trimmed}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Image preview */}
          <div className="border rounded p-2 bg-gray-50">
            <div className="text-[0.85em] text-gray-500 mb-2">Preview</div>
            <div className="flex items-center gap-3">
              <img
                src={`https://imagedelivery.net/${process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH}/${image.id}/thumbnail`}
                alt={editedAltTag || 'Preview'}
                className="w-16 h-16 object-cover rounded"
              />
              <div className="flex-1 min-w-0">
                <div className="text-gray-800 truncate">{editedFilename || image.filename}</div>
                <div className="text-gray-500 truncate text-[0.9em]">
                  {editedAltTag || 'No alt text'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50 transition"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>

        {/* Keyboard hint */}
        <div className="text-center text-[0.8em] text-gray-400 pb-2">
          Press <kbd className="px-1 bg-gray-100 rounded">⌘S</kbd> to save or{' '}
          <kbd className="px-1 bg-gray-100 rounded">Esc</kbd> to cancel
        </div>
      </div>
    </>
  );
};
