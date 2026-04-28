import { getExtrasStorage } from '@/server/extrasStorage';
import type { ComfyWorkflowEntry } from '@/server/imageExtras';

export type VideoExtrasRecordV1 = {
  schemaVersion: 1;
  videoId: string;
  comfyWorkflow?: ComfyWorkflowEntry;
  createdAt: string;
  updatedAt: string;
};

export type VideoExtrasRecord = VideoExtrasRecordV1;

const VIDEO_EXTRAS_KEY_PREFIX = 'video-extras:';

const getVideoExtrasKey = (videoId: string) => `${VIDEO_EXTRAS_KEY_PREFIX}${videoId}`;

export async function getVideoExtrasRecord(videoId: string): Promise<VideoExtrasRecord | null> {
  return await getExtrasStorage().get<VideoExtrasRecord>(getVideoExtrasKey(videoId));
}

export async function patchVideoExtrasRecord(
  videoId: string,
  patch: Partial<Omit<VideoExtrasRecord, 'schemaVersion' | 'videoId' | 'createdAt' | 'updatedAt'>>
): Promise<VideoExtrasRecord> {
  const existing = await getVideoExtrasRecord(videoId);
  const now = new Date().toISOString();

  const next: VideoExtrasRecord = {
    schemaVersion: 1,
    videoId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing ?? {}),
    ...patch,
  };

  await getExtrasStorage().set(getVideoExtrasKey(videoId), next);
  return next;
}

export async function deleteVideoExtrasRecord(videoId: string): Promise<void> {
  await getExtrasStorage().delete(getVideoExtrasKey(videoId));
}
