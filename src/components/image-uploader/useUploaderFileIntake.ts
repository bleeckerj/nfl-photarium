'use client';

import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  extractKeynoteImages,
  extractZipImages,
  getFileSourcePath,
  inferAssetTypeFromFile,
  isImageFile,
  isKeynoteFile,
  isZipFile,
  mergeTagInputs,
} from '@/components/image-uploader/fileHelpers';
import type { UploaderQueueItem } from '@/features/page-import/types';

type UseUploaderFileIntakeOptions = {
  createQueueId: () => string;
  setQueuedFiles: Dispatch<SetStateAction<UploaderQueueItem[]>>;
  setTags: Dispatch<SetStateAction<string>>;
  setDescription: Dispatch<SetStateAction<string>>;
};

const DROPZONE_ACCEPT = {
  'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.webp', '.svg'],
  // Some browsers report SVG only by its exact type, so the wildcard above is not
  // sufficient on its own for drag-and-drop.
  'image/svg+xml': ['.svg'],
  'video/*': ['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.ogg'],
  'application/octet-stream': ['.snagx', '.key'],
  'application/zip': ['.zip', '.snagx', '.key'],
  'application/x-zip-compressed': ['.zip', '.key'],
  'application/vnd.apple.keynote': ['.key'],
  'application/x-iwork-keynote-sffkey': ['.key'],
};

const previewUrlFor = (file: File) => (isImageFile(file) ? URL.createObjectURL(file) : undefined);

/**
 * Turns dropped files into queue items, expanding Keynote decks and zips into
 * their contained images. Keynote slides stay grouped so the queue can show them
 * as one deck, and the first deck seeds the shared tag/description fields.
 */
export function useUploaderFileIntake({
  createQueueId,
  setQueuedFiles,
  setTags,
  setDescription,
}: UseUploaderFileIntakeOptions) {
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const queued: UploaderQueueItem[] = [];
      let firstKeynoteName: string | null = null;

      for (const file of acceptedFiles) {
        if (isKeynoteFile(file)) {
          const keynoteName = file.name.replace(/\.[^.]+$/, '');
          const sourcePath = getFileSourcePath(file) || file.name;
          const groupId = createQueueId();
          if (!firstKeynoteName) firstKeynoteName = keynoteName;
          try {
            const extracted = await extractKeynoteImages(file);
            extracted.forEach((entry, index) => {
              queued.push({
                id: createQueueId(),
                assetType: 'image',
                file: entry.file,
                filename: entry.filename,
                tags: 'keynote',
                description: keynoteName,
                sourcePath,
                groupId,
                groupIndex: index,
                previewUrl: previewUrlFor(entry.file),
                selected: true,
              });
            });
          } catch (error) {
            console.error('Failed to extract Keynote images', error);
          }
          continue;
        }

        if (isZipFile(file)) {
          const sourcePath = getFileSourcePath(file) || file.name;
          try {
            const extracted = await extractZipImages(file);
            extracted.forEach((entry) => {
              queued.push({
                id: createQueueId(),
                assetType: 'image',
                file: entry.file,
                filename: entry.filename,
                sourcePath,
                previewUrl: previewUrlFor(entry.file),
                selected: true,
              });
            });
          } catch (error) {
            console.error('Failed to extract zip images', error);
          }
          continue;
        }

        const isSnagx = file.name.toLowerCase().endsWith('.snagx');
        queued.push({
          id: createQueueId(),
          assetType: inferAssetTypeFromFile(file),
          file,
          filename: file.name,
          tags: isSnagx ? 'snagx' : undefined,
          sourcePath: getFileSourcePath(file),
          previewUrl: previewUrlFor(file),
          selected: true,
        });
      }

      if (queued.length > 0) {
        setQueuedFiles((prev) => [...prev, ...queued]);
      }
      if (firstKeynoteName) {
        setTags((prev) => mergeTagInputs(prev, 'keynote'));
        setDescription(firstKeynoteName);
      }
    },
    [createQueueId, setDescription, setQueuedFiles, setTags]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: DROPZONE_ACCEPT,
    multiple: true,
  });

  return { getRootProps, getInputProps, isDragActive };
}
