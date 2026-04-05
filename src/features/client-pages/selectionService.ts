import { dedupeImageIds } from './utils/imageIds';

export class ClientPageSelectionService {
  replaceSelection(selectedImageIds: string[]): string[] {
    return dedupeImageIds(selectedImageIds);
  }

  addSelection(existingIds: string[], imageIdsToAdd: string[]): string[] {
    return dedupeImageIds([...existingIds, ...imageIdsToAdd]);
  }

  removeSelection(existingIds: string[], imageIdsToRemove: string[]): string[] {
    const blocked = new Set(dedupeImageIds(imageIdsToRemove));
    return existingIds.filter((imageId) => !blocked.has(imageId));
  }

  moveSelection(existingIds: string[], imageId: string, direction: 'up' | 'down'): string[] {
    const currentIndex = existingIds.indexOf(imageId);
    if (currentIndex < 0) return existingIds;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= existingIds.length) return existingIds;

    const reordered = [...existingIds];
    const [entry] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, entry);
    return reordered;
  }
}
