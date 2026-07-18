import { FileClientPageProjectStore } from './storage/fileStore';
import { ClientPageProjectService } from './projectService';
import { ClientPagePublishService } from './publishService';
import { ClientPageSelectionService } from './selectionService';
import { ClientPageAssetRepairService } from './assetRepairService';
import { createClientSiteService } from '@/features/client-sites/server';

export const createClientPageProjectStore = () => new FileClientPageProjectStore();

export const createClientPageProjectService = () =>
  new ClientPageProjectService(createClientPageProjectStore(), new ClientPageSelectionService());

export const createClientPagePublishService = () =>
  new ClientPagePublishService(createClientPageProjectService(), createClientSiteService());

export const createClientPageAssetRepairService = () =>
  new ClientPageAssetRepairService(createClientPageProjectService());
