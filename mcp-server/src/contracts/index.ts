import { aiContracts } from './ai.js';
import { archiveContracts } from './archive.js';
import { discoveryContracts } from './discovery.js';
import { imageToolContracts } from './image-tools.js';
import { instagramContracts } from './instagram.js';
import { organizationContracts } from './organization.js';
import { systemContracts } from './system.js';
import { uploadContracts } from './upload.js';

export const allToolContracts = [
  ...archiveContracts,
  ...discoveryContracts,
  ...organizationContracts,
  ...uploadContracts,
  ...instagramContracts,
  ...imageToolContracts,
  ...aiContracts,
  ...systemContracts,
];
