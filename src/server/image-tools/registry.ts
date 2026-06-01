import { grainradAdapter } from '@/server/image-tools/grainradAdapter';
import { ImageToolManifestError, mergeImageToolRequest, validateImageToolManifest } from '@/server/image-tools/manifest';
import type { ImageToolAdapter, ImageToolManifest, ImageToolRunInput } from '@/server/image-tools/types';

const adapters: ImageToolAdapter[] = [grainradAdapter];

class ImageToolRegistry {
  private readonly adapterMap = new Map<string, ImageToolAdapter>();

  constructor(sourceAdapters: ImageToolAdapter[]) {
    for (const adapter of sourceAdapters) {
      const manifest = validateImageToolManifest(adapter.manifest);
      if (this.adapterMap.has(manifest.id)) {
        throw new ImageToolManifestError(`Duplicate image tool id: ${manifest.id}`);
      }
      this.adapterMap.set(manifest.id, adapter);
    }
  }

  listManifests(): ImageToolManifest[] {
    return Array.from(this.adapterMap.values()).map((adapter) => adapter.manifest);
  }

  getAdapter(toolId: string): ImageToolAdapter | undefined {
    return this.adapterMap.get(toolId);
  }

  buildRequest(toolId: string, input: ImageToolRunInput['request']) {
    const adapter = this.getAdapter(toolId);
    if (!adapter) {
      throw new Error(`Unknown image tool: ${toolId}`);
    }
    return mergeImageToolRequest(adapter.manifest.defaultRequest, input);
  }
}

export const getImageToolRegistry = () => new ImageToolRegistry(adapters);

export { ImageToolManifestError, validateImageToolManifest };
