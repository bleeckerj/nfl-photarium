import { aiContracts } from './ai.js';
import { provenanceContracts } from './provenance.js';
import { discoveryContracts } from './discovery.js';
import { demarkContracts } from './demark.js';
import { imageToolContracts } from './image-tools.js';
import { instagramContracts } from './instagram.js';
import { organizationContracts } from './organization.js';
import { systemContracts } from './system.js';
import { uploadContracts } from './upload.js';

export const allToolContracts = [
  ...provenanceContracts,
  ...discoveryContracts,
  ...demarkContracts,
  ...organizationContracts,
  ...uploadContracts,
  ...instagramContracts,
  ...imageToolContracts,
  ...aiContracts,
  ...systemContracts,
];
