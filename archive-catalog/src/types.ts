export interface CatalogRecord {
  id: string;
  imageId: number;
  fileId: number | null;
  filename: string;
  extension: string | null;
  fileFormat: string | null;
  captureTime: string | null;
  originalCaptureTime: string | null;
  rating: number | null;
  pick: number | null;
  colorLabels: string | null;
  width: number | null;
  height: number | null;
  copyName: string | null;
  missingSidecars: boolean;
  folderPath: string | null;
  rootName: string | null;
  rootPath: string | null;
  absolutePath: string | null;
  relativePath: string | null;
  caption: string | null;
  copyright: string | null;
  sourceMtime: number | null;
  sourceSize: number | null;
  sourceAvailable: boolean;
  keywords: string[];
  collections: string[];
  annotationNote: string | null;
  annotationTags: string[];
  shortlist: boolean;
}

export interface CatalogSummary {
  id: string;
  path: string;
  name: string;
  size: number;
  mtime: number;
  status: string;
  lastSyncedAt: string | null;
  assets: number;
  availableAssets: number;
}

export interface SearchFilters {
  query?: string;
  from?: string;
  to?: string;
  minRating?: number;
  pick?: number;
  catalogId?: string;
  path?: string;
  keyword?: string;
  collection?: string;
  limit?: number;
  offset?: number;
  expandQuery?: boolean;
}

export interface SearchResult extends CatalogRecord {
  matchType: 'exact' | 'expanded';
  matchedFields: string[];
  rank: number;
}
