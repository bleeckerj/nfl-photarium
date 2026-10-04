export const requestAssetMetadataUpdate = async (
  id: string,
  assetType: 'image' | 'video',
  metadata: Record<string, unknown>,
): Promise<void> => {
  const response = await fetch(`/api/${assetType === 'video' ? 'videos' : 'images'}/${encodeURIComponent(id)}/update`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  const payload: unknown = await response.json().catch(() => null);
  const record = payload && typeof payload === 'object' ? payload : null;
  if (!response.ok || (record && 'success' in record && record.success === false)) {
    const error = record && 'error' in record && typeof record.error === 'string'
      ? record.error.trim()
      : '';
    throw new Error(error || `Metadata update failed (HTTP ${response.status})`);
  }
  if (!record || !('success' in record) || record.success !== true) {
    throw new Error('Metadata update returned an invalid response');
  }
};
