import { generateAlt, generateDescription } from './client.js';
export type CreativeBriefMetadataEnrichment = {
    status: 'completed' | 'partial' | 'failed';
    imageId?: string;
    descriptionSaved: boolean;
    altTextSaved: boolean;
    description?: string;
    altText?: string;
    errors?: Array<{
        field: 'description' | 'altText';
        message: string;
    }>;
    reason?: string;
};
type EnrichmentDependencies = {
    generateDescription: typeof generateDescription;
    generateAlt: typeof generateAlt;
};
export declare function enrichCreativeBriefImage(imageId: string | undefined, dependencies?: EnrichmentDependencies): Promise<CreativeBriefMetadataEnrichment>;
export {};
