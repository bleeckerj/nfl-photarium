# Package Plugin Architecture

Photarium uses a **plugin architecture** to handle different file formats (archives, container formats, etc.) during upload. This allows you to extend the system to support new file types without modifying core upload logic.

## Built-in Plugins

### Snagx Plugin
- **File Type:** `.snagx` (Snagit screenshot archives)
- **MIME Type:** `application/zip`
- **Extracts:** PNG images + metadata (capture date, descriptions)
- **Auto-Tags:** `snagx`

### ZIP Plugin
- **File Type:** `.zip`
- **MIME Type:** `application/zip`
- **Extracts:** All image files from the archive
- **Supported Formats:** JPEG, PNG, GIF, WebP, SVG
- **Auto-Tags:** `zip`

## Creating a Custom Plugin

### 1. Implement the `PackagePlugin` Interface

Create a new file in `src/plugins/`, e.g., `src/plugins/psdPlugin.ts`:

```typescript
import { PackagePlugin, PackagePluginInput, PackagePluginOutput } from './types';
import PSD from 'psd'; // hypothetical library

export const psdPlugin: PackagePlugin = {
  name: 'Adobe Photoshop Plugin',
  extensions: ['.psd'],
  mimeTypes: ['image/vnd.adobe.photoshop'],

  canHandle(filename: string, mimeType: string): boolean {
    return filename.toLowerCase().endsWith('.psd');
  },

  async extract(input: PackagePluginInput): Promise<PackagePluginOutput> {
    // Parse the PSD file
    const psd = PSD.parse(input.buffer);

    // Extract layers as PNG images
    const assets = psd.document.children.map((layer, index) => {
      const buffer = layer.toPng(); // hypothetical method
      return {
        buffer,
        filename: `${layer.name || `layer-${index}`}.png`,
        metadata: {
          description: layer.name,
          tags: ['psd', 'photoshop'],
        },
      };
    });

    return {
      assets,
      tagOverride: 'psd',
      folder: 'photoshop-exports',
    };
  },
};
```

### 2. Register the Plugin

Update `src/plugins/index.ts`:

```typescript
import { psdPlugin } from './psdPlugin';

export function initializePlugins(): PackagePluginRegistry {
  const registry = new PackagePluginRegistry();

  // Built-in plugins
  registry.register(snagxPlugin);
  registry.register(zipPlugin);

  // Custom plugins
  registry.register(psdPlugin);

  return registry;
}
```

### 3. Install Dependencies (if needed)

```bash
npm install psd  # or whatever library you're using
```

That's it! The upload system will automatically detect and use your plugin.

---

## Plugin Interface Reference

### `PackagePlugin`

```typescript
interface PackagePlugin {
  name: string;                                    // Human-readable plugin name
  extensions: string[];                           // File extensions: ['.psd', '.psb']
  mimeTypes: string[];                            // MIME types it handles
  
  canHandle(filename: string, mimeType: string): boolean;
  extract(input: PackagePluginInput): Promise<PackagePluginOutput>;
}
```

### `PackagePluginInput`

```typescript
interface PackagePluginInput {
  buffer: Buffer;          // The raw file bytes
  filename: string;        // Original filename
  mimeType: string;        // Detected MIME type
}
```

### `PackagePluginOutput`

```typescript
interface PackagePluginOutput {
  assets: ExtractedAsset[];        // Extracted images
  tagOverride?: string;            // Auto-apply tag (e.g., 'psd', 'snagx')
  folder?: string;                 // Auto-assign folder
}
```

### `ExtractedAsset`

```typescript
interface ExtractedAsset {
  buffer: Buffer;                  // Image data (PNG, JPEG, etc.)
  filename: string;                // Extracted filename
  metadata?: {
    captureDate?: string;          // Timestamp (ISO 8601)
    description?: string;          // Image description
    tags?: string[];               // Auto-tags
    [key: string]: unknown;        // Custom metadata
  };
}
```

---

## Plugin Resolution Order

When a file is uploaded:

1. **Check file extension** (e.g., `.snagx`, `.zip`, `.psd`)
2. **Check MIME type** (e.g., `application/zip`)
3. **Find matching plugin** (first plugin with matching extension/MIME wins)
4. **Extract assets** using the plugin's `extract()` method
5. **Upload each asset** individually to Cloudflare Images

---

## Best Practices

1. **Error Handling** — Always throw descriptive errors if extraction fails:
   ```typescript
   if (!isValid) {
     throw new Error('Invalid PSD header. File may be corrupted.');
   }
   ```

2. **Performance** — For large files, consider streaming or async processing:
   ```typescript
   async extract(input: PackagePluginInput): Promise<PackagePluginOutput> {
     // Async processing for large files
     const assets = await Promise.all(
       files.map(async (file) => extractLayer(file))
     );
     return { assets };
   }
   ```

3. **Memory** — Be mindful of memory when processing many assets:
   ```typescript
   // Good: Process in batches
   for (const batch of chunks(files, 10)) {
     yield* batch.map(extract);
   }
   ```

4. **Metadata** — Preserve useful metadata from the archive:
   ```typescript
   metadata: {
     captureDate: psd.header.timestamp,
     description: layer.metadata.description,
     tags: ['psd', ...customTags],
   }
   ```

---

## Testing Your Plugin

Create a test file in `__tests__/plugins/`:

```typescript
import { psdPlugin } from '@/plugins/psdPlugin';
import { readFileSync } from 'fs';

describe('PSD Plugin', () => {
  it('should extract layers from a PSD file', async () => {
    const buffer = readFileSync('./test-fixtures/sample.psd');
    const result = await psdPlugin.extract({
      buffer,
      filename: 'sample.psd',
      mimeType: 'image/vnd.adobe.photoshop',
    });

    expect(result.assets.length).toBeGreaterThan(0);
    expect(result.tagOverride).toBe('psd');
  });
});
```

---

## FAQ

**Q: Can I handle multiple file types in one plugin?**  
A: Yes! Add them to `extensions` and `mimeTypes`, and handle them in the `canHandle()` method:
```typescript
extensions: ['.psd', '.psb'],
canHandle(filename: string) {
  return filename.toLowerCase().match(/\.(psd|psb)$/i);
}
```

**Q: What if extraction fails for one asset?**  
A: The upload will fail for that specific file. Consider logging and continuing with partial results, or throw an error to halt the entire upload.

**Q: Can plugins modify tags on the parent upload?**  
A: Not directly, but you can set `tagOverride` to automatically tag extracted assets. Tags are merged with user-provided tags.

**Q: How do plugins interact with namespaces?**  
A: Plugins don't need to worry about namespaces—those are handled at the upload level. Just focus on extracting assets.
