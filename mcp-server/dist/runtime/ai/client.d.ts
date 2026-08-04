import type { ConceptScore } from '../types.js';
export declare const SOURCE_RELATIONSHIPS: readonly ["brief_led", "faithful_adaptation", "related_design", "inspired_concept"];
export type SourceRelationship = (typeof SOURCE_RELATIONSHIPS)[number];
export declare const GENERATION_PROVIDERS: readonly ["codex_imagegen", "comfyui", "photarium_openai"];
export type GenerationProvider = (typeof GENERATION_PROVIDERS)[number];
export type CreativeBriefReference = {
    imageId: string;
    role: 'subject_reference' | 'brand_reference' | 'logo_reference';
};
export type CreativeBriefGenerationPlan = {
    derivationId: string;
    sourceImageId: string;
    creativeBrief: string;
    prompt: string;
    sourceRelationship: SourceRelationship;
    aspectRatio?: string;
    provider?: GenerationProvider;
    references: CreativeBriefReference[];
};
export type PromptDerivationRecord = CreativeBriefGenerationPlan & {
    generatedImageId?: string;
    externalJobId?: string;
    actualDimensions?: {
        width: number;
        height: number;
    };
    actualAspectRatio?: string;
    metadataEnrichment?: {
        status: 'completed' | 'partial' | 'failed';
        descriptionSaved: boolean;
        altTextSaved: boolean;
    };
    createdAt: string;
    updatedAt: string;
};
export declare function aspectRatioToSize(aspectRatio?: string): string | undefined;
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
    creativeBrief?: string;
    sourceRelationship?: SourceRelationship;
    aspectRatio?: string;
    saveAsCurrent?: boolean;
}): Promise<{
    prompt?: string;
    record?: unknown;
    derivation?: PromptDerivationRecord;
    plan?: CreativeBriefGenerationPlan;
    generated?: boolean;
    saved?: boolean;
}>;
export declare function getPromptDerivations(imageId: string): Promise<{
    imageId: string;
    derivations: PromptDerivationRecord[];
}>;
export declare function recordPromptDerivationResult(imageId: string, payload: {
    derivationId: string;
    provider: GenerationProvider;
    generatedImageId?: string;
    externalJobId?: string;
    actualDimensions?: {
        width: number;
        height: number;
    };
    actualAspectRatio?: string;
    metadataEnrichment?: PromptDerivationRecord['metadataEnrichment'];
}): Promise<{
    imageId: string;
    derivation: PromptDerivationRecord;
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
