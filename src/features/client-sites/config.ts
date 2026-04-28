import fs from 'node:fs/promises';
import path from 'node:path';

const parseEnvFile = (raw: string): Record<string, string> => {
  const values: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key) continue;

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
};

export const getClientSiteConfigPaths = (): string[] => [
  path.join(process.cwd(), '.env.local'),
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), 'adjacent', 'photarium-client-sites', '.dev.vars'),
];

export const loadClientSiteConfigFiles = async (): Promise<string[]> => {
  const loadedPaths: string[] = [];

  for (const filePath of getClientSiteConfigPaths()) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = parseEnvFile(raw);
      for (const [key, value] of Object.entries(parsed)) {
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
      loadedPaths.push(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return loadedPaths;
};
