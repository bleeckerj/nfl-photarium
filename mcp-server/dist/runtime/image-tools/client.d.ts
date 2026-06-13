type ImageToolRequestPatch = {
    effectId?: string;
    paramPreset?: string;
    params?: Record<string, unknown>;
    output?: {
        mode?: 'still' | 'animated';
        format?: string;
        preset?: string;
    };
    timeline?: {
        durationMs?: number;
        fps?: number;
        loop?: boolean;
    };
    renderContext?: {
        seed?: number;
        fps?: number;
        frameIndex?: number;
        time?: number;
    };
};
export type ImageToolRunParams = {
    toolId: string;
    imageId: string;
    request?: ImageToolRequestPatch;
};
export declare function listImageTools(): Promise<Record<string, unknown>>;
export declare function startImageToolRun(params: ImageToolRunParams): Promise<Record<string, unknown>>;
export declare function startImageToolPreview(params: ImageToolRunParams): Promise<Record<string, unknown>>;
export declare function getImageToolRun(runId: string): Promise<Record<string, unknown>>;
export declare function getImageToolPreview(previewId: string): Promise<Record<string, unknown>>;
export {};
