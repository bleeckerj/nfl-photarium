export type ComfyWorkflowRecord = {
  workflowJson: unknown;
  promptCandidates?: string[];
  imageDescription?: {
    altText?: string;
    description?: string;
    aiCaption?: string;
  };
  workflowIntentText?: string;
  nodeTypeSignatures?: string[];
  nodeSettingSignatures?: string[];
  intentTextVersion?: string;
  embeddingModel?: string;
  embeddingVersion?: string;
  updatedAt?: string;
};

export type ComfyDetectionSignals = {
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
};

export type ComfyWorkflowPanelProps = {
  imageId: string;
  comfyWorkflow: ComfyWorkflowRecord | null;
  detection?: ComfyDetectionSignals;
  onCopyText?: (text: string, successMessage?: string) => void;
};

export type ComfyPromptTexts = {
  primary: string | null;
  negative: string | null;
  others: string[];
  totalPromptLikeCount: number;
  rawExtractedCount: number;
  source: 'cliptextencode' | 'storedCandidates' | 'none';
};

export type ComfyParamMap = {
  checkpoint?: string;
  sampler?: string;
  scheduler?: string;
  steps?: number;
  cfg?: number;
  seed?: number;
  denoise?: number;
  width?: number;
  height?: number;
  modeFlags: string[];
};

export type ComfyWorkflowViewModel = {
  visible: boolean;
  detected: boolean;
  sourceLabel: string | null;
  promptTexts: ComfyPromptTexts;
  workflowIntentText: string | null;
  nodeTypes: string[];
  nodeSettings: string[];
  params: ComfyParamMap;
  updatedAtLabel: string | null;
  analysisMetaLabel: string | null;
  rawJsonPretty: string | null;
};
