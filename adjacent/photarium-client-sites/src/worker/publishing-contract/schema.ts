import { z } from 'zod';

const outputFormatSchema = z.enum(['jpg', 'png', 'webp']);
const fitModeSchema = z.enum(['scale-down', 'contain', 'cover']);

const secretLinkAccessPolicySchema = z.object({
  mode: z.literal('secret-link'),
  sessionTtlSeconds: z.number().int().positive().max(60 * 60 * 24 * 30),
});

const visibleTagPolicySchema = z.object({
  mode: z.literal('prefix-filter'),
  hiddenPrefixes: z.array(z.string().min(1)),
  hiddenExact: z.array(z.string().min(1)),
});

const viewPresetDefinitionSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  sourceVariant: z.string().min(1),
});

const downloadPresetDefinitionSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fit: fitModeSchema.optional(),
  quality: z.number().int().min(1).max(100).optional(),
  background: z.string().min(1).optional(),
});

export const downloadPresetPolicySchema = z.object({
  viewPresets: z.array(viewPresetDefinitionSchema).min(1),
  downloadPresets: z.array(downloadPresetDefinitionSchema).min(1),
  allowedOutputFormats: z.array(outputFormatSchema).min(1),
});

export const publishedProjectAssetSchema = z.object({
  projectAssetId: z.string().min(1),
  sourceImageId: z.string().min(1),
  filename: z.string().min(1),
  displayName: z.string().min(1).optional(),
  description: z.string().optional(),
  visibleTags: z.array(z.string().min(1)).optional(),
  sourceTags: z.array(z.string().min(1)),
  uploadedAt: z.string().datetime(),
  aspectRatio: z.string().min(1).optional(),
  dimensions: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  isCanonical: z.boolean(),
  hasEmbedding: z.boolean(),
  clusterSeed: z
    .object({
      id: z.string().min(1).optional(),
      label: z.string().min(1).optional(),
    })
    .optional(),
  previewVariant: z.string().min(1).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export const publishedProjectManifestSchema = z.object({
  schemaVersion: z.literal('2026-04-01'),
  project: z.object({
    id: z.string().min(1),
    publicSlug: z.string().min(12),
    status: z.enum(['draft', 'published', 'shadow', 'archived']),
    expiresAt: z.string().datetime().nullable().optional(),
    title: z.string().min(1),
    accessPolicy: secretLinkAccessPolicySchema,
    visibleTagPolicy: visibleTagPolicySchema,
    downloadPresetPolicy: downloadPresetPolicySchema,
  }),
  delivery: downloadPresetPolicySchema,
  revision: z.object({
    projectRevisionId: z.string().min(1),
    generatedAt: z.string().datetime(),
    sourceNamespaces: z.array(z.string()),
  }),
  assets: z.array(publishedProjectAssetSchema),
});

export const publishedProjectDeltaSchema = z.object({
  schemaVersion: z.literal('2026-04-01'),
  projectId: z.string().min(1),
  projectRevisionId: z.string().min(1),
  assets: z.array(publishedProjectAssetSchema).min(1),
});

export const projectStatusChangeSchema = z.object({
  schemaVersion: z.literal('2026-04-01'),
  projectId: z.string().min(1),
  status: z.enum(['draft', 'published', 'shadow', 'archived']),
});

export const clientShortlistSubmissionSchema = z.object({
  schemaVersion: z.literal('2026-04-01'),
  clientSessionId: z.string().min(1),
  selectedAssetIds: z.array(z.string().min(1)).min(1),
  clientName: z.string().min(1).optional(),
  clientEmail: z.string().email().optional(),
  note: z.string().max(2000).optional(),
});

export const createProjectRequestSchema = z.object({
  title: z.string().min(1),
  expiresAt: z.string().datetime().nullable().optional(),
  accessPolicy: secretLinkAccessPolicySchema.optional(),
  visibleTagPolicy: visibleTagPolicySchema.optional(),
  downloadPresetPolicy: downloadPresetPolicySchema.optional(),
});

