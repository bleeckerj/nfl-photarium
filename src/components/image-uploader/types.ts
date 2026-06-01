export interface UploadedImage {
  id: string;
  assetType: 'image' | 'video';
  url: string;
  filename: string;
  status: 'uploading' | 'success' | 'error';
  embeddingStatus?: 'queued' | 'embedding' | 'success' | 'error';
  embeddingError?: string;
  embeddingRequested?: { clip: boolean; color: boolean };
  error?: string;
  folder?: string;
  tags?: string[];
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  file?: File;
  remoteUrl?: string;
  folderInput?: string;
  tagsInput?: string;
  descriptionInput?: string;
  originalUrlInput?: string;
  sourceUrlInput?: string;
  parentId?: string;
}

export interface GalleryImageSummary {
  id: string;
  folder?: string | null;
  filename?: string;
  parentId?: string | null;
}
