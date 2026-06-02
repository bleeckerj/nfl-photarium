interface EmbeddingSettingsPanelProps {
  embeddingQueueDepth: number;
  embedClipOnUpload: boolean;
  setEmbedClipOnUpload: (value: boolean) => void;
  embedColorOnUpload: boolean;
  setEmbedColorOnUpload: (value: boolean) => void;
}

export default function EmbeddingSettingsPanel({
  embeddingQueueDepth,
  embedClipOnUpload,
  setEmbedClipOnUpload,
  embedColorOnUpload,
  setEmbedColorOnUpload,
}: EmbeddingSettingsPanelProps) {
  return (
    <div className="mt-4 p-4 border border-dashed rounded-lg bg-white/60">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-mono font-medium text-gray-900">Embeddings after upload</p>
        {embeddingQueueDepth > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-purple-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-600"></span>
            </span>
            {embeddingQueueDepth} queued
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-[11px] text-gray-600">
          <input
            type="checkbox"
            checked={embedClipOnUpload}
            onChange={(event) => setEmbedClipOnUpload(event.target.checked)}
            className="h-3 w-3"
          />
          Similarity (CLIP)
        </label>
        <label className="flex items-center gap-2 text-[11px] text-gray-600">
          <input
            type="checkbox"
            checked={embedColorOnUpload}
            onChange={(event) => setEmbedColorOnUpload(event.target.checked)}
            className="h-3 w-3"
          />
          Color palette
        </label>
      </div>
      <p className="text-[11px] text-gray-500 mt-2">
        Embeddings run in the background after upload and may take a while. You can keep uploading while they finish.
      </p>
    </div>
  );
}
