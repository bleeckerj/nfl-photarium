export type ProvenanceSummary = {
  receiptId: string;
  provider: string;
  model: string;
  createdAt: string;
  requestedQuality?: string;
  requestedSize?: string;
  returnedQuality?: string;
  returnedSize?: string;
  requestId?: string;
  outputIndex: number;
  generatedSha256: string;
  persistedSha256: string;
  verification: 'original-matched' | 'upload-source-matched';
  sourceImageIds: string[];
};

export type ProvenanceBinding = ProvenanceSummary & {
  imageId: string;
  attachedAt: string;
};

export type ProvenanceSave = {
  requested: true;
  saved: boolean;
  imageId: string;
  receiptId?: string;
  verified?: boolean;
  error?: string;
};
