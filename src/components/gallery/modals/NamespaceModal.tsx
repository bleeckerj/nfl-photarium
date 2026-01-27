/**
 * NamespaceModal Component
 * 
 * Modal for managing namespace settings.
 * Displays available namespaces and allows changing the active one.
 */

'use client';

import React, { CSSProperties, useEffect } from 'react';
import MonoSelect from '@/components/MonoSelect';

interface NamespaceModalProps {
  /** List of available namespace IDs */
  availableNamespaces: string[];
  /** The currently active namespace */
  currentNamespace: string;
  /** Callback when user changes the namespace */
  onNamespaceChange: (namespaceId: string) => void;
  /** Close the modal */
  onClose: () => void;
}

export const NamespaceModal: React.FC<NamespaceModalProps> = ({
  availableNamespaces,
  currentNamespace,
  onNamespaceChange,
  onClose,
}) => {
  const blurOverlayStyle: CSSProperties = {
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  };

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Build namespace options for the select
  const namespaceOptions = [
    { value: '', label: '(all namespaces)' },
    ...availableNamespaces.map((ns) => ({
      value: ns,
      label: ns,
    })),
  ];

  const handleSelect = (value: string) => {
    onNamespaceChange(value);
    onClose();
  };

  return (
    <>
      {/* Modal backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-[100000]"
        style={blurOverlayStyle}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      
      {/* Modal content */}
      <div
        className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md bg-white rounded-lg shadow-xl z-[100001] text-[0.7em] font-mono text-gray-800 border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="font-medium">Namespace Settings</div>
          <button
            onClick={onClose}
            className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Current namespace display */}
          <div>
            <div className="text-gray-500 text-[0.9em] mb-1">Current Namespace</div>
            <div className="p-2 bg-blue-50 border border-blue-200 rounded">
              {currentNamespace || '(viewing all namespaces)'}
            </div>
          </div>

          {/* Namespace selector */}
          <div>
            <div className="text-gray-500 text-[0.9em] mb-1">Change Namespace</div>
            <MonoSelect
              value={currentNamespace}
              onChange={handleSelect}
              options={namespaceOptions}
              className="w-full"
              placeholder="Select namespace..."
              size="sm"
            />
          </div>

          {/* Namespace list for quick selection */}
          {availableNamespaces.length > 0 && (
            <div>
              <div className="text-gray-500 text-[0.9em] mb-2">Quick Select</div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                <button
                  onClick={() => handleSelect('')}
                  className={`w-full text-left px-3 py-2 rounded border transition ${
                    !currentNamespace
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-white border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="italic">(all namespaces)</span>
                </button>
                {availableNamespaces.map((ns) => {
                  const isActive = ns === currentNamespace;
                  return (
                    <button
                      key={ns}
                      onClick={() => handleSelect(ns)}
                      className={`w-full text-left px-3 py-2 rounded border transition ${
                        isActive
                          ? 'bg-blue-50 border-blue-200 text-blue-700'
                          : 'bg-white border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {ns}
                      {isActive && (
                        <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded text-[0.8em]">
                          Active
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {availableNamespaces.length === 0 && (
            <div className="text-center text-gray-400 py-4">
              No namespaces configured
            </div>
          )}
        </div>

        {/* Info section */}
        <div className="px-4 pb-4">
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-[0.9em] text-yellow-800">
            <strong>Tip:</strong> Selecting a namespace filters the gallery to show only images
            in that namespace. New uploads will be stored in the selected namespace.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end p-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded transition"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
};
