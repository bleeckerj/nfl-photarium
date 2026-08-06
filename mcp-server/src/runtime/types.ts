export interface ImageResult {
  id: string;
  imageId?: string;
  canonicalImageId?: string;
  requestedImageId?: string;
  filename: string;
  url: string;
  variants?: string[] | Record<string, string>;
  folder?: string;
  tags?: string[];
  description?: string;
  altTag?: string;
  namespace?: string;
  parentId?: string;
  originalUrl?: string;
  sourceUrl?: string;
  hasClipEmbedding?: boolean;
  hasColorEmbedding?: boolean;
  dominantColors?: string[];
  averageColor?: string;
  aspectRatio?: string;
  dimensions?: { width: number; height: number };
  score?: number;
  meta?: {
    folder?: string;
    tags?: string[];
    displayName?: string;
    altTag?: string;
    description?: string;
  };
}

export interface SearchResult {
  results: ImageResult[];
  query: string;
  count: number;
  strangers?: ImageResult[];
  strangersCount?: number;
}

export interface ConceptScore {
  dimension: string;
  negative: string;
  positive: string;
  score: number;
}

export interface RuntimeToolResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >;
  isError?: boolean;
}

export type RuntimeToolHandler = (args: Record<string, unknown>) => Promise<RuntimeToolResult> | RuntimeToolResult;

export interface RuntimeToolModule {
  tools: import('@modelcontextprotocol/sdk/types.js').Tool[];
  handlers: Record<string, RuntimeToolHandler>;
}
