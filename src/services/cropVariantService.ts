export type CropVariantAnchor = 'top' | 'center' | 'bottom';
export type CropVariantMode = 'crop' | 'outpaint';
export type CropVariantPlacement = 'top' | 'center' | 'bottom' | 'left' | 'right';

export type CropVariantRequest = {
  aspectRatio: string;
  anchor: CropVariantAnchor;
  mode?: CropVariantMode;
  placement?: CropVariantPlacement;
  quality?: number;
  filename?: string;
  description?: string;
  tags?: string[];
};

export type CropVariantResponse = {
  success: true;
  id: string;
  url?: string;
  variants?: string[];
  filename?: string;
  displayName?: string;
  parentId?: string;
  sourceImageId: string;
  sourceWidth: number;
  sourceHeight: number;
  mode: CropVariantMode;
  crop?: {
    width: number;
    height: number;
    aspectRatio: string;
    anchor: CropVariantAnchor;
    x: number;
    y: number;
  };
  canvas?: {
    sourceWidth: number;
    sourceHeight: number;
    targetWidth: number;
    targetHeight: number;
    aspectRatio: string;
    placement: CropVariantPlacement;
    x: number;
    y: number;
    padding: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
  };
  animated?: {
    frameCount: number;
    delaysPreserved: boolean;
  };
  bytes: number;
  mimeType: 'image/webp';
  image?: unknown;
};

export async function createCropVariant(
  imageId: string,
  request: CropVariantRequest
): Promise<CropVariantResponse> {
  const response = await fetch(`/api/images/${encodeURIComponent(imageId)}/crop-variant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to create crop variant');
  }
  return payload as CropVariantResponse;
}
