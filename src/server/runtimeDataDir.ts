import os from 'node:os';
import path from 'node:path';

export const getPhotariumRuntimeDataDir = (): string =>
  process.env.PHOTARIUM_RUNTIME_DATA_DIR ??
  (process.env.NODE_ENV === 'development'
    ? path.join(os.tmpdir(), 'photarium-data')
    : path.join(process.cwd(), 'data'));
