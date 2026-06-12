import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function resolveSavePath(savePath: string, fallbackFilename: string): Promise<string> {
  const resolved = path.isAbsolute(savePath) ? savePath : path.resolve(process.cwd(), savePath);
  const endsWithSeparator = savePath.endsWith(path.sep) || savePath.endsWith('/');
  const hasExtension = Boolean(path.extname(resolved));
  if (endsWithSeparator || !hasExtension) {
    return path.join(resolved, fallbackFilename);
  }
  try {
    const stats = await fs.stat(resolved);
    if (stats.isDirectory()) {
      return path.join(resolved, fallbackFilename);
    }
  } catch {
    // path doesn't exist; treat as file path
  }
  return resolved;
}

export async function saveBase64ToFile(base64: string, savePath: string, fallbackFilename: string): Promise<string> {
  const targetPath = await resolveSavePath(savePath, fallbackFilename);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, Buffer.from(base64, 'base64'));
  return targetPath;
}
