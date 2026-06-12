import type { ImageResult, SearchResult } from '../types.js';
export declare function semanticSearch(query: string, limit?: number, namespace?: string | null): Promise<SearchResult>;
export declare function textSearch(query: string, options?: {
    folder?: string;
    namespace?: string;
    limit?: number;
    refresh?: boolean;
}): Promise<SearchResult>;
export declare function searchByColor(hexColor: string, limit?: number, namespace?: string | null): Promise<SearchResult>;
export declare function findSimilar(imageId: string, type?: 'clip' | 'color', limit?: number, options?: {
    includeStrangers?: boolean;
    offset?: number;
    strangersLimit?: number;
    strangersOffset?: number;
    namespace?: string | null;
}): Promise<SearchResult>;
export declare function listImages(options: {
    folder?: string;
    namespace?: string;
    limit?: number;
    refresh?: boolean;
    aspectRatioClass?: string;
    aspectRatio?: string;
}): Promise<{
    images: ImageResult[];
    total: number;
}>;
export declare function getImage(imageId: string): Promise<Record<string, unknown> | null>;
export declare function getImageMetadata(imageId: string): Promise<Record<string, unknown> | null>;
export declare function findAntipode(imageId: string, options?: {
    domain?: 'clip' | 'color';
    method?: string;
    limit?: number;
    namespace?: string | null;
}): Promise<SearchResult>;
export declare function searchByImage(imageId: string, limit?: number, namespace?: string | null): Promise<SearchResult>;
export declare function downloadImageById(imageId: string, variant?: string): Promise<{
    filename?: string;
    contentType?: string;
    size?: number;
    base64: string;
    requestedVariant?: string;
    servedVariant?: string;
}>;
export declare function downloadOriginalImageById(imageId: string): Promise<{
    filename?: string;
    contentType?: string;
    size?: number;
    base64: string;
    variantUsed: string;
    fallbackUsed: boolean;
    fallbackReason?: string;
}>;
