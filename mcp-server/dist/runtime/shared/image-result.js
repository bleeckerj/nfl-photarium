import { BASE_URL } from './config.js';
export function formatImageResult(img) {
    const canonicalId = String(img.id
        || img.imageId
        || img.canonicalImageId
        || '').trim();
    // Handle both array and object variants
    let publicUrl = '';
    if (Array.isArray(img.variants)) {
        publicUrl = img.variants.find((v) => v.includes('/public')) || img.variants[0] || '';
    }
    else if (img.variants && typeof img.variants === 'object') {
        publicUrl = img.variants.public || Object.values(img.variants)[0] || '';
    }
    return {
        id: canonicalId,
        imageId: canonicalId || undefined,
        canonicalImageId: canonicalId || undefined,
        requestedImageId: img.requestedImageId,
        filename: img.filename,
        url: publicUrl || img.url,
        variants: img.variants,
        folder: img.folder || img.meta?.folder,
        tags: img.tags || img.meta?.tags,
        description: img.description || img.meta?.description,
        altTag: img.altTag || img.meta?.altTag,
        namespace: img.namespace,
        parentId: img.parentId,
        originalUrl: img.originalUrl,
        sourceUrl: img.sourceUrl,
        hasClipEmbedding: img.hasClipEmbedding,
        hasColorEmbedding: img.hasColorEmbedding,
        dominantColors: img.dominantColors,
        averageColor: img.averageColor,
        aspectRatio: img.aspectRatio,
        dimensions: img.dimensions,
        score: img.score,
    };
}
export function buildShareUrl(imageId, variant) {
    const params = new URLSearchParams();
    if (variant)
        params.set('variant', variant);
    return `${BASE_URL}/api/images/${imageId}/share${params.toString() ? `?${params}` : ''}`;
}
