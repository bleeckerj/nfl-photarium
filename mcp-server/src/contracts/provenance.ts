import { createRuntimeToolContract } from './runtime-support.js';
export const provenanceContracts = ['photarium_provenance_attach', 'photarium_provenance_list', 'photarium_provenance_get'].map(createRuntimeToolContract);
