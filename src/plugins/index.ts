import { PackagePluginRegistry } from './types';
import { snagxPlugin } from './snagxPlugin';
import { zipPlugin } from './zipPlugin';

/**
 * Initialize the plugin registry with all built-in plugins
 */
export function initializePlugins(): PackagePluginRegistry {
  const registry = new PackagePluginRegistry();

  // Register built-in plugins
  registry.register(snagxPlugin);
  registry.register(zipPlugin);

  return registry;
}

// Export for use throughout the application
export const pluginRegistry = initializePlugins();

// Re-export types for convenience
export type { PackagePlugin, PackagePluginInput, PackagePluginOutput, ExtractedAsset } from './types';
export { PackagePluginRegistry } from './types';
