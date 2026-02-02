type ParentAssignmentPayload = {
  error?: string;
};

export const patchParentAssignment = async (targetId: string, parentIdValue: string) => {
  const response = await fetch(`/api/images/${targetId}/update`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentId: parentIdValue })
  });
  const payload = (await response.json()) as ParentAssignmentPayload;
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to update parent relationship');
  }
  return payload;
};
