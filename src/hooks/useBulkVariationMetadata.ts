import { useCallback, useState } from 'react';
import { patchImageMetadata } from '@/services/imageMetadataService';
import { mergeUserTagsPreservingSystemTags } from '@/utils/systemTags';

type BulkUpdateFailure = {
  id: string;
  name: string;
  error?: string;
  reason?: 'metadata' | 'network' | 'unknown';
};

type VariationChild = {
  id: string;
  filename?: string;
  tags?: string[];
};

type VariationMetadataImage = VariationChild & {
  filename: string;
  uploaded: string;
  variants?: string[];
  parentId?: string;
  description?: string;
  altTag?: string;
  folder?: string;
};

type Toast = {
  push: (message: string) => void;
};

type UseBulkVariationMetadataParams = {
  imageId?: string;
  isChildImage: boolean;
  variationChildren: VariationChild[];
  parentTags: string[];
  effectiveParentFolder?: string;
  descriptionInput: string;
  altTextInput: string;
  setAllImages: (updater: (prev: VariationMetadataImage[]) => VariationMetadataImage[]) => void;
  toast: Toast;
  isMetadataLimitError: (message?: string) => boolean;
  formatFailureNames: (failures: BulkUpdateFailure[]) => string;
};

export function useBulkVariationMetadata({
  imageId,
  isChildImage,
  variationChildren,
  parentTags,
  effectiveParentFolder,
  descriptionInput,
  altTextInput,
  setAllImages,
  toast,
  isMetadataLimitError,
  formatFailureNames
}: UseBulkVariationMetadataParams) {
  const [bulkDescriptionApplying, setBulkDescriptionApplying] = useState(false);
  const [bulkAltApplying, setBulkAltApplying] = useState(false);
  const [bulkFolderApplying, setBulkFolderApplying] = useState(false);
  const [bulkTagsAppending, setBulkTagsAppending] = useState(false);
  const [bulkTagsReplacing, setBulkTagsReplacing] = useState(false);

  const applyDescriptionToVariations = useCallback(async () => {
    if (isChildImage) {
      return;
    }
    const trimmed = descriptionInput.trim();
    if (!trimmed) {
      toast.push('Add a description first');
      return;
    }
    if (!variationChildren.length) {
      toast.push('No variations to update');
      return;
    }
    setBulkDescriptionApplying(true);
    try {
      const results = await Promise.all(
        variationChildren.map(async (child) => {
          try {
            const { ok, payload } = await patchImageMetadata(child.id, { description: trimmed });
            return { ok, error: payload?.error, id: child.id };
          } catch (err) {
            console.error('Bulk description apply error', err);
            return { ok: false, error: 'Network error', id: child.id };
          }
        })
      );
      const failures = results.filter(result => !result.ok);
      const successCount = results.length - failures.length;
      if (successCount && imageId) {
        setAllImages(prev =>
          prev.map(img => (img.parentId === imageId ? { ...img, description: trimmed } : img))
        );
      }
      if (failures.length) {
        toast.push(`Updated ${successCount}/${variationChildren.length} variations (some failed)`);
      } else {
        toast.push(`Description applied to ${variationChildren.length} variations`);
      }
    } catch (err) {
      console.error('Failed to bulk apply description', err);
      toast.push('Failed to apply description to variations');
    } finally {
      setBulkDescriptionApplying(false);
    }
  }, [descriptionInput, imageId, isChildImage, setAllImages, toast, variationChildren]);

  const applyAltToVariations = useCallback(async () => {
    if (isChildImage) {
      return;
    }
    const trimmed = altTextInput.trim();
    if (!trimmed) {
      toast.push('Add ALT text first');
      return;
    }
    if (!variationChildren.length) {
      toast.push('No variations to update');
      return;
    }
    setBulkAltApplying(true);
    try {
      const results = await Promise.all(
        variationChildren.map(async (child) => {
          try {
            const { ok, payload } = await patchImageMetadata(child.id, { altTag: trimmed });
            return { ok, error: payload?.error, id: child.id };
          } catch (err) {
            console.error('Bulk ALT apply error', err);
            return { ok: false, error: 'Network error', id: child.id };
          }
        })
      );
      const failures = results.filter(result => !result.ok);
      const successCount = results.length - failures.length;
      if (successCount && imageId) {
        setAllImages(prev =>
          prev.map(img => (img.parentId === imageId ? { ...img, altTag: trimmed } : img))
        );
      }
      if (failures.length) {
        toast.push(`Updated ${successCount}/${variationChildren.length} variations (some failed)`);
      } else {
        toast.push(`ALT text applied to ${variationChildren.length} variations`);
      }
    } catch (err) {
      console.error('Failed to bulk apply ALT text', err);
      toast.push('Failed to apply ALT text to variations');
    } finally {
      setBulkAltApplying(false);
    }
  }, [altTextInput, imageId, isChildImage, setAllImages, toast, variationChildren]);

  const applyFolderToVariations = useCallback(async () => {
    if (isChildImage) {
      return;
    }
    if (!variationChildren.length) {
      toast.push('No variations to update');
      return;
    }
    if (!effectiveParentFolder) {
      toast.push('Parent has no folder set');
      return;
    }
    setBulkFolderApplying(true);
    try {
      type BulkUpdateResult =
        | { ok: true; id: string }
        | ({ ok: false } & BulkUpdateFailure);
      const results: BulkUpdateResult[] = await Promise.all(
        variationChildren.map(async (child) => {
          try {
            const { ok, payload } = await patchImageMetadata(child.id, { folder: effectiveParentFolder });
            if (!ok) {
              const errorMessage = payload?.error || 'Failed to update folder';
              return {
                ok: false,
                id: child.id,
                name: child.filename || child.id,
                error: errorMessage,
                reason: isMetadataLimitError(errorMessage) ? 'metadata' : 'unknown'
              };
            }
            return { ok: true, id: child.id };
          } catch (err) {
            console.error('Bulk folder apply error', err);
            return {
              ok: false,
              id: child.id,
              name: child.filename || child.id,
              error: 'Network error',
              reason: 'network'
            };
          }
        })
      );

      const failures = results.filter((result): result is ({ ok: false } & BulkUpdateFailure) => !result.ok);
      const successIds = new Set(results.filter((result) => result.ok).map((result) => result.id));
      if (successIds.size) {
        setAllImages((prev) =>
          prev.map((img) => (successIds.has(img.id) ? { ...img, folder: effectiveParentFolder } : img))
        );
      }

      if (failures.length) {
        const metadataFailures = failures.filter((failure) => failure.reason === 'metadata');
        if (metadataFailures.length) {
          console.warn('Metadata too large for variations:', metadataFailures);
          toast.push(
            `Metadata too large for ${metadataFailures.length} variation(s): ${formatFailureNames(metadataFailures)}`
          );
        }
        const otherFailures = failures.filter((failure) => failure.reason !== 'metadata');
        if (otherFailures.length) {
          toast.push(`Failed to update ${otherFailures.length} variation(s)`);
        }
        const successCount = variationChildren.length - failures.length;
        if (successCount) {
          toast.push(`Updated ${successCount}/${variationChildren.length} variations`);
        }
      } else {
        toast.push(`Folder applied to ${variationChildren.length} variations`);
      }
    } catch (err) {
      console.error('Failed to bulk apply folder', err);
      toast.push('Failed to apply folder to variations');
    } finally {
      setBulkFolderApplying(false);
    }
  }, [effectiveParentFolder, isChildImage, toast, variationChildren, formatFailureNames, isMetadataLimitError, setAllImages]);

  const applyTagsToVariations = useCallback(
    async (mode: 'append' | 'replace') => {
      if (isChildImage) {
        return;
      }
      if (!variationChildren.length) {
        toast.push('No variations to update');
        return;
      }
      if (mode === 'append' && parentTags.length === 0) {
        toast.push('No parent tags to append');
        return;
      }

      if (mode === 'append') {
        setBulkTagsAppending(true);
      } else {
        setBulkTagsReplacing(true);
      }

      try {
        type BulkUpdateResult =
          | { ok: true; id: string; tags: string[] }
          | ({ ok: false } & BulkUpdateFailure);
        const results: BulkUpdateResult[] = await Promise.all(
          variationChildren.map(async (child) => {
            const existingTags = Array.isArray(child.tags) ? child.tags : [];
            const nextTags =
              mode === 'append'
                ? Array.from(new Set([...existingTags, ...parentTags].map((tag) => tag.trim()).filter(Boolean)))
                : mergeUserTagsPreservingSystemTags(existingTags, parentTags);
            try {
              const { ok, payload } = await patchImageMetadata(child.id, { tags: nextTags });
              if (!ok) {
                const errorMessage = payload?.error || 'Failed to update tags';
                return {
                  ok: false,
                  id: child.id,
                  name: child.filename || child.id,
                  error: errorMessage,
                  reason: isMetadataLimitError(errorMessage) ? 'metadata' : 'unknown'
                };
              }
              return { ok: true, id: child.id, tags: nextTags };
            } catch (err) {
              console.error('Bulk tags apply error', err);
              return {
                ok: false,
                id: child.id,
                name: child.filename || child.id,
                error: 'Network error',
                reason: 'network'
              };
            }
          })
        );

        const failures = results.filter((result): result is ({ ok: false } & BulkUpdateFailure) => !result.ok);
        const tagsById = new Map(
          results.filter((result): result is { ok: true; id: string; tags: string[] } => result.ok).map((result) => [
            result.id,
            result.tags
          ])
        );

        if (tagsById.size) {
          setAllImages((prev) =>
            prev.map((img) => {
              const nextTags = tagsById.get(img.id);
              if (!nextTags) return img;
              return { ...img, tags: nextTags };
            })
          );
        }

        if (failures.length) {
          const metadataFailures = failures.filter((failure) => failure.reason === 'metadata');
          if (metadataFailures.length) {
            console.warn('Metadata too large for variations:', metadataFailures);
            toast.push(
              `Metadata too large for ${metadataFailures.length} variation(s): ${formatFailureNames(metadataFailures)}`
            );
          }
          const otherFailures = failures.filter((failure) => failure.reason !== 'metadata');
          if (otherFailures.length) {
            toast.push(`Failed to update ${otherFailures.length} variation(s)`);
          }
          const successCount = variationChildren.length - failures.length;
          if (successCount) {
            toast.push(`Updated ${successCount}/${variationChildren.length} variations`);
          }
        } else {
          toast.push(
            mode === 'append'
              ? `Tags appended to ${variationChildren.length} variations`
              : `Tags replaced on ${variationChildren.length} variations`
          );
        }
      } catch (err) {
        console.error('Failed to bulk apply tags', err);
        toast.push('Failed to apply tags to variations');
      } finally {
        if (mode === 'append') {
          setBulkTagsAppending(false);
        } else {
          setBulkTagsReplacing(false);
        }
      }
    },
    [isChildImage, parentTags, toast, variationChildren, formatFailureNames, isMetadataLimitError, setAllImages]
  );

  return {
    bulkDescriptionApplying,
    bulkAltApplying,
    bulkFolderApplying,
    bulkTagsAppending,
    bulkTagsReplacing,
    applyDescriptionToVariations,
    applyAltToVariations,
    applyFolderToVariations,
    applyTagsToVariations
  };
}
