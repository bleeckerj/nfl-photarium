/**
 * Plugin Architecture for Package/Archive Handling
 *
 * This module defines the interface and registry for plugins that handle
 * different file types (e.g., .snagx, .zip, .psd archives) during upload.
 *
 * Plugins allow Photarium to extensibly support different container formats
 * without modifying core upload logic.
 */

export interface PackagePluginInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface ExtractedAsset {
  buffer: Buffer;
  filename: string;
  metadata?: {
    captureDate?: string;
    description?: string;
    tags?: string[];
    [key: string]: unknown;
  };
}

export interface PackagePluginOutput {
  assets: ExtractedAsset[];
  tagOverride?: string;
  folder?: string;
}

export interface PackagePlugin {
  /**
   * Human-readable name of the plugin
   * @example "Snagx Screenshot Plugin"
   */
  name: string;

  /**
   * Array of file extensions this plugin handles (lowercase, with dot)
   * @example [".snagx"]
   */
  extensions: string[];

  /**
   * Array of MIME types this plugin handles
   * @example ["application/zip"]
   */
  mimeTypes: string[];

  /**
   * Check if this plugin can handle the given file
   * @param filename - The original filename
   * @param mimeType - The detected MIME type
   * @returns true if this plugin can process the file
   */
  canHandle(filename: string, mimeType: string): boolean;

  /**
   * Extract assets from the package/archive
   * @param input - The file buffer and metadata
   * @returns Extracted assets and metadata
   * @throws Error if extraction fails
   */
  extract(input: PackagePluginInput): Promise<PackagePluginOutput>;
}

export class PackagePluginRegistry {
  private plugins: PackagePlugin[] = [];

  register(plugin: PackagePlugin): void {
    this.plugins.push(plugin);
  }

  /**
   * Find a plugin that can handle the given file
   */
  findPlugin(filename: string, mimeType: string): PackagePlugin | undefined {
    return this.plugins.find((p) => p.canHandle(filename, mimeType));
  }

  /**
   * Get all registered plugins
   */
  listPlugins(): PackagePlugin[] {
    return [...this.plugins];
  }
}
