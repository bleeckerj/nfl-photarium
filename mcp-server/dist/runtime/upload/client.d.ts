export declare function suggestSemanticDisplayNameFromUrl(url: string, hints?: {
    filename?: string;
    folder?: string;
    tags?: string[];
}): Promise<string | undefined>;
export declare function uploadFromUrl(url: string, options?: {
    displayName?: string;
    folder?: string;
    tags?: string[];
    namespace?: string;
    description?: string;
    originalUrl?: string;
    sourceUrl?: string;
    parentId?: string;
    prompt?: string;
}): Promise<{
    success: boolean;
    imageId?: string;
    error?: string;
    promptSave?: Record<string, unknown>;
}>;
export declare function listUploads(options?: {
    page?: number;
    pageSize?: number;
    folder?: string;
}): Promise<{
    page: number;
    pageSize: number;
    hasMore: boolean;
    uploads: Array<{
        uploadId: string;
        cloudflareUrl: string;
        folder?: string;
        filename?: string;
        originalUrl?: string;
        bytes?: number;
        contentHash?: string;
        createdAt?: string;
    }>;
}>;
export declare function downloadUpload(uploadId: string): Promise<{
    filename?: string;
    contentType?: string;
    size?: number;
    base64: string;
}>;
export declare function importFromUrl(url: string): Promise<{
    name: string;
    type: string;
    size: number;
    data: string;
    originalUrl: string;
    captureDate?: string;
    snagxMetadata?: Record<string, unknown>;
    snagxDescription?: string;
}>;
export declare function uploadFileBase64(endpoint: '/api/upload' | '/api/upload/external', payload: {
    base64: string;
    filename: string;
    contentType?: string;
    folder?: string;
    tags?: string[];
    description?: string;
    originalUrl?: string;
    sourceUrl?: string;
    sourcePath?: string;
    namespace?: string;
    parentId?: string;
    prompt?: string;
}): Promise<Record<string, unknown>>;
export declare function createAnimation(options: {
    frames: Array<{
        kind: 'url';
        url: string;
    } | {
        kind: 'base64';
        data: string;
        filename: string;
        contentType?: string;
    }>;
    fps?: number;
    loop?: boolean;
    folder?: string;
    tags?: string[];
    description?: string;
    originalUrl?: string;
    sourceUrl?: string;
    namespace?: string;
    parentId?: string;
    filename?: string;
}): Promise<Record<string, unknown>>;
