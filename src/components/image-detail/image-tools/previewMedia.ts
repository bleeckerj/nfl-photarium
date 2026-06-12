import type {
  ImageToolDiagnosticEvent,
  ImageToolManifest,
  ImageToolPreview,
} from '@/services/imageToolsService';

export type ImageToolPreviewMedia = {
  src: string;
  alt: string;
  objectFit: 'contain' | 'cover';
  badge: string;
  kind: 'image' | 'video';
};

type PreviewTool = Pick<ImageToolManifest, 'label' | 'presentation'>;

const cleanOptionalString = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const isVideoContentType = (contentType: string | undefined) =>
  Boolean(contentType?.toLowerCase().startsWith('video/'));

export const resolveImageToolPreviewMedia = (params: {
  tool: PreviewTool;
  preview?: Pick<ImageToolPreview, 'artifactUrl' | 'contentType'> | null;
  sourcePreviewUrl?: string;
  sourceLabel?: string;
}): ImageToolPreviewMedia => {
  const artifactUrl = cleanOptionalString(params.preview?.artifactUrl);
  if (artifactUrl) {
    return {
      src: artifactUrl,
      alt: `${params.tool.label} generated preview`,
      objectFit: 'contain',
      badge: 'Generated preview',
      kind: isVideoContentType(params.preview?.contentType) ? 'video' : 'image',
    };
  }

  const sourcePreviewUrl = cleanOptionalString(params.sourcePreviewUrl);
  if (sourcePreviewUrl) {
    return {
      src: sourcePreviewUrl,
      alt: params.sourceLabel ? `${params.sourceLabel} source image` : 'Selected source image',
      objectFit: 'contain',
      badge: 'Source image',
      kind: 'image',
    };
  }

  return {
    src: params.tool.presentation.previewUrl || params.tool.presentation.thumbnailUrl,
    alt: `${params.tool.label} sample preview`,
    objectFit: 'cover',
    badge: 'Tool sample',
    kind: 'image',
  };
};

export const hasDiagnosticError = (events: ImageToolDiagnosticEvent[]) =>
  events.some((event) => event.level === 'error');

export const formatDiagnosticDetails = (details?: ImageToolDiagnosticEvent['details']) => {
  if (!details) return '';
  return Object.entries(details)
    .map(([key, value]) => `${key}=${value ?? 'n/a'}`)
    .join(' ');
};
