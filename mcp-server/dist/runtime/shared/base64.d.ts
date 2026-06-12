export declare function parseDataUrl(value: string): {
    mimeType?: string;
    data: string;
};
export declare function decodeBase64(value: string): {
    buffer: Buffer;
    mimeType?: string;
};
