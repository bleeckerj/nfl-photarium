import type { DragEvent } from 'react';
import { getCloudflareDownloadUrl, getCloudflareImageUrl } from './imageUtils';

export interface DragImageLike {
  id: string;
  filename?: string;
}

export const setDragPayloadForImage = (e: DragEvent, image: DragImageLike) => {
  e.stopPropagation();
  const filename = (image.filename || `image-${image.id}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const cdnUrl = getCloudflareImageUrl(image.id, 'original');
  const { mime } = getCloudflareDownloadUrl(image.id, filename);

  e.dataTransfer.clearData();
  // Chrome/Edge/Electron: Allows dragging file to desktop
  e.dataTransfer.setData('DownloadURL', `${mime}:${filename}:${cdnUrl}`);

  // Standard Apps (Discord, Slack, etc)
  e.dataTransfer.setData('text/plain', cdnUrl);
  e.dataTransfer.setData('text/uri-list', cdnUrl);
  e.dataTransfer.effectAllowed = 'copy';
};
