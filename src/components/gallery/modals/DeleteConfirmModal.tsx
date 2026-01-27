/**
 * DeleteConfirmModal Component
 * 
 * Confirmation dialog for deleting images (single or bulk).
 */

'use client';

import React, { CSSProperties, useEffect } from 'react';

interface DeleteConfirmModalProps {
  count: number;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  isDeleting?: boolean;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  count,
  onConfirm,
  onCancel,
  isDeleting = false,
}) => {
  const blurOverlayStyle: CSSProperties = {
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) {
        onCancel();
      } else if (e.key === 'Enter' && !isDeleting) {
        e.preventDefault();
        onConfirm();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, onConfirm, isDeleting]);

  const isSingle = count === 1;

  return (
    <>
      {/* Modal backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-[100000]"
        style={blurOverlayStyle}
        onClick={(e) => {
          e.stopPropagation();
          if (!isDeleting) onCancel();
        }}
      />
      
      {/* Modal content */}
      <div
        className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-sm bg-white rounded-lg shadow-xl z-[100001] text-[0.7em] font-mono text-gray-800 border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="font-medium text-red-600">
            ⚠️ Confirm Deletion
          </div>
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-gray-700 mb-4">
            {isSingle
              ? 'Are you sure you want to delete this image? This action cannot be undone.'
              : `Are you sure you want to delete ${count} images? This action cannot be undone.`}
          </p>

          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-[0.9em]">
            <strong>Warning:</strong> {isSingle ? 'This image' : 'These images'} will be permanently 
            removed from Cloudflare and cannot be recovered.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded transition disabled:opacity-50"
          >
            {isDeleting 
              ? 'Deleting...' 
              : isSingle 
                ? 'Delete Image' 
                : `Delete ${count} Images`}
          </button>
        </div>

        {/* Keyboard hint */}
        {!isDeleting && (
          <div className="text-center text-[0.8em] text-gray-400 pb-2">
            Press <kbd className="px-1 bg-gray-100 rounded">Enter</kbd> to confirm or{' '}
            <kbd className="px-1 bg-gray-100 rounded">Esc</kbd> to cancel
          </div>
        )}
      </div>
    </>
  );
};
