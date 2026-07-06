export type ImageReferenceRole = 'style_reference' | 'subject_reference' | 'composition_reference' | 'brand_reference' | 'logo_reference' | 'semantic_source';
export interface ImageReferenceInput {
    imageId?: string;
    url?: string;
    role?: ImageReferenceRole;
    instructions?: string;
}
export interface ImageGenerationSettings {
    prompt: string;
    model?: string;
    size?: string;
    quality?: string;
    outputFormat?: string;
    background?: string;
    filename?: string;
    namespace?: string;
    folder?: string;
    tags?: string[];
    description?: string;
    displayName?: string;
    parentId?: string;
    originalUrl?: string;
    sourceUrl?: string;
    dryRun?: boolean;
}
export interface AspectRatioVariantSettings {
    imageId?: string;
    imageUrl?: string;
    aspectRatio?: string;
    prompt?: string;
    model?: string;
    size?: string;
    quality?: string;
    outputFormat?: string;
    background?: string;
    filename?: string;
    namespace?: string;
    folder?: string;
    tags?: string[];
    description?: string;
    displayName?: string;
    parentId?: string;
    originalUrl?: string;
    sourceUrl?: string;
    dryRun?: boolean;
}
interface DownloadedImage {
    filename?: string;
    contentType?: string;
    base64: string;
    variantUsed: string;
    fallbackUsed: boolean;
}
interface UploadPayload {
    base64: string;
    filename: string;
    contentType?: string;
    folder?: string;
    tags?: string[];
    description?: string;
    originalUrl?: string;
    sourceUrl?: string;
    namespace?: string;
    parentId?: string;
    prompt?: string;
}
export interface ImageGenerationDeps {
    downloadOriginalImageById: (imageId: string) => Promise<DownloadedImage>;
    uploadFileBase64: (endpoint: '/api/upload' | '/api/upload/external', payload: UploadPayload) => Promise<Record<string, unknown>>;
}
export interface AspectRatioVariantDeps extends ImageGenerationDeps {
    getImage: (imageId: string) => Promise<Record<string, unknown> | null>;
}
export declare function parseImageAspectRatio(value?: string): {
    label: string;
    width: number;
    height: number;
};
type ReferenceGenerationMode = 'reference_generate' | 'semantic_merge' | 'aspect_ratio_variant';
export declare function generatePhotariumImage(deps: ImageGenerationDeps, settings: ImageGenerationSettings): Promise<Record<string, unknown>>;
export declare function generatePhotariumImageFromReferences(deps: ImageGenerationDeps, settings: ImageGenerationSettings, references: ImageReferenceInput[], mode?: ReferenceGenerationMode): Promise<Record<string, unknown>>;
export declare function generatePhotariumAspectRatioVariant(deps: AspectRatioVariantDeps, settings: AspectRatioVariantSettings): Promise<Record<string, unknown>>;
export {};
