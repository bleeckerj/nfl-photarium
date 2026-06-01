'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, CloudUpload, Cpu, Loader2, Sparkles, Zap } from 'lucide-react';
import clsx from 'clsx';

export interface ActivityStats {
  total: number;
  uploading: number;
  uploaded: number;
  embedding: number;
  embedded: number;
  errors: number;
  embeddingQueue: number;
}

export default function ActivityIndicator({
  stats,
  isActive,
}: {
  stats: ActivityStats;
  isActive: boolean;
}) {
  const [dots, setDots] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      setDots((value) => (value + 1) % 4);
    }, 400);
    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive && stats.total === 0) return null;

  const uploadProgress = stats.total > 0 ? (stats.uploaded / stats.total) * 100 : 0;
  const embeddingProgress =
    stats.embedded > 0 || stats.embedding > 0 || stats.embeddingQueue > 0
      ? (stats.embedded / (stats.embedded + stats.embedding + stats.embeddingQueue)) * 100
      : 0;
  const totalWork = stats.uploading + stats.embedding + stats.embeddingQueue;
  const isWorking = totalWork > 0;
  const phase =
    stats.uploading > 0
      ? 'upload'
      : stats.embedding > 0 || stats.embeddingQueue > 0
        ? 'embed'
        : 'complete';

  return (
    <div
      className={clsx(
        'rounded-xl border-2 p-4 mb-4 transition-all duration-300',
        isWorking
          ? 'border-blue-400 bg-gradient-to-r from-blue-50 via-purple-50 to-blue-50 shadow-lg shadow-blue-200/50'
          : stats.errors > 0
            ? 'border-amber-300 bg-amber-50'
            : 'border-emerald-300 bg-emerald-50'
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              'relative w-10 h-10 rounded-full flex items-center justify-center',
              isWorking ? 'bg-blue-500' : stats.errors > 0 ? 'bg-amber-500' : 'bg-emerald-500'
            )}
          >
            {isWorking ? (
              <>
                <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-40" />
                <div className="absolute inset-0 rounded-full bg-blue-300 animate-pulse opacity-30" />
                {phase === 'upload' ? (
                  <CloudUpload className="w-5 h-5 text-white animate-bounce" />
                ) : (
                  <Cpu className="w-5 h-5 text-white animate-spin" style={{ animationDuration: '2s' }} />
                )}
              </>
            ) : stats.errors > 0 ? (
              <AlertCircle className="w-5 h-5 text-white" />
            ) : (
              <Sparkles className="w-5 h-5 text-white" />
            )}
          </div>

          <div>
            <h3 className="text-sm font-bold text-gray-900">
              {phase === 'upload' && `Uploading${'.'.repeat(dots)}`}
              {phase === 'embed' && `Generating embeddings${'.'.repeat(dots)}`}
              {phase === 'complete' && (stats.errors > 0 ? 'Completed with errors' : 'All done!')}
            </h3>
            <p className="text-xs text-gray-600">
              {isWorking ? (
                <>
                  {stats.uploading > 0 && `${stats.uploading} uploading`}
                  {stats.uploading > 0 && (stats.embedding > 0 || stats.embeddingQueue > 0) && ' · '}
                  {(stats.embedding > 0 || stats.embeddingQueue > 0) &&
                    `${stats.embedding + stats.embeddingQueue} in embedding pipeline`}
                </>
              ) : (
                `${stats.uploaded} images processed`
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {stats.uploaded > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
              <CheckCircle className="w-3 h-3" />
              {stats.uploaded}
            </span>
          )}
          {stats.errors > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-medium">
              <AlertCircle className="w-3 h-3" />
              {stats.errors}
            </span>
          )}
        </div>
      </div>

      {(stats.uploading > 0 || stats.uploaded > 0) && (
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-gray-600">
              <span className="flex items-center gap-1">
                <CloudUpload className="w-3 h-3" />
                Upload progress
              </span>
              <span>
                {stats.uploaded} / {stats.total}
              </span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={clsx(
                  'h-full rounded-full transition-all duration-300',
                  stats.uploading > 0
                    ? 'bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500 bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite]'
                    : 'bg-emerald-500'
                )}
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>

          {(stats.embedding > 0 || stats.embeddingQueue > 0 || stats.embedded > 0) && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-gray-600">
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  Embeddings
                </span>
                <span>
                  {stats.embedded} / {stats.embedded + stats.embedding + stats.embeddingQueue}
                </span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={clsx(
                    'h-full rounded-full transition-all duration-300',
                    stats.embedding > 0
                      ? 'bg-gradient-to-r from-purple-500 via-purple-400 to-purple-500 bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite]'
                      : 'bg-emerald-500'
                  )}
                  style={{ width: `${embeddingProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {isWorking && stats.uploading > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="font-mono">Processing files...</span>
          </div>
        </div>
      )}
    </div>
  );
}
