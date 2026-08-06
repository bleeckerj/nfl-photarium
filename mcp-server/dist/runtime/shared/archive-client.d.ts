export interface ArchivePreviewResponse {
    data: string;
    mimeType: string;
}
export declare function archiveJson<T>(endpoint: string, options?: RequestInit): Promise<T>;
export declare function archivePreview(assetId: string): Promise<ArchivePreviewResponse>;
