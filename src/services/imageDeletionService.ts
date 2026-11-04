export type DeleteFamilyJobStatus = {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  requestedId: string;
  rootId: string;
  total: number;
  attempted: number;
  deleted: number;
  failed: number;
  concurrency: number;
  vectorsDeleted: boolean;
  startedAt: number;
  finishedAt?: number;
  lastError?: string;
};

type DeleteImagePayload = {
  success?: boolean;
  assetType?: 'image' | 'video';
  detachedChildIds?: string[];
  error?: string;
};

export type ImageDeletePlan = {
  newParent: { id: string; filename: string } | null;
  childIds: string[];
  signature: string;
};

export const fetchImageDeletePlan = async (imageId: string): Promise<ImageDeletePlan> => {
  const response = await fetch(`/api/images/${encodeURIComponent(imageId)}/delete-plan`, { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Failed to inspect variants');
  return payload as ImageDeletePlan;
};

type DeleteFamilyPayload = {
  jobId?: string;
  error?: string;
};

export const buildImageDeleteUrl = (imageId: string) => {
  return `/api/images/${encodeURIComponent(imageId)}`;
};

const buildDeleteFamilyUrl = (imageId: string) => {
  return `/api/images/${encodeURIComponent(imageId)}/delete-family`;
};

export const deleteImage = async (imageId: string, familyPlan?: string) => {
  const query = familyPlan === undefined ? '' : `?${new URLSearchParams({ familyPlan })}`;
  const response = await fetch(`${buildImageDeleteUrl(imageId)}${query}`, { method: 'DELETE' });
  const payload = (await response.json().catch(() => ({}))) as DeleteImagePayload;
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to delete image');
  }
  return payload;
};

export const startDeleteFamilyJob = async (imageId: string) => {
  const response = await fetch(buildDeleteFamilyUrl(imageId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE_FAMILY', async: true })
  });
  const payload = (await response.json()) as DeleteFamilyPayload;
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to start delete-family job');
  }
  const jobId = typeof payload.jobId === 'string' ? payload.jobId : null;
  if (!jobId) {
    throw new Error('Delete-family job did not return a jobId');
  }
  return jobId;
};

export const fetchDeleteFamilyStatus = async (jobId: string) => {
  const response = await fetch(`/api/jobs/delete-family/${jobId}`, { cache: 'no-store' });
  const payload = (await response.json()) as DeleteFamilyJobStatus;
  if (!response.ok) {
    const errorMessage = (payload as unknown as { error?: string })?.error;
    throw new Error(errorMessage || 'Failed to fetch job status');
  }
  return payload;
};
