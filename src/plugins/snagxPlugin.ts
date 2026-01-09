import { PackagePlugin, PackagePluginInput, PackagePluginOutput } from './types';
import AdmZip from 'adm-zip';

/**
 * Snagx Plugin
 * Handles .snagx files (Snagit screenshot archives)
 * Extracts PNG images and metadata from the zip archive
 */
export const snagxPlugin: PackagePlugin = {
  name: 'Snagx Screenshot Plugin',
  extensions: ['.snagx'],
  mimeTypes: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],

  canHandle(filename: string, _mimeType: string): boolean {
    return filename.toLowerCase().endsWith('.snagx');
  },

  async extract(input: PackagePluginInput): Promise<PackagePluginOutput> {
    const zip = new AdmZip(input.buffer);
    const entries = zip.getEntries();

    // Find all PNG entries
    const pngEntries = entries.filter((entry) =>
      entry.entryName.toLowerCase().endsWith('.png')
    );

    if (pngEntries.length === 0) {
      throw new Error('No PNG images found inside .snagx archive');
    }

    // Sort by size (largest first) to get the main screenshot
    const sorted = [...pngEntries].sort(
      (a, b) => (b.header.size || 0) - (a.header.size || 0)
    );

    // Extract metadata
    const metadataEntry = entries.find((entry) =>
      entry.entryName.toLowerCase().endsWith('metadata.json')
    );

    let captureDate: string | undefined;
    let metadata: Record<string, unknown> | undefined;

    if (metadataEntry) {
      try {
        const parsed = JSON.parse(metadataEntry.getData().toString('utf8'));
        if (parsed && typeof parsed === 'object') {
          metadata = parsed as Record<string, unknown>;
          if (typeof metadata.CaptureDate === 'string') {
            captureDate = metadata.CaptureDate;
          }
        }
      } catch {
        // Ignore metadata parsing failures
      }
    }

    // Extract all PNGs as assets
    const assets = sorted.map((entry, index) => ({
      buffer: entry.getData(),
      filename: index === 0 
        ? input.filename.replace(/\.snagx$/i, '.png')
        : input.filename.replace(/\.snagx$/i, `_${index}.png`),
      metadata: {
        captureDate,
        description: metadata?.snagxDescription ? String(metadata.snagxDescription) : undefined,
        tags: (metadata?.CaptureDate || metadata?.snagxDescription) ? ['snagx'] : undefined,
      },
    }));

    return {
      assets,
      tagOverride: 'snagx',
      folder: metadata?.folder ? String(metadata.folder) : undefined,
    };
  },
};
