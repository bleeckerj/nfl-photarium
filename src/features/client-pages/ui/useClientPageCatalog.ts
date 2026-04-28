'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AspectRatioClass, CloudflareImage, DateFilter } from '@/components/gallery/types';
import { getDateKeyRangeMs } from '@/components/gallery/dateFilter';
import { buildNamespaceOptions, getUniqueFolders, getUniqueTags } from '@/components/gallery/utils';
import { filterImagesForGallery } from '@/utils/galleryFilter';
import { clientPageApi } from './api';

const PAGE_SIZE = 30;

const matchesNamespace = (image: CloudflareImage, namespace: string) => {
  if (namespace === '__all__') return true;
  if (namespace === '') return !image.namespace;
  return image.namespace === namespace;
};

const matchesAspectRatio = (image: CloudflareImage, aspectRatio: AspectRatioClass | 'all') => {
  if (aspectRatio === 'all') return true;
  const ratio = image.aspectRatio?.toLowerCase() ?? '';
  if (ratio === '1:1') return aspectRatio === 'square';
  if (ratio.includes(':')) {
    const [leftRaw, rightRaw] = ratio.split(':');
    const left = Number(leftRaw);
    const right = Number(rightRaw);
    if (!Number.isFinite(left) || !Number.isFinite(right) || right === 0) return true;
    const decimal = left / right;
    if (Math.abs(decimal - 1) < 0.05) return aspectRatio === 'square';
    return aspectRatio === 'horizontal' ? decimal > 1 : decimal < 1;
  }
  return true;
};

const matchesDateFilter = (image: CloudflareImage, dateFilter: DateFilter | null) => {
  if (!dateFilter) return true;
  const range = getDateKeyRangeMs(dateFilter);
  if (!range) return true;
  const uploadedTime = Date.parse(image.uploaded);
  if (Number.isNaN(uploadedTime)) return true;
  return uploadedTime >= range.startMs && uploadedTime <= range.endMs;
};

export function useClientPageCatalog(initialNamespace = '__all__') {
  const [images, setImages] = useState<CloudflareImage[]>([]);
  const [registryNamespaces, setRegistryNamespaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [semanticError, setSemanticError] = useState<string | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [namespace, setNamespace] = useState(initialNamespace);
  const [selectedFolder, setSelectedFolder] = useState('all');
  const [selectedTag, setSelectedTag] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioClass | 'all'>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter | null>(null);
  const [semanticQuery, setSemanticQuery] = useState('');
  const [semanticMatchIds, setSemanticMatchIds] = useState<Set<string> | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [namespaceFallbackNotice, setNamespaceFallbackNotice] = useState<string | null>(null);
  const [hasAutoAdjustedInitialNamespace, setHasAutoAdjustedInitialNamespace] = useState(false);

  const loadCatalog = useCallback(async () => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [nextImages, namespaces] = await Promise.all([
          clientPageApi.loadCatalogImages(),
          clientPageApi.loadNamespaces(),
        ]);
        if (!active) return;
        setImages(nextImages);
        setRegistryNamespaces(namespaces);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load catalog.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    await load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void loadCatalog().then((nextCleanup) => {
      cleanup = nextCleanup;
    });

    return () => {
      cleanup?.();
    };
  }, [loadCatalog, initialNamespace]);

  useEffect(() => {
    setNamespace(initialNamespace);
    setNamespaceFallbackNotice(null);
    setHasAutoAdjustedInitialNamespace(false);
  }, [initialNamespace]);

  const scopedImages = useMemo(
    () => images.filter((image) => matchesNamespace(image, namespace)),
    [images, namespace]
  );

  useEffect(() => {
    if (loading || hasAutoAdjustedInitialNamespace) return;
    if (namespace === '__all__') {
      setHasAutoAdjustedInitialNamespace(true);
      return;
    }
    if (images.length === 0) return;
    if (scopedImages.length > 0) {
      setHasAutoAdjustedInitialNamespace(true);
      return;
    }

    setNamespace('__all__');
    setNamespaceFallbackNotice(
      `No assets were found in namespace "${namespace}". Showing all namespaces instead.`
    );
    setHasAutoAdjustedInitialNamespace(true);
  }, [hasAutoAdjustedInitialNamespace, images.length, loading, namespace, scopedImages.length]);

  const filteredImages = useMemo(() => {
    const baseFiltered = filterImagesForGallery(scopedImages, {
      selectedFolder,
      selectedTag,
      searchTerm,
      onlyCanonical: false,
    });
    return baseFiltered.filter((image) => {
      if (!matchesAspectRatio(image, aspectRatio)) return false;
      if (!matchesDateFilter(image, dateFilter)) return false;
      if (semanticMatchIds && !semanticMatchIds.has(image.id)) return false;
      return true;
    });
  }, [aspectRatio, dateFilter, scopedImages, searchTerm, selectedFolder, selectedTag, semanticMatchIds]);

  useEffect(() => {
    setCurrentPage(1);
  }, [namespace, selectedFolder, selectedTag, searchTerm, aspectRatio, dateFilter, semanticMatchIds]);

  const totalPages = Math.max(1, Math.ceil(filteredImages.length / PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pageImages = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredImages.slice(startIndex, startIndex + PAGE_SIZE);
  }, [currentPage, filteredImages]);

  const namespaceOptions = useMemo(
    () =>
      buildNamespaceOptions(images, namespace === '__all__' ? undefined : namespace, registryNamespaces).filter(
        (option) => option.value !== '__custom__'
      ),
    [images, namespace, registryNamespaces]
  );

  const folderOptions = useMemo(
    () => [
      { value: 'all', label: 'All folders' },
      { value: 'no-folder', label: 'No folder' },
      ...getUniqueFolders(scopedImages).map((folder) => ({ value: folder, label: folder })),
    ],
    [scopedImages]
  );

  const tagOptions = useMemo(
    () => [{ value: '', label: 'All tags' }, ...getUniqueTags(scopedImages).map((tag) => ({ value: tag, label: tag }))],
    [scopedImages]
  );

  const runSemanticSearch = async () => {
    const trimmedQuery = semanticQuery.trim();
    if (!trimmedQuery) {
      setSemanticMatchIds(null);
      setSemanticError(null);
      return;
    }
    try {
      setSemanticLoading(true);
      setSemanticError(null);
      const ids = await clientPageApi.searchSemantically(trimmedQuery, namespace);
      setSemanticMatchIds(ids);
    } catch (searchError) {
      setSemanticError(searchError instanceof Error ? searchError.message : 'Semantic search failed.');
    } finally {
      setSemanticLoading(false);
    }
  };

  const clearFilters = () => {
    setSelectedFolder('all');
    setSelectedTag('');
    setSearchTerm('');
    setAspectRatio('all');
    setDateFilter(null);
    setSemanticQuery('');
    setSemanticMatchIds(null);
    setSemanticError(null);
    setNamespace('__all__');
    setNamespaceFallbackNotice(null);
  };

  return {
    images,
    scopedImages,
    loading,
    error,
    namespace,
    setNamespace,
    namespaceFallbackNotice,
    setNamespaceFallbackNotice,
    selectedFolder,
    setSelectedFolder,
    selectedTag,
    setSelectedTag,
    searchTerm,
    setSearchTerm,
    aspectRatio,
    setAspectRatio,
    dateFilter,
    setDateFilter,
    semanticQuery,
    setSemanticQuery,
    semanticLoading,
    semanticError,
    hasSemanticFilter: semanticMatchIds !== null,
    runSemanticSearch,
    clearFilters,
    filteredImages,
    pageImages,
    currentPage,
    totalPages,
    setCurrentPage,
    namespaceOptions,
    folderOptions,
    tagOptions,
  };
}
