'use client';

import { X, Database, Info } from 'lucide-react';
import { useEffect, useState } from 'react';

interface RedisInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RedisInfoModal({ isOpen, onClose }: RedisInfoModalProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) return null;
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] px-4 animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-lg shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <Database className="w-6 h-6 text-orange-600" />
            </div>
            <h2 id="modal-title" className="text-xl font-semibold text-gray-900 font-mono">
              Semantic Search Unavailable
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 hover:bg-gray-100 p-2 rounded-full transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-gray-600">
          <div className="space-y-4">
            <p className="leading-relaxed">
              You are currently running in <strong className="text-gray-900">Simplified Mode</strong> without a Redis database.
            </p>
            
            <p className="leading-relaxed">
              This means the <strong>AI Semantic Search</strong> features ("blue sky", "similar images", "find by color") are disabled. 
              The application is strictly using your local file system to store basic metadata.
            </p>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-500" />
              How to Enable AI Features
            </h3>
            <ul className="list-disc list-outside ml-5 space-y-2 text-sm text-gray-700">
              <li>Deploy a <strong>Redis Stack</strong> instance (Docker or Redis Cloud).</li>
              <li>Set <code>CACHE_STORAGE_TYPE=redis</code> in your environment variables.</li>
              <li>Set <code>REDIS_URL</code> to your instance connection string.</li>
              <li>Restart the application.</li>
            </ul>
          </div>

          <div className="text-sm text-gray-500 pt-2">
            Refer to <code>DEPLOYMENT.md</code> or <code>README.md</code> for full setup instructions.
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-gray-300 rounded-md text-gray-700 font-medium hover:bg-gray-50 transition-colors shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
