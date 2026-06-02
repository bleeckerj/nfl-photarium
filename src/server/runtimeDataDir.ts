import path from 'node:path';

export const getPhotariumRuntimeDataDir = (): string =>
  process.env.PHOTARIUM_RUNTIME_DATA_DIR ??
  path.join(process.cwd(), 'data');
