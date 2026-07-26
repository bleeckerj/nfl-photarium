import { generateAlt, generateDescription } from './client.js';

export type CreativeBriefMetadataEnrichment = {
  status: 'completed' | 'partial' | 'skipped';
  imageId?: string;
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
      status: 'skipped',
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
  };

  if (descriptionResult.status === 'fulfilled') {
    result.description = descriptionResult.value.description;
  } else {
    errors.push({ field: 'description', message: errorMessage(descriptionResult.reason) });
  }

  if (altResult.status === 'fulfilled') {
    result.altText = altResult.value.altTag;
  } else {
    errors.push({ field: 'altText', message: errorMessage(altResult.reason) });
  }

  if (errors.length > 0) {
    result.status = 'partial';
    result.errors = errors;
  }

  return result;
}
