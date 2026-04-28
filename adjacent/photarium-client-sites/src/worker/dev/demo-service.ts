import { ProjectAssetRepository } from '../assets/repository';
import { ProjectAssetService } from '../assets/service';
import { ProjectRepository } from '../projects/repository';
import { ProjectService } from '../projects/service';
import type {
  DownloadPresetPolicy,
  PublishedProjectAsset,
  PublishedProjectManifest,
  VisibleTagPolicy,
} from '../publishing-contract/types';

const localDemoAccessPolicy = {
  mode: 'secret-link' as const,
  sessionTtlSeconds: 60 * 60 * 24 * 14,
};

const localDemoVisibleTagPolicy: VisibleTagPolicy = {
  mode: 'prefix-filter',
  hiddenPrefixes: ['x-', 'internal:'],
  hiddenExact: ['x-search', 'x-clip', 'x-color'],
};

const localDemoDeliveryPolicy: DownloadPresetPolicy = {
  viewPresets: [
    { name: 'grid', label: 'Grid', sourceVariant: 'public' },
    { name: 'lightbox', label: 'Lightbox', sourceVariant: 'public' },
  ],
  downloadPresets: [
    { name: 'web', label: 'Web', width: 1600, fit: 'scale-down', quality: 82 },
    { name: 'review', label: 'Review', width: 2400, fit: 'scale-down', quality: 90 },
  ],
  allowedOutputFormats: ['jpg', 'webp', 'png'],
};

const demoAssetTemplates: Array<Omit<PublishedProjectAsset, 'projectAssetId'>> = [
  {
    assetType: 'image',
    sourceAssetId: 'b591b2dd-c298-4fd3-1b0e-295c0f0f1100',
    filename: 'headphones-kit.jpg',
    displayName: 'Headphones kit',
    description: 'Primary product frame with accessories and packaging.',
    visibleTags: ['dewalt', 'headphones', 'bluetooth'],
    sourceTags: ['dewalt', 'headphones', 'bluetooth', 'yellow', 'internal:seed'],
    uploadedAt: '2026-04-01T20:15:31.000Z',
    aspectRatio: '1:1',
    dimensions: { width: 720, height: 720 },
    isCanonical: true,
    hasEmbedding: true,
    clusterSeed: { id: 'cluster-product', label: 'Product' },
    previewVariant: 'public',
    sortOrder: 1,
  },
  {
    assetType: 'image',
    sourceAssetId: '771bc8dd-9012-4b51-34ae-5c1ac7676700',
    filename: 'headphones-profile.jpg',
    displayName: 'Headphones profile',
    description: 'Alternate product view for side-by-side comparison.',
    visibleTags: ['dewalt', 'headphones', 'bluetooth'],
    sourceTags: ['dewalt', 'headphones', 'bluetooth', 'yellow'],
    uploadedAt: '2026-04-01T20:16:31.000Z',
    isCanonical: false,
    hasEmbedding: true,
    clusterSeed: { id: 'cluster-product', label: 'Product' },
    previewVariant: 'public',
    sortOrder: 2,
  },
  {
    assetType: 'image',
    sourceAssetId: '216ab14e-da20-478e-385a-20bba4097400',
    filename: 'chip-feature.jpg',
    displayName: 'Chip feature art',
    description: 'Editorial-style frame with a tight macro composition.',
    visibleTags: ['editorial', 'chips', 'found'],
    sourceTags: ['editorial', 'chips', 'found'],
    uploadedAt: '2026-04-01T20:17:31.000Z',
    isCanonical: true,
    hasEmbedding: true,
    clusterSeed: { id: 'cluster-editorial', label: 'Editorial' },
    previewVariant: 'public',
    sortOrder: 3,
  },
  {
    assetType: 'image',
    sourceAssetId: '83e75e69-e170-4757-a5c2-bb99fa90f800',
    filename: 'snow-crash-cover.jpg',
    displayName: 'Snow Crash cover',
    description: 'Book cover example for a print-oriented visual cluster.',
    visibleTags: ['book', 'cover', 'neal stephenson'],
    sourceTags: ['book', 'cover', 'snow crash', 'neal stephenson'],
    uploadedAt: '2026-04-01T20:18:31.000Z',
    isCanonical: true,
    hasEmbedding: true,
    clusterSeed: { id: 'cluster-print', label: 'Print' },
    previewVariant: 'public',
    sortOrder: 4,
  },
  {
    assetType: 'image',
    sourceAssetId: '1b422df6-b7f1-4716-aae8-37d3f698f200',
    filename: 'archive-fragment.webp',
    displayName: 'Archive fragment',
    description: 'Loose found image for testing mixed-source selections.',
    visibleTags: ['found'],
    sourceTags: ['found', 'x-search'],
    uploadedAt: '2026-04-01T20:19:31.000Z',
    isCanonical: true,
    hasEmbedding: true,
    clusterSeed: { id: 'cluster-found', label: 'Found' },
    previewVariant: 'public',
    sortOrder: 5,
  },
  {
    assetType: 'image',
    sourceAssetId: '95b00065-e63e-4441-3390-1251e7310600',
    filename: 'telegram-scan.jpg',
    displayName: 'Telegram scan',
    description: 'Light neutral frame for shortlist and download checks.',
    visibleTags: ['telegram'],
    sourceTags: ['telegram'],
    uploadedAt: '2026-04-01T20:20:31.000Z',
    isCanonical: true,
    hasEmbedding: true,
    clusterSeed: { id: 'cluster-notes', label: 'Notes' },
    previewVariant: 'public',
    sortOrder: 6,
  },
  {
    assetType: 'video',
    sourceAssetId: 'video-demo-1',
    filename: 'studio-reel.mp4',
    displayName: 'Studio reel',
    description: 'Short campaign motion cut for video playback checks.',
    visibleTags: ['motion', 'studio'],
    sourceTags: ['motion', 'studio'],
    uploadedAt: '2026-04-01T20:21:31.000Z',
    aspectRatio: '16:9',
    dimensions: { width: 1920, height: 1080 },
    isCanonical: true,
    hasEmbedding: false,
    clusterSeed: { id: 'cluster-motion', label: 'Motion' },
    videoPlaybackUrl: 'https://videodelivery.net/demo-video/watch',
    videoHlsUrl: 'https://videodelivery.net/demo-video/manifest/video.m3u8',
    videoThumbnailUrl: 'https://videodelivery.net/demo-video/thumbnails/thumbnail.jpg',
    videoPreviewUrl: 'https://videodelivery.net/demo-video/thumbnails/thumbnail.jpg',
    videoDownloadUrl: 'https://videodelivery.net/demo-video/downloads/default.mp4',
    videoDurationSeconds: 12,
    sortOrder: 7,
  },
];

const buildDemoManifest = (project: {
  id: string;
  publicSlug: string;
  title: string;
}): PublishedProjectManifest => {
  const revisionId = crypto.randomUUID();
  const generatedAt = new Date().toISOString();

  return {
    schemaVersion: '2026-04-01',
    project: {
      id: project.id,
      publicSlug: project.publicSlug,
      status: 'published',
      expiresAt: null,
      title: project.title,
      accessPolicy: localDemoAccessPolicy,
      visibleTagPolicy: localDemoVisibleTagPolicy,
      downloadPresetPolicy: localDemoDeliveryPolicy,
    },
    delivery: localDemoDeliveryPolicy,
    revision: {
      projectRevisionId: revisionId,
      generatedAt,
      sourceNamespaces: ['cf-default'],
    },
    assets: demoAssetTemplates.map((asset, index) => ({
      ...asset,
      projectAssetId: `${project.publicSlug}-${String(index + 1).padStart(3, '0')}`,
    })),
  };
};

export interface LocalDemoResult {
  ok: true;
  projectId: string;
  publicSlug: string;
  accessKey: string;
  projectUrl: string;
  assetCount: number;
  revisionId: string;
}

/**
 * Creates and publishes a ready-to-open local demo project.
 */
export class LocalDemoService {
  constructor(
    private readonly database: D1Database,
    private readonly accessHashSecret: string
  ) {}

  async create(origin: string): Promise<LocalDemoResult> {
    const projectRepository = new ProjectRepository(this.database);
    const projectService = new ProjectService(projectRepository, this.accessHashSecret);
    const assetService = new ProjectAssetService(new ProjectAssetRepository(this.database));

    const { project, accessKey } = await projectService.createProject({
      title: 'Local Demo Selection',
      accessPolicy: localDemoAccessPolicy,
      visibleTagPolicy: localDemoVisibleTagPolicy,
      downloadPresetPolicy: localDemoDeliveryPolicy,
    });

    const manifest = buildDemoManifest({
      id: project.id,
      publicSlug: project.publicSlug,
      title: project.title,
    });

    await projectRepository.storeRevision(manifest);
    await projectRepository.applyManifest(manifest);
    const storedAssets = await assetService.applyManifest(manifest);

    return {
      ok: true,
      projectId: project.id,
      publicSlug: project.publicSlug,
      accessKey,
      projectUrl: `${origin}/p/${project.publicSlug}?k=${accessKey}`,
      assetCount: storedAssets.length,
      revisionId: manifest.revision.projectRevisionId,
    };
  }
}
