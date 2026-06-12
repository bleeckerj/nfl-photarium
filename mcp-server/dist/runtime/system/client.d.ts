export declare function getVectorStatus(): Promise<{
    available: boolean;
    stats?: {
        totalImages: number;
        withClipEmbedding: number;
        withColorEmbedding: number;
        clipProgress: string;
        colorProgress: string;
    };
    needsEmbedding?: number;
}>;
export declare function generateEmbeddings(imageId: string, options?: {
    clip?: boolean;
    color?: boolean;
    force?: boolean;
}): Promise<{
    imageId: string;
    hasClipEmbedding: boolean;
    hasColorEmbedding: boolean;
    clipGenerated?: boolean;
    colorGenerated?: boolean;
    skipped?: boolean;
}>;
export declare function getEmbeddingStatus(imageId: string): Promise<{
    imageId: string;
    hasClipEmbedding: boolean;
    hasColorEmbedding: boolean;
    dominantColors?: string[];
    averageColor?: string;
}>;
export declare function batchGenerateEmbeddings(options: {
    imageIds: string[];
    clip?: boolean;
    color?: boolean;
    force?: boolean;
}): Promise<{
    total: number;
    success: number;
    skipped: number;
    errors: number;
    results: Array<{
        imageId: string;
        success: boolean;
        clipGenerated?: boolean;
        colorGenerated?: boolean;
        skipped?: boolean;
        error?: string;
    }>;
}>;
export declare function ensureVectorIndex(): Promise<{
    success: boolean;
    message?: string;
}>;
export declare function getColorsBulk(imageIds: string[]): Promise<Record<string, {
    dominantColors?: string[];
    averageColor?: string;
    hasClipEmbedding: boolean;
    hasColorEmbedding: boolean;
}>>;
export declare function auditImages(options?: {
    refresh?: boolean;
    limit?: number;
    offset?: number;
    concurrency?: number;
    variant?: string;
    verbose?: boolean;
}): Promise<Record<string, unknown>>;
export declare function getDebugRaw(): Promise<Record<string, unknown>>;
