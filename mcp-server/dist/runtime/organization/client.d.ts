import type { ImageResult } from '../types.js';
export declare function listFolders(namespace?: string): Promise<string[]>;
export declare function createFolder(name: string): Promise<{
    success: boolean;
    name: string;
}>;
export declare function listNamespaces(): Promise<string[]>;
export declare function updateMetadata(imageId: string, updates: {
    folder?: string;
    tags?: string[];
    description?: string | null;
    displayName?: string | null;
    altTag?: string;
    originalUrl?: string | null;
    sourceUrl?: string | null;
    namespace?: string;
    parentId?: string;
    variationSort?: number;
    clearExif?: boolean;
}): Promise<ImageResult>;
export declare function deleteImage(imageId: string): Promise<{
    success: boolean;
}>;
export declare function getExtras(imageId: string): Promise<{
    imageId: string;
    record: {
        description?: string;
        altText?: string;
    } | null;
}>;
export declare function updateExtras(imageId: string, updates: {
    description?: string | null;
    altText?: string | null;
}): Promise<{
    imageId: string;
    record: {
        description?: string;
        altText?: string;
    } | null;
}>;
export declare function rotateImage(imageId: string, options?: {
    direction?: 'left' | 'right';
    degrees?: number;
    auto?: boolean;
}): Promise<{
    id: string;
    url: string;
    variants: string[];
    rotatedFromId: string;
    message?: string;
}>;
export declare function swapImageParent(imageId: string, options: {
    newParentId: string;
    concurrency?: number;
    dryRun?: boolean;
}): Promise<Record<string, unknown>>;
export declare function deleteImageFamily(imageId: string, options?: {
    confirm?: string;
    dryRun?: boolean;
    concurrency?: number;
    async?: boolean;
}): Promise<Record<string, unknown>>;
export declare function getDeleteFamilyJob(jobId: string): Promise<Record<string, unknown>>;
