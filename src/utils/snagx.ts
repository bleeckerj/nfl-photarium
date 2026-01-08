import AdmZip from 'adm-zip';
import path from 'path';

type SnagxExtraction = {
  buffer: Buffer;
  filename: string;
  captureDate?: string;
  metadata?: Record<string, unknown>;
};

const sanitizeFilenameBase = (value: string) => {
  const cleaned = value.replace(/[^a-zA-Z0-9-_]/g, '_').replace(/_+/g, '_');
  const trimmed = cleaned.replace(/^_+|_+$/g, '');
  return trimmed || 'snagx-image';
};

export function extractSnagx(buffer: Buffer, originalName?: string): SnagxExtraction {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const pngEntries = entries.filter((entry) =>
    entry.entryName.toLowerCase().endsWith('.png')
  );

  if (pngEntries.length === 0) {
    throw new Error('No PNG images found inside .snagx archive');
  }

  const sorted = [...pngEntries].sort(
    (a, b) => (b.header.size || 0) - (a.header.size || 0)
  );
  const mainEntry = sorted[0];
  const extractedBuffer = mainEntry.getData();

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
      // ignore metadata parsing failures
    }
  }

  const baseName = originalName
    ? path.basename(originalName, path.extname(originalName))
    : path.basename(mainEntry.entryName, '.png');
  const filename = `${sanitizeFilenameBase(baseName)}.png`;

  return {
    buffer: extractedBuffer,
    filename,
    captureDate,
    metadata
  };
}
