import { FileClientPageProjectStore } from '@/features/client-pages/storage/fileStore';
import { FileClientSiteStore } from './storage/fileStore';
import { ClientSiteService } from './service';

export const createClientSiteStore = () => new FileClientSiteStore();

export const createClientSiteService = () =>
  new ClientSiteService(createClientSiteStore(), new FileClientPageProjectStore());
