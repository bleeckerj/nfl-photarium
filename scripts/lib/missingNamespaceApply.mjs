import {
  assertValidAssignmentPlan,
  formatAssignmentLogEntry,
  getMetadataNamespace,
  parseMetadata,
  prepareNamespaceMetadataUpdate,
} from './missingNamespaceAssignment.mjs';

export const applyAssignmentPlan = async ({
  fetchImageById,
  logger = console,
  patchMetadata,
  plan,
}) => {
  assertValidAssignmentPlan(plan);

  const result = {
    alreadyTarget: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const entry of plan.entries) {
    const targetNamespace = entry.targetNamespace || plan.targetNamespace;
    if (!targetNamespace) {
      result.failed += 1;
      result.details.push({ id: entry.id, status: 'failed', reason: 'missing target namespace' });
      logger.warn?.(`[assign-namespace] Failed ${entry.id}: missing target namespace`);
      continue;
    }
    try {
      const image = await fetchImageById(entry.id);
      const existingMetadata = parseMetadata(image?.meta);
      const existingNamespace = getMetadataNamespace(existingMetadata);
      if (existingNamespace === targetNamespace) {
        result.alreadyTarget += 1;
        result.details.push({ id: entry.id, status: 'already-target', namespace: existingNamespace });
        logger.log?.(formatAssignmentLogEntry({ entry, status: 'already', currentNamespace: existingNamespace, targetNamespace }));
        continue;
      }
      const canRepairFallback = existingNamespace && existingNamespace === plan.fallbackNamespace && entry.action === 'repair-from-fallback-to-family-namespace';
      if (existingNamespace && !canRepairFallback) {
        result.skipped += 1;
        result.details.push({ id: entry.id, status: 'skipped', reason: `already has namespace ${existingNamespace}` });
        logger.warn?.(formatAssignmentLogEntry({ entry, status: 'skip', currentNamespace: existingNamespace, targetNamespace, detail: `already has namespace ${existingNamespace}` }));
        continue;
      }

      const prepared = prepareNamespaceMetadataUpdate(existingMetadata, targetNamespace);
      if (!prepared.ok) {
        result.failed += 1;
        result.details.push({ id: entry.id, status: 'failed', reason: prepared.reason });
        logger.warn?.(formatAssignmentLogEntry({ entry, status: 'failed', currentNamespace: existingNamespace, targetNamespace, detail: prepared.reason }));
        continue;
      }

      await patchMetadata(entry.id, prepared.metadata);
      const verifiedImage = await fetchImageById(entry.id);
      const verifiedNamespace = getMetadataNamespace(parseMetadata(verifiedImage?.meta));
      if (verifiedNamespace !== targetNamespace) {
        result.failed += 1;
        result.details.push({ id: entry.id, status: 'failed', reason: `post-patch verification found namespace=${verifiedNamespace || '[missing]'}` });
        logger.warn?.(formatAssignmentLogEntry({ entry, status: 'failed', currentNamespace: verifiedNamespace, targetNamespace, detail: `post-patch verification found namespace=${verifiedNamespace || '[missing]'}` }));
        continue;
      }

      result.updated += 1;
      result.details.push({ id: entry.id, status: 'updated', dropped: prepared.dropped });
      logger.log?.(formatAssignmentLogEntry({ entry, status: 'verified', currentNamespace: existingNamespace, targetNamespace, detail: prepared.dropped.length ? `metadata trimmed: ${prepared.dropped.join(', ')}` : undefined }));
    } catch (error) {
      result.failed += 1;
      result.details.push({ id: entry.id, status: 'failed', reason: error.message });
      logger.warn?.(formatAssignmentLogEntry({ entry, status: 'failed', currentNamespace: entry.currentNamespace || '', targetNamespace: targetNamespace || '', detail: error.message }));
    }
  }

  return result;
};
