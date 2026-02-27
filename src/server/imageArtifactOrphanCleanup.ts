import { getCachedImages } from '@/server/cloudflareImageCache';
import { deleteImageExtrasRecord, listImageExtrasImageIds } from '@/server/imageExtras';
import {
  deleteWorkflowIntentEmbedding,
  isWorkflowIntentSearchAvailable,
  listWorkflowIntentEmbeddingImageIds,
} from '@/server/comfy/workflowIntentSearch';

export type OrphanArtifactTarget = 'imageExtras' | 'workflowIntentEmbedding';

export type OrphanTargetAudit = {
  target: OrphanArtifactTarget;
  status: 'ok' | 'skipped' | 'failed';
  scanned: number;
  orphanedIds: string[];
  reason?: string;
  error?: string;
};

export type OrphanArtifactAuditReport = {
  checkedAt: string;
  cloudflareImageCount: number;
  targets: OrphanTargetAudit[];
};

export type OrphanTargetCleanupResult = OrphanTargetAudit & {
  deletedIds: string[];
  failedDeletes: Array<{ imageId: string; error: string }>;
  apply: boolean;
};

export type OrphanArtifactCleanupReport = {
  checkedAt: string;
  cloudflareImageCount: number;
  targets: OrphanTargetCleanupResult[];
};

export type AuditOrphanedImageArtifactsOptions = {
  refreshCloudflareCache?: boolean;
  targets?: OrphanArtifactTarget[];
};

export type CleanupOrphanedImageArtifactsOptions = AuditOrphanedImageArtifactsOptions & {
  apply?: boolean;
};

type TargetHandlers = {
  listIds: () => Promise<string[]>;
  deleteById: (imageId: string) => Promise<void>;
  canRun?: () => Promise<boolean>;
  unavailableReason?: string;
};

const DEFAULT_TARGETS: OrphanArtifactTarget[] = ['imageExtras', 'workflowIntentEmbedding'];

function normalizeTargets(targets?: OrphanArtifactTarget[]): OrphanArtifactTarget[] {
  if (!targets || targets.length === 0) return DEFAULT_TARGETS;
  return Array.from(new Set(targets));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function computeOrphans(storedIds: string[], cloudflareIds: Set<string>): string[] {
  return Array.from(new Set(storedIds.filter((id) => id && !cloudflareIds.has(id)))).sort();
}

function getTargetHandlers(): Record<OrphanArtifactTarget, TargetHandlers> {
  return {
    imageExtras: {
      listIds: listImageExtrasImageIds,
      deleteById: deleteImageExtrasRecord,
    },
    workflowIntentEmbedding: {
      listIds: listWorkflowIntentEmbeddingImageIds,
      deleteById: deleteWorkflowIntentEmbedding,
      canRun: isWorkflowIntentSearchAvailable,
      unavailableReason: 'workflow-intent-search-unavailable',
    },
  };
}

async function auditSingleTarget(
  target: OrphanArtifactTarget,
  cloudflareIds: Set<string>,
  handlers: TargetHandlers
): Promise<OrphanTargetAudit> {
  if (handlers.canRun) {
    try {
      const available = await handlers.canRun();
      if (!available) {
        return {
          target,
          status: 'skipped',
          scanned: 0,
          orphanedIds: [],
          reason: handlers.unavailableReason ?? 'target-unavailable',
        };
      }
    } catch {
      return {
        target,
        status: 'skipped',
        scanned: 0,
        orphanedIds: [],
        reason: handlers.unavailableReason ?? 'target-unavailable',
      };
    }
  }

  try {
    const storedIds = await handlers.listIds();
    return {
      target,
      status: 'ok',
      scanned: storedIds.length,
      orphanedIds: computeOrphans(storedIds, cloudflareIds),
    };
  } catch (error) {
    return {
      target,
      status: 'failed',
      scanned: 0,
      orphanedIds: [],
      error: toErrorMessage(error),
    };
  }
}

export async function auditOrphanedImageArtifacts(
  options: AuditOrphanedImageArtifactsOptions = {}
): Promise<OrphanArtifactAuditReport> {
  const refreshCloudflareCache = options.refreshCloudflareCache ?? true;
  const targets = normalizeTargets(options.targets);
  const cloudflareImages = await getCachedImages(refreshCloudflareCache);
  const cloudflareIds = new Set(cloudflareImages.map((image) => image.id));
  const targetHandlers = getTargetHandlers();

  const targetReports: OrphanTargetAudit[] = [];
  for (const target of targets) {
    targetReports.push(await auditSingleTarget(target, cloudflareIds, targetHandlers[target]));
  }

  return {
    checkedAt: new Date().toISOString(),
    cloudflareImageCount: cloudflareIds.size,
    targets: targetReports,
  };
}

export async function cleanupOrphanedImageArtifacts(
  options: CleanupOrphanedImageArtifactsOptions = {}
): Promise<OrphanArtifactCleanupReport> {
  const apply = options.apply === true;
  const audit = await auditOrphanedImageArtifacts(options);
  const targetHandlers = getTargetHandlers();

  const targets: OrphanTargetCleanupResult[] = [];
  for (const targetAudit of audit.targets) {
    const handler = targetHandlers[targetAudit.target];
    const deletedIds: string[] = [];
    const failedDeletes: Array<{ imageId: string; error: string }> = [];

    if (apply && targetAudit.status === 'ok') {
      for (const imageId of targetAudit.orphanedIds) {
        try {
          await handler.deleteById(imageId);
          deletedIds.push(imageId);
        } catch (error) {
          failedDeletes.push({ imageId, error: toErrorMessage(error) });
        }
      }
    }

    const finalStatus =
      targetAudit.status === 'ok' && failedDeletes.length > 0 ? 'failed' : targetAudit.status;

    targets.push({
      ...targetAudit,
      status: finalStatus,
      apply,
      deletedIds,
      failedDeletes,
    });
  }

  return {
    checkedAt: audit.checkedAt,
    cloudflareImageCount: audit.cloudflareImageCount,
    targets,
  };
}

