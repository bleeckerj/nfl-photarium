import type React from 'react';

export interface ImageLike {
  id: string;
  assetType?: 'image' | 'video';
  filename: string;
  displayName?: string;
  uploaded: string;
  size?: number;
  fileSizeBytes?: number | null;
  folder?: string;
  altTag?: string;
  aspectRatio?: string;
  dimensions?: { width: number; height: number };
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
  variants?: string[];
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface VariationsSectionProps {
  isChildImage: boolean;
  variationCount: number;
  variationLayout: 'list' | 'grid';
  setVariationLayout: (value: 'list' | 'grid') => void;
  variationTrueAspect: boolean;
  setVariationTrueAspect: (value: boolean) => void;

  listVariant: string;
  setListVariant: (value: string) => void;
  listVariantOptions: SelectOption[];
  onCopyList: () => void | Promise<void>;
  onCreateCropVariant?: () => void;

  variationCandidatesLength: number;
  variationOrderSaving: boolean;
  onResetVariationOrder: () => void | Promise<void>;
  onReverseVariationOrder: () => void | Promise<void>;
  onSortVariationOrder: () => void | Promise<void>;

  onDeleteParent: () => void | Promise<void>;
  onDeleteFamily: () => void | Promise<void>;

  selectedVariationCount: number;
  onSelectAllOnPage: () => void;
  onClearSelection: () => void;
  onGenerateAltForSelected: () => void | Promise<void>;
  variationAltBusy: boolean;
  onDeleteSelectedVariations: () => void | Promise<void>;
  deletingSelectedVariations: boolean;

  pagedVariations: ImageLike[];
  displayedVariations: ImageLike[];
  variationOrderIndex: Map<string, number>;

  selectedVariationIds: Set<string>;
  toggleVariationSelection: (variationId: string) => void;

  dragOverVariationId: string | null;
  setDraggingVariationId: (value: string | null) => void;
  setDragOverVariationId: (value: string | null) => void;
  onDropVariation: (targetId: string) => Promise<void>;
  onMoveVariation: (childId: string, direction: -1 | 1) => void | Promise<void>;

  onHandleThumbMouseMove: (url: string, label: string, evt: React.MouseEvent) => void;
  onHandleThumbLeave: () => void;
  onHandleImageDragStart: (evt: React.DragEvent, image: ImageLike) => void;
  onHandleCopyUrl: (
    event: React.MouseEvent<HTMLButtonElement>,
    url: string,
    label?: string,
    altText?: string,
    successMessage?: string
  ) => Promise<void>;
  onCopyVariationId: (id: string) => void | Promise<void>;

  onOpenVariantSizes: (target: ImageLike) => void;

  childDetachingId: string | null;
  detachingAllChildren: boolean;
  onDetachChild: (childId: string) => void | Promise<void>;
  onDetachAllChildren: () => void | Promise<void>;
  onDeleteChild: (childId: string) => void | Promise<void>;
  swappingParentId: string | null;
  swapParentAssetCount: number;
  onSwapParent: (childId: string) => void | Promise<void>;

  AspectRatioDisplay: React.ComponentType<{ imageId: string; aspectRatio?: string; className?: string }>;

  variationPage: number;
  setVariationPage: React.Dispatch<React.SetStateAction<number>>;
  totalVariationPages: number;
  variationPageSize: number;
}

