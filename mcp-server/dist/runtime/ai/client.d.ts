import type { ConceptScore } from '../types.js';
export declare function generateAlt(imageId: string): Promise<{
    altTag: string;
}>;
export declare function generateDescription(imageId: string, options?: {
    existingDescription?: string;
}): Promise<{
    description: string;
}>;
export declare function generateTags(imageId: string, options?: {
    count?: number;
}): Promise<{
    tags: string[];
    model?: string;
}>;
export declare function generatePrompt(imageId: string, options?: {
    force?: boolean;
    existingPrompt?: string;
}): Promise<{
    prompt?: string;
    record?: unknown;
    generated?: boolean;
    saved?: boolean;
}>;
export declare function getConcepts(imageId: string): Promise<{
    concepts: ConceptScore[];
}>;
export declare function getPromptsBulk(imageIds: string[]): Promise<Record<string, string | null>>;
export declare function getPromptRecord(imageId: string): Promise<{
    imageId: string;
    record: unknown | null;
}>;
export declare function getHaiku(imageId: string): Promise<{
    imageId: string;
    haiku: string;
    lines: string[];
}>;
