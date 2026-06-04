import Image from 'next/image';
import { ChevronDown, Cpu } from 'lucide-react';
import AntipodeSearch from '@/components/AntipodeSearch';
import { ColorSwatches } from '@/components/ColorSwatches';
import ConceptRadar from '@/components/ConceptRadar';
import EmbeddingStatusIcon from '@/components/EmbeddingStatusIcon';
import HaikuDisplay from '@/components/HaikuDisplay';
import SemanticNeighbors from '@/components/SemanticNeighbors';
import type { EmbeddingPendingEntry } from '@/utils/embeddingPending';
import { AspectRatioDisplay } from './AspectRatioDisplay';
import type { CloudflareImage } from './types';

type DeleteFamilyStatus = {
  total: number;
  attempted: number;
  deleted: number;
  failed: number;
  concurrency: number;
  lastError?: string;
} | null;

export const ImageSummarySection = ({
  image,
  pendingEmbedding,
  embeddingGenerating,
  namespace,
  semanticSearchAllNamespaces,
  deleteFamilyOpen,
  deleteFamilyStatus,
  listVariant,
  onGenerateEmbeddings,
  onSelectColor,
  onCopyText,
  onSemanticScopeChange,
  onCloseDeleteFamilyModal,
  onCommitNavigation,
  onToast,
}: {
  image: CloudflareImage;
  pendingEmbedding?: EmbeddingPendingEntry;
  embeddingGenerating: boolean;
  namespace: string;
  semanticSearchAllNamespaces: boolean;
  deleteFamilyOpen: boolean;
  deleteFamilyStatus: DeleteFamilyStatus;
  listVariant: string;
  onGenerateEmbeddings: () => void;
  onSelectColor: (hex: string) => void;
  onCopyText: (text: string, message: string) => Promise<void>;
  onSemanticScopeChange: (value: boolean) => void;
  onCloseDeleteFamilyModal: () => void;
  onCommitNavigation: (href: string, targetId?: string | null) => void;
  onToast: (message: string) => void;
}) => (
  <div id="image-summary-section" className="mb-6">
    <div className="flex items-center gap-2">
      <p className="text-xs mono font-semibold text-gray-900">{image.displayName || image.filename || 'Image'}</p>
      {(image.generatedBy === 'comfyui' || image.comfyMetadataDetected === true) && (
        <span
          id={`image-detail-comfy-indicator-${image.id}`}
          className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] text-orange-700"
          title="ComfyUI output detected"
          aria-label="ComfyUI output detected"
        >
          <Image
            src="/icons/comfyui.svg"
            alt="ComfyUI"
            width={14}
            height={14}
            className="h-3.5 w-3.5"
          />
          ComfyUI
        </span>
      )}
      <EmbeddingStatusIcon
        hasClipEmbedding={image.hasClipEmbedding}
        hasColorEmbedding={image.hasColorEmbedding}
        dominantColors={image.dominantColors}
        averageColor={image.averageColor}
        pendingStatus={pendingEmbedding?.status}
        pendingLabel={pendingEmbedding?.error}
        size={18}
        showTooltip={true}
      />
      <button
        onClick={onGenerateEmbeddings}
        disabled={embeddingGenerating}
        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
        title="Generate CLIP and color embeddings for vector search"
      >
        <Cpu className="h-3 w-3" />
        {embeddingGenerating || pendingEmbedding?.status === 'embedding'
          ? 'Generating...'
          : (image.hasClipEmbedding && image.hasColorEmbedding ? 'Refresh' : 'Generate')}
      </button>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
      <span className={`px-2 py-0.5 rounded-full border ${image.hasClipEmbedding ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
        CLIP {image.hasClipEmbedding ? 'ready' : 'missing'}
      </span>
      <span className={`px-2 py-0.5 rounded-full border ${image.hasColorEmbedding ? 'border-purple-200 bg-purple-50 text-purple-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
        Color {image.hasColorEmbedding ? 'ready' : 'missing'}
      </span>
      {pendingEmbedding && !(image.hasClipEmbedding && image.hasColorEmbedding) && (
        <span className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          {pendingEmbedding.status === 'queued' ? 'Embedding queued' : pendingEmbedding.status === 'embedding' ? 'Embedding running' : 'Embedding failed'}
        </span>
      )}
    </div>
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
      <span>Uploaded {new Date(image.uploaded).toLocaleString()}</span>
      <span className="text-gray-300">-</span>
      <span>Namespace {image.namespace || 'Missing namespace'}</span>
    </div>
    <ColorSwatches
      assetId={image.id}
      dominantColors={image.dominantColors}
      averageColor={image.averageColor}
      showLabels={true}
      className="mt-2"
      onSelectColor={onSelectColor}
    />
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
      <span className="text-gray-500">Image ID</span>
      <span className="font-mono text-gray-800">{image.id}</span>
      <button
        onClick={() => onCopyText(image.id, 'Image ID copied')}
        className="px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-100 text-[10px]"
      >
        Copy
      </button>
    </div>
    <AspectRatioDisplay imageId={image.id} />

    {image.hasClipEmbedding && (
      <div className="mt-4 pt-4 border-t border-gray-200">
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-gray-700 hover:text-gray-900 flex items-center gap-2">
            <ChevronDown className="h-3 w-3 group-open:rotate-180 transition-transform" />
            Semantic Analysis
            <span className="text-[10px] text-gray-500 font-normal">(CLIP embedding visualization)</span>
          </summary>
          <div className="mt-3 space-y-4">
            <div className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-white/60 px-3 py-2">
              <div className="text-[11px] text-gray-600">
                Scope: {semanticSearchAllNamespaces ? 'All namespaces' : (namespace || 'cf-default')}
              </div>
              <label className="flex items-center gap-2 text-[11px] text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={semanticSearchAllNamespaces}
                  onChange={(event) => onSemanticScopeChange(event.target.checked)}
                  className="h-3.5 w-3.5"
                />
                All namespaces
              </label>
            </div>
            <HaikuDisplay imageId={image.id} hasClipEmbedding={image.hasClipEmbedding} />

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                {deleteFamilyOpen && (
                  <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center px-4">
                    <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full overflow-hidden">
                      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-mono text-gray-900">Deleting image family...</h3>
                          <p className="text-[11px] text-gray-500">This can take a while for large families.</p>
                        </div>
                        <button
                          type="button"
                          onClick={onCloseDeleteFamilyModal}
                          className="text-xs px-2 py-1 border rounded text-gray-700 hover:bg-gray-50"
                        >
                          Hide
                        </button>
                      </div>
                      <div className="p-4 space-y-3">
                        {deleteFamilyStatus ? (
                          (() => {
                            const total = Math.max(1, deleteFamilyStatus.total);
                            const attempted = deleteFamilyStatus.attempted;
                            const pct = Math.min(100, Math.round((attempted / total) * 100));
                            return (
                              <>
                                <div className="flex items-center justify-between text-xs text-gray-700">
                                  <span className="font-mono">{attempted}/{total} attempted</span>
                                  <span className="font-mono">{pct}%</span>
                                </div>
                                <div className="h-2 w-full bg-gray-100 rounded">
                                  <div className="h-2 bg-red-500 rounded" style={{ width: `${pct}%` }} />
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-gray-600">
                                  <span>Deleted: <span className="font-mono">{deleteFamilyStatus.deleted}</span></span>
                                  <span>Failed: <span className="font-mono">{deleteFamilyStatus.failed}</span></span>
                                  <span>Concurrency: <span className="font-mono">{deleteFamilyStatus.concurrency}</span></span>
                                </div>
                                {deleteFamilyStatus.lastError && (
                                  <div className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded p-2">
                                    {deleteFamilyStatus.lastError}
                                  </div>
                                )}
                              </>
                            );
                          })()
                        ) : (
                          <div className="text-xs text-gray-600">Starting job...</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                <ConceptRadar
                  imageId={image.id}
                  size={320}
                  onImageClick={(result) => {
                    if (!result?.imageId) return;
                    onCommitNavigation(
                      result.assetType === 'video' ? `/videos/${result.imageId}` : `/images/${result.imageId}`,
                      result.imageId
                    );
                  }}
                  copyVariant={listVariant}
                  onCopySuccess={onToast}
                  namespace={namespace}
                  searchAllNamespaces={semanticSearchAllNamespaces}
                />
              </div>
              <div>
                <SemanticNeighbors
                  imageId={image.id}
                  type="clip"
                  limit={8}
                  showStrangers={true}
                  onImageClick={(clickedImageId) => {
                    if (!clickedImageId) return;
                    onCommitNavigation(`/images/${clickedImageId}`, clickedImageId);
                  }}
                  copyVariant={listVariant}
                  onCopySuccess={onToast}
                  namespace={namespace}
                  searchAllNamespaces={semanticSearchAllNamespaces}
                />
              </div>
            </div>

            <AntipodeSearch
              imageId={image.id}
              className="bg-gray-900/50 border border-amber-900/30 rounded-lg p-4"
              onImageClick={(result) => {
                if (!result?.imageId) return;
                onCommitNavigation(
                  result.assetType === 'video' ? `/videos/${result.imageId}` : `/images/${result.imageId}`,
                  result.imageId
                );
              }}
              copyVariant={listVariant}
              onCopySuccess={onToast}
              namespace={namespace}
              searchAllNamespaces={semanticSearchAllNamespaces}
            />
          </div>
        </details>
      </div>
    )}
  </div>
);
