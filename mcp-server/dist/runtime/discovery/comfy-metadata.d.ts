export declare function extractComfyMetadata(buffer: Buffer, contentType?: string, filename?: string): {
    found: boolean;
    workflow: unknown | null;
    prompt: unknown | null;
    rawMetadata: Record<string, string>;
    message?: string;
    format: string;
};
