import { FileClientPageProjectStore } from './storage/fileStore';
import { ClientPageProjectService } from './projectService';
import { ClientPagePublishService } from './publishService';
import { ClientPageSelectionService } from './selectionService';

export const createClientPageProjectStore = () => new FileClientPageProjectStore();

export const createClientPageProjectService = () =>
  new ClientPageProjectService(createClientPageProjectStore(), new ClientPageSelectionService());

export const createClientPagePublishService = () =>
  new ClientPagePublishService(createClientPageProjectService());
