import { AltTextEditor } from './AltTextEditor';
import { CloudflareMetadataHeader } from './CloudflareMetadataHeader';
import { ComfyWorkflowPanel, type ComfyWorkflowRecord } from './comfy';
import { DescriptionEditor } from './DescriptionEditor';
import { ExifSection } from './ExifSection';
import { FavoriteToggle } from './FavoriteToggle';
import { FolderTagsNameEditor } from './FolderTagsNameEditor';
import { NamespaceMoveSection } from './NamespaceMoveSection';
import { OriginalUrlSection } from './OriginalUrlSection';
import { PromptThisEditor } from './PromptThisEditor';
import { ShareSection } from './ShareSection';
import { SourceUrlSection } from './SourceUrlSection';
import { VariantLinksSection } from './VariantLinksSection';
import type { CloudflareImage } from './types';

export const ImageDetailMetadataPanel = ({
  image,
  favorite,
  favoriteLoading,
  metadataByteSize,
  metadataPrunedByteSize,
  metadataLargestFields,
  metadataPrunedDroppedFields,
  extrasBackedFields,
  isMetadataDirty,
  pendingAutoSave,
  saving,
  detailAspectLoading,
  detailDimensions,
  detailAspectRatio,
  detailFileSizeLabel,
  detailNamespaceOptions,
  namespaceMoving,
  descriptionInput,
  descriptionGenerating,
  hasVariations,
  bulkDescriptionApplying,
  altTextInput,
  altLoading,
  bulkAltApplying,
  promptThisInput,
  promptThisLoading,
  promptThisGenerating,
  promptThisSaving,
  promptThisMeta,
  comfyWorkflow,
  folderEditorProps,
  originalUrlInput,
  originalUrlTooLong,
  originalUrlByteLength,
  originalDeliveryUrl,
  sourceUrlInput,
  shareBaseUrl,
  shareVariant,
  shareVariantOptions,
  shareUrl,
  shareQrDataUrl,
  exifEntries,
  variants,
  imageDownloadName,
  onToggleFavorite,
  onDiscard,
  onSave,
  onCreateNamespace,
  onMoveNamespace,
  onDescriptionInputChange,
  onGenerateDescription,
  onApplyDescriptionToVariations,
  onAltTextInputChange,
  onGenerateAlt,
  onApplyAltToVariations,
  onPromptThisInputChange,
  onGeneratePromptThis,
  onCopyText,
  onOriginalUrlInputChange,
  onSourceUrlInputChange,
  onShareBaseUrlChange,
  onShareVariantChange,
  getVariantWidthLabel,
  onCopyVariantUrl,
}: {
  image: CloudflareImage;
  favorite: boolean;
  favoriteLoading: boolean;
  metadataByteSize: number;
  metadataPrunedByteSize: number;
  metadataLargestFields: Array<{ key: string; bytes: number }>;
  metadataPrunedDroppedFields: string[];
  extrasBackedFields: string[];
  isMetadataDirty: boolean;
  pendingAutoSave: boolean;
  saving: boolean;
  detailAspectLoading: boolean;
  detailDimensions?: { width: number; height: number } | null;
  detailAspectRatio?: string | null;
  detailFileSizeLabel: string;
  detailNamespaceOptions: string[];
  namespaceMoving: boolean;
  descriptionInput: string;
  descriptionGenerating: boolean;
  hasVariations: boolean;
  bulkDescriptionApplying: boolean;
  altTextInput: string;
  altLoading: boolean;
  bulkAltApplying: boolean;
  promptThisInput: string;
  promptThisLoading: boolean;
  promptThisGenerating: boolean;
  promptThisSaving: boolean;
  promptThisMeta: { saved?: boolean; updatedAt?: string; model?: string } | null;
  comfyWorkflow?: ComfyWorkflowRecord | null;
  folderEditorProps: React.ComponentProps<typeof FolderTagsNameEditor>;
  originalUrlInput: string;
  originalUrlTooLong: boolean;
  originalUrlByteLength: number;
  originalDeliveryUrl: string;
  sourceUrlInput: string;
  shareBaseUrl: string;
  shareVariant: string;
  shareVariantOptions: Array<{ value: string; label: string }>;
  shareUrl: string;
  shareQrDataUrl: string;
  exifEntries: Array<[string, string]>;
  variants: Record<string, string>;
  imageDownloadName: string;
  onToggleFavorite: () => void;
  onDiscard: () => void;
  onSave: () => void;
  onCreateNamespace: (namespace: string, description?: string) => Promise<boolean>;
  onMoveNamespace: (namespace: string) => Promise<boolean>;
  onDescriptionInputChange: (value: string) => void;
  onGenerateDescription: () => void;
  onApplyDescriptionToVariations: () => void;
  onAltTextInputChange: (value: string) => void;
  onGenerateAlt: (imageId: string) => void;
  onApplyAltToVariations: () => void;
  onPromptThisInputChange: (value: string) => void;
  onGeneratePromptThis: (force?: boolean) => void;
  onCopyText: (text: string, message?: string) => Promise<void>;
  onOriginalUrlInputChange: (value: string) => void;
  onSourceUrlInputChange: (value: string) => void;
  onShareBaseUrlChange: (value: string) => void;
  onShareVariantChange: (value: string) => void;
  getVariantWidthLabel: (variant: string) => string | null;
  onCopyVariantUrl: (
    event: React.MouseEvent<HTMLButtonElement>,
    url: string,
    label?: string,
    altText?: string
  ) => Promise<void>;
}) => (
  <>
    {image.assetType !== 'video' && (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-mono text-gray-600">Favorite status</p>
        <FavoriteToggle favorite={favorite} loading={favoriteLoading} onToggle={onToggleFavorite} />
      </div>
    )}
    <CloudflareMetadataHeader
      metadataByteSize={metadataByteSize}
      metadataPrunedByteSize={metadataPrunedByteSize}
      metadataLargestFields={metadataLargestFields}
      metadataPrunedDroppedFields={metadataPrunedDroppedFields}
      extrasBackedFields={extrasBackedFields}
      isMetadataDirty={isMetadataDirty}
      pendingAutoSave={pendingAutoSave}
      saving={saving}
      onDiscard={onDiscard}
      onSave={onSave}
    />
    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-gray-500">
      <span className="text-gray-400">Dimensions</span>
      {detailAspectLoading && !detailDimensions ? (
        <span className="inline-block w-20 h-2 bg-gray-200 rounded animate-pulse" />
      ) : detailDimensions ? (
        <span className="text-gray-700">{detailDimensions.width}x{detailDimensions.height}px</span>
      ) : (
        <span className="text-gray-400">--</span>
      )}
      <span className="text-gray-300">-</span>
      <span className="text-gray-400">Aspect</span>
      {detailAspectLoading && !detailAspectRatio ? (
        <span className="inline-block w-10 h-2 bg-gray-200 rounded animate-pulse" />
      ) : detailAspectRatio ? (
        <span className="text-gray-700">{detailAspectRatio}</span>
      ) : (
        <span className="text-gray-400">--</span>
      )}
      <span className="text-gray-300">-</span>
      <span className="text-gray-400">File size</span>
      <span className="text-gray-700">{detailFileSizeLabel}</span>
    </div>
    <NamespaceMoveSection
      currentNamespace={image.namespace}
      namespaceOptions={detailNamespaceOptions}
      moving={namespaceMoving}
      onCreateNamespace={onCreateNamespace}
      onMove={onMoveNamespace}
    />
    <DescriptionEditor
      descriptionInput={descriptionInput}
      setDescriptionInput={onDescriptionInputChange}
      descriptionGenerating={descriptionGenerating}
      onGenerateDescription={onGenerateDescription}
      hasVariations={hasVariations}
      bulkDescriptionApplying={bulkDescriptionApplying}
      onApplyToVariations={onApplyDescriptionToVariations}
    />
    <AltTextEditor
      imageId={image.id}
      imageHasAlt={Boolean(image.altTag)}
      altTextInput={altTextInput}
      setAltTextInput={onAltTextInputChange}
      altLoading={altLoading}
      onGenerateAlt={onGenerateAlt}
      onCopy={() => onCopyText(altTextInput || '', 'ALT text copied')}
      hasVariations={hasVariations}
      bulkAltApplying={bulkAltApplying}
      onApplyToVariations={onApplyAltToVariations}
    />
    <PromptThisEditor
      promptThisInput={promptThisInput}
      setPromptThisInput={onPromptThisInputChange}
      promptThisLoading={promptThisLoading}
      promptThisGenerating={promptThisGenerating}
      promptThisSaving={promptThisSaving}
      promptThisMeta={promptThisMeta}
      onGenerate={onGeneratePromptThis}
      onCopy={() => onCopyText(promptThisInput || '', 'Prompt copied')}
    />
    <ComfyWorkflowPanel
      imageId={image.id}
      comfyWorkflow={comfyWorkflow ?? null}
      detection={{
        generatedBy: image.generatedBy,
        comfyMetadataDetected: image.comfyMetadataDetected,
        comfyMetadataSource: image.comfyMetadataSource,
      }}
      onCopyText={onCopyText}
    />
    <FolderTagsNameEditor {...folderEditorProps} />
    <OriginalUrlSection
      originalUrlInput={originalUrlInput}
      setOriginalUrlInput={onOriginalUrlInputChange}
      originalUrlTooLong={originalUrlTooLong}
      originalUrlByteLength={originalUrlByteLength}
      originalDeliveryUrl={originalDeliveryUrl}
      originalUrlNormalized={image.originalUrlNormalized}
      contentHash={image.contentHash}
      onCopyToClipboard={onCopyText}
    />
    <SourceUrlSection
      sourceUrlInput={sourceUrlInput}
      setSourceUrlInput={onSourceUrlInputChange}
      sourceUrlNormalized={image.sourceUrlNormalized}
      onCopyToClipboard={onCopyText}
    />
    <ShareSection
      shareBaseUrl={shareBaseUrl}
      setShareBaseUrl={onShareBaseUrlChange}
      shareVariant={shareVariant}
      setShareVariant={onShareVariantChange}
      shareVariantOptions={shareVariantOptions}
      shareUrl={shareUrl}
      shareQrDataUrl={shareQrDataUrl}
      onCopyToClipboard={onCopyText}
    />
    <ExifSection exifEntries={exifEntries} />
    <VariantLinksSection
      variants={variants}
      getVariantWidthLabel={getVariantWidthLabel}
      onHandleCopyUrl={onCopyVariantUrl}
      imageAltTag={image.altTag}
      imageDownloadName={imageDownloadName}
    />
  </>
);
