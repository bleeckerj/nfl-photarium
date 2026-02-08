import { getCachedImages, type CachedCloudflareImage } from '@/server/cloudflareImageCache';
import { generateClipTextEmbedding } from '@/server/embeddingService';
import { getImageVectors } from '@/server/vectorSearch';
import { getComfyWorkflowExtras } from '@/server/comfy/workflowExtras';
import { searchWorkflowIntentByEmbedding, type WorkflowIntentSearchResult } from '@/server/comfy/workflowIntentSearch';

const WORKFLOW_ANN_WEIGHT = 0.55;
const CLIP_RERANK_WEIGHT = 0.3;
const KEYWORD_OVERLAP_WEIGHT = 0.15;

export type WorkflowMatchReason = {
  annDistance: number;
  annSimilarity: number;
  clipSimilarity: number;
  keywordOverlap: number;
  matchedTerms: string[];
  weightedScore: number;
};

export type WorkflowSearchResultEntry = {
  imageId: string;
  representativeImage: {
    id: string;
    filename: string;
    folder?: string;
    uploaded: string;
    description?: string;
    altTag?: string;
  };
  workflowIntentText: string;
  promptCandidates: string[];
  nodeTypeSignatures: string[];
  nodeSettingSignatures: string[];
  workflowJson?: unknown;
  reason: WorkflowMatchReason;
};

export type SearchComfyWorkflowsParams = {
  query: string;
  limit?: number;
  offset?: number;
  includeWorkflowJson?: boolean;
};

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || !right.length || left.length !== right.length) return 0;

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function tokenizeQueryText(input: string): string[] {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3)
    )
  );
}

function normalizeDistanceToSimilarity(distance: number): number {
  // Redis cosine distance range is usually [0, 2].
  const normalized = 1 - distance / 2;
  return Math.max(0, Math.min(1, normalized));
}

function isComfyImage(image: CachedCloudflareImage): boolean {
  return image.generatedBy === 'comfyui' || image.comfyMetadataDetected === true;
}

function buildKeywordOverlapScore(params: {
  queryTokens: string[];
  candidate: WorkflowIntentSearchResult;
  promptCandidates: string[];
  nodeTypeSignatures: string[];
  nodeSettingSignatures: string[];
  workflowIntentText: string;
}): { matchedTerms: string[]; overlap: number } {
  if (params.queryTokens.length === 0) {
    return { matchedTerms: [], overlap: 0 };
  }

  const corpus = [
    params.workflowIntentText,
    ...params.promptCandidates,
    ...params.nodeTypeSignatures,
    ...params.nodeSettingSignatures,
    ...(params.candidate.promptCandidates ?? []),
    ...(params.candidate.nodeTypeSignatures ?? []),
    ...(params.candidate.nodeSettingSignatures ?? []),
  ]
    .join(' ')
    .toLowerCase();

  const matchedTerms = params.queryTokens.filter((token) => corpus.includes(token));
  return {
    matchedTerms,
    overlap: matchedTerms.length / params.queryTokens.length,
  };
}

export async function searchComfyWorkflowsByIntent(
  params: SearchComfyWorkflowsParams
): Promise<WorkflowSearchResultEntry[]> {
  const query = params.query.trim();
  if (!query) return [];

  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const offset = Math.max(0, params.offset ?? 0);
  const includeWorkflowJson = params.includeWorkflowJson !== false;

  const queryEmbedding = await generateClipTextEmbedding(query);
  if (!queryEmbedding) {
    throw new Error('Failed to generate query embedding for workflow search');
  }

  const allImages = await getCachedImages();
  const comfyImageMap = new Map(
    allImages.filter(isComfyImage).map((image) => [image.id, image])
  );

  if (comfyImageMap.size === 0) {
    return [];
  }

  const annLimit = Math.min(250, Math.max(limit * 8, 32));
  const annResults = await searchWorkflowIntentByEmbedding({
    embedding: queryEmbedding,
    limit: annLimit,
    offset: 0,
  });

  const filteredAnn = annResults.filter((candidate) => comfyImageMap.has(candidate.imageId));
  if (filteredAnn.length === 0) {
    return [];
  }

  const queryTokens = tokenizeQueryText(query);

  const rerankedEntries = await Promise.all(
    filteredAnn.map(async (candidate) => {
      const image = comfyImageMap.get(candidate.imageId);
      if (!image) return null;

      const [extras, vectors] = await Promise.all([
        getComfyWorkflowExtras(candidate.imageId),
        getImageVectors(candidate.imageId),
      ]);

      const workflowIntentText = extras?.workflowIntentText ?? candidate.workflowIntentText ?? '';
      const promptCandidates = extras?.promptCandidates ?? candidate.promptCandidates ?? [];
      const nodeTypeSignatures = extras?.nodeTypeSignatures ?? candidate.nodeTypeSignatures ?? [];
      const nodeSettingSignatures = extras?.nodeSettingSignatures ?? candidate.nodeSettingSignatures ?? [];

      const annSimilarity = normalizeDistanceToSimilarity(candidate.score);
      const clipSimilarity =
        vectors?.clipEmbedding && vectors.clipEmbedding.length === queryEmbedding.length
          ? Math.max(0, cosineSimilarity(queryEmbedding, vectors.clipEmbedding))
          : 0;

      const keywordOverlap = buildKeywordOverlapScore({
        queryTokens,
        candidate,
        promptCandidates,
        nodeTypeSignatures,
        nodeSettingSignatures,
        workflowIntentText,
      });

      const weightedScore =
        annSimilarity * WORKFLOW_ANN_WEIGHT +
        clipSimilarity * CLIP_RERANK_WEIGHT +
        keywordOverlap.overlap * KEYWORD_OVERLAP_WEIGHT;

      const reason: WorkflowMatchReason = {
        annDistance: candidate.score,
        annSimilarity,
        clipSimilarity,
        keywordOverlap: keywordOverlap.overlap,
        matchedTerms: keywordOverlap.matchedTerms,
        weightedScore,
      };

      return {
        imageId: image.id,
        representativeImage: {
          id: image.id,
          filename: image.filename,
          folder: image.folder,
          uploaded: image.uploaded,
          description: image.description,
          altTag: image.altTag,
        },
        workflowIntentText,
        promptCandidates,
        nodeTypeSignatures,
        nodeSettingSignatures,
        workflowJson: includeWorkflowJson ? extras?.workflowJson : undefined,
        reason,
      } as WorkflowSearchResultEntry;
    })
  );

  return rerankedEntries
    .filter((entry): entry is WorkflowSearchResultEntry => Boolean(entry))
    .sort((left, right) => {
      if (right.reason.weightedScore !== left.reason.weightedScore) {
        return right.reason.weightedScore - left.reason.weightedScore;
      }
      return left.reason.annDistance - right.reason.annDistance;
    })
    .slice(offset, offset + limit);
}
