type ParentAssignmentPayload = {
  error?: string;
  targetAssetType?: 'image' | 'video';
  parentId?: string;
};

export const patchParentAssignment = async (targetId: string, parentIdValue: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(`/api/assets/${targetId}/parent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: parentIdValue }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Parent assignment timed out. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json()) as ParentAssignmentPayload;
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to update parent relationship');
  }
  return payload;
};
