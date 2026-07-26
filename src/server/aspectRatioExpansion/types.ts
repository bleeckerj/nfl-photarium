import type { CropVariantPlacement } from '@/server/cropVariantService';

export type AspectRatioExpansionProvider = 'auto' | 'openai' | 'comfyui';
export type ResolvedAspectRatioExpansionProvider = Exclude<AspectRatioExpansionProvider, 'auto'>;

export type AspectRatioExpansionRequest = {
  provider?: AspectRatioExpansionProvider;
  aspectRatio?: string;
  placement?: CropVariantPlacement;
  instructions?: string;
  negativePrompt?: string;
  seed?: number;
  filename?: string;
  description?: string;
  tags?: string[];
};

export type AspectRatioExpansionSource = {
  imageId: string;
  buffer: Buffer;
  filename: string;
};

export type AspectRatioExpansionResult = {
  buffer: Buffer;
  contentType: string;
  filename: string;
  provider: ResolvedAspectRatioExpansionProvider;
  model?: string;
  workflowId?: string;
  externalJobId?: string;
  dimensions: {
    width: number;
    height: number;
  };
  diagnostics?: Record<string, string | number | boolean | null>;
};

export type AspectRatioExpansionProviderStatus = {
  id: ResolvedAspectRatioExpansionProvider;
  label: string;
  available: boolean;
  reason?: string;
};

export type AspectRatioExpansionAdapter = {
  id: ResolvedAspectRatioExpansionProvider;
  label: string;
  getStatus: () => AspectRatioExpansionProviderStatus;
  generate: (params: {
    source: AspectRatioExpansionSource;
    request: Required<Pick<AspectRatioExpansionRequest, 'aspectRatio' | 'placement'>> & AspectRatioExpansionRequest;
    onProgress?: (message: string, percent?: number) => void;
  }) => Promise<AspectRatioExpansionResult>;
};
