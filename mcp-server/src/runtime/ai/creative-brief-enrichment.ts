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

const defaultDependencies: EnrichmentDependencies = {
  generateDescription,
  generateAlt,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Metadata generation failed';
}

export async function enrichCreativeBriefImage(
  imageId: string | undefined,
  dependencies: EnrichmentDependencies = defaultDependencies,
): Promise<CreativeBriefMetadataEnrichment> {
  if (!imageId) {
    return {
      status: 'failed',
      descriptionSaved: false,
      altTextSaved: false,
      reason: 'generatedImageId is required before metadata enrichment can run',
    };
  }

  const [descriptionResult, altResult] = await Promise.allSettled([
    dependencies.generateDescription(imageId),
    dependencies.generateAlt(imageId),
  ]);
  const errors: CreativeBriefMetadataEnrichment['errors'] = [];
  const result: CreativeBriefMetadataEnrichment = {
    status: 'completed',
    imageId,
    descriptionSaved: false,
    altTextSaved: false,
  };

  if (descriptionResult.status === 'fulfilled') {
    result.description = descriptionResult.value.description;
    result.descriptionSaved = true;
  } else {
    errors.push({ field: 'description', message: errorMessage(descriptionResult.reason) });
  }

  if (altResult.status === 'fulfilled') {
    result.altText = altResult.value.altTag;
    result.altTextSaved = true;
  } else {
    errors.push({ field: 'altText', message: errorMessage(altResult.reason) });
  }

  if (errors.length > 0) {
    result.status = errors.length === 2 ? 'failed' : 'partial';
    result.errors = errors;
  }

  return result;
}
