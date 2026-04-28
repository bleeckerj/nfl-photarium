import { isOutputFormatAllowed, resolveDownloadPreset, resolveViewPreset } from './policy';
import type { ProjectAssetRecord } from '../assets/types';
import type { DownloadPresetPolicy, OutputFormat } from '../publishing-contract/types';

const imageContentTypes: Record<OutputFormat, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Worker-fronted image delivery without exposing source ids in public URLs.
 */
export class AssetDeliveryService {
  constructor(
    private readonly accountHash: string
  ) {}

  buildViewUrl(asset: ProjectAssetRecord, policy: DownloadPresetPolicy, presetName: string): string | null {
    if (asset.assetType === 'video') {
      return asset.videoThumbnailUrl || null;
    }
    const preset = resolveViewPreset(policy, presetName);
    if (!preset) return null;
    return `https://imagedelivery.net/${this.accountHash}/${asset.sourceAssetId}/${preset.sourceVariant}`;
  }

  async buildDownloadResponse(
    asset: ProjectAssetRecord,
    policy: DownloadPresetPolicy,
    presetName: string,
    format: string
  ): Promise<Response | null> {
    if (asset.assetType === 'video') {
      return null;
    }

    const preset = resolveDownloadPreset(policy, presetName);
    if (!preset || !isOutputFormatAllowed(policy, format)) return null;

    const sourceUrl = `https://imagedelivery.net/${this.accountHash}/${asset.sourceAssetId}/public`;
    const requestInit = {
      cf: {
        image: {
          width: preset.width,
          height: preset.height,
          fit: preset.fit ?? 'scale-down',
          quality: preset.quality,
          format,
          background: preset.background,
        },
      },
    } as unknown as RequestInit;

    const response = await fetch(sourceUrl, {
      ...requestInit,
    });

    if (!response.ok || !response.body) return null;

    const extension = format === 'jpg' ? 'jpg' : format;
    const fileBase = asset.filename.replace(/\.[^.]+$/, '');
    const headers = new Headers(response.headers);
    headers.set('Content-Type', imageContentTypes[format]);
    headers.set('Content-Disposition', `attachment; filename="${fileBase}-${preset.name}.${extension}"`);

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  }
}
