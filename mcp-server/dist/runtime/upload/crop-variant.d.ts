export type CropVariantAnchor = 'top' | 'center' | 'bottom';
export type CropVariantOptions = {
    imageId: string;
    aspectRatio?: string;
    anchor?: CropVariantAnchor;
    quality?: number;
    filename?: string;
    folder?: string;
    tags?: string[];
    description?: string;
    prompt?: string;
    originalUrl?: string;
    sourceUrl?: string;
    namespace?: string;
    parentId?: string;
};
export type CropGeometry = {
    width: number;
    height: number;
    aspectRatio: string;
    anchor: CropVariantAnchor;
    x: number;
    y: number;
};
export type CropVariantResult = Record<string, unknown> & {
    sourceImageId: string;
    sourceWidth: number;
    sourceHeight: number;
    crop: CropGeometry;
    animated?: {
        frameCount: number;
        delaysPreserved: boolean;
    };
    bytes: number;
    mimeType: 'image/webp';
};
export declare function parseAspectRatio(value?: string): {
    label: string;
    width: number;
    height: number;
};
export declare function normalizeCropAnchor(value?: string): CropVariantAnchor;
export declare function computeWidthPreservingCrop(options: {
    sourceWidth: number;
    sourceHeight: number;
    aspectRatio?: string;
    anchor?: string;
}): CropGeometry;
export declare function cropPhotariumVariant(options: CropVariantOptions): Promise<CropVariantResult>;
