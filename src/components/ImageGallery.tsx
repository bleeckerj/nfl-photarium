'use client';

import { useState, useEffect, forwardRef, useImperativeHandle, useMemo, CSSProperties, useRef, useCallback } from 'react';
import { Trash2, Copy, ExternalLink, Sparkles, Layers, AlertTriangle, Settings, Cpu } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import MonoSelect from './MonoSelect';
import GalleryCommandBar from './GalleryCommandBar';
import FolderManagerButton from './FolderManagerButton';
import DateNavigator, { DateFilter } from './DateNavigator';
import { EmbeddingStatusDot } from './EmbeddingStatusIcon';
import { subscribeEmbeddingPending, clearPendingIfHasEmbeddings, type EmbeddingPendingEntry } from '@/utils/embeddingPending';
import { getCloudflareImageUrl, getMultipleImageUrls, getCloudflareDownloadUrl, IMAGE_VARIANTS } from '@/utils/imageUtils';
import { useToast } from './Toast';
import { useImageAspectRatio } from '@/hooks/useImageAspectRatio';
import HoverPreview from './HoverPreview';
import { downloadImageToFile, formatDownloadFileName } from '@/utils/downloadUtils';
import { filterImagesForGallery } from '@/utils/galleryFilter';
import { EXCLUDE_CLIP_TAG, EXCLUDE_COLOR_TAG, EXCLUDE_ALL_SEARCH_TAG } from '@/utils/searchExclusion';

const handleImageDragStart = (e: React.DragEvent, image: CloudflareImage) => {
  e.stopPropagation();
  const filename = (image.filename || `image-${image.id}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const cdnUrl = getCloudflareImageUrl(image.id, 'original');
  const { mime } = getCloudflareDownloadUrl(image.id, filename);
  
  e.dataTransfer.clearData();
  // Chrome/Edge/Electron: Allows dragging file to desktop
  e.dataTransfer.setData('DownloadURL', `${mime}:${filename}:${cdnUrl}`);
  
  // Standard Apps (Discord, Slack, etc)
  e.dataTransfer.setData('text/plain', cdnUrl);
  e.dataTransfer.setData('text/uri-list', cdnUrl);
  e.dataTransfer.effectAllowed = 'copy';
};

interface CloudflareImage {
  id: string;
  filename: string;
  displayName?: string;
  uploaded: string;
  variants: string[];
  folder?: string;
  tags?: string[];
  description?: string;
  aspectRatio?: string;
  dimensions?: { width: number; height: number };
  altTag?: string;
  parentId?: string;
  linkedAssetId?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  contentHash?: string;
  namespace?: string;
  // Embedding status fields
  hasClipEmbedding?: boolean;
  hasColorEmbedding?: boolean;
  dominantColors?: string[];
  averageColor?: string;
}

interface ImageGalleryProps {
  refreshTrigger?: number;
  namespace?: string;
  onNamespaceChange?: (value: string) => void;
}

export interface ImageGalleryRef {
  refreshImages: () => void;
}

const DEFAULT_PAGE_SIZE = 30;
const PAGE_SIZE_OPTIONS = [12, 24, 30, 48, 60, 90, 120];
const HIDDEN_FOLDERS_STORAGE_KEY = 'galleryHiddenFolders';
const HIDDEN_TAGS_STORAGE_KEY = 'galleryHiddenTags';
const BROKEN_AUDIT_STORAGE_KEY = 'galleryBrokenAudit';
const AUDIT_LOG_LIMIT = 200;
const VARIANT_DIMENSIONS = new Map(IMAGE_VARIANTS.map(variant => [variant.name, variant.width]));

/**
 * Check if an image has any search exclusion tags
 */
const hasSearchExclusionTag = (tags?: string[]): boolean => {
  if (!tags || tags.length === 0) return false;
  return tags.some(tag => 
    tag === EXCLUDE_CLIP_TAG || 
    tag === EXCLUDE_COLOR_TAG || 
    tag === EXCLUDE_ALL_SEARCH_TAG
  );
};

/**
 * Get tooltip text describing which searches are excluded
 */
const getExclusionTooltip = (tags?: string[]): string => {
  if (!tags || tags.length === 0) return '';
  const excluded: string[] = [];
  if (tags.includes(EXCLUDE_ALL_SEARCH_TAG)) {
    return 'Excluded from all vector searches';
  }
  if (tags.includes(EXCLUDE_CLIP_TAG)) excluded.push('semantic');
  if (tags.includes(EXCLUDE_COLOR_TAG)) excluded.push('color');
  return `Excluded from ${excluded.join(' & ')} search`;
};

/**
 * Search exclusion icon (icons8 style - eye with slash)
 */
const SearchExclusionIcon = ({ className = '', title = '' }: { className?: string; title?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="currentColor"
    className={className}
    aria-label={title}
  >
    <title>{title}</title>
    {/* Eye with slash - indicates hidden from search */}
    <path d="M2.71 2.29a1 1 0 00-1.42 1.42l2.5 2.5C2.26 7.8 1.1 9.79.39 11.55a1 1 0 000 .9c1.42 3.5 4.88 7.05 9.61 7.5v.05l2.29 2.29a1 1 0 001.42-1.42l-11-11.16zM12 6c3.79 0 7.17 2.13 8.82 5.5-.5 1.02-1.19 1.99-2.02 2.85l1.42 1.42c1.13-1.13 2.07-2.46 2.78-3.9a1 1 0 000-.87C21.27 7.11 17 4 12 4c-1.27 0-2.49.2-3.64.56l1.57 1.57c.68-.09 1.38-.13 2.07-.13zM12 8a4 4 0 014 4c0 .35-.06.69-.15 1.02l-4.87-4.87c.33-.09.67-.15 1.02-.15z"/>
    <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

type BrokenAudit = {
  checkedAt?: string;
  ids: string[];
};

type AuditLogEntry = {
  id: string;
  filename?: string;
  status?: number;
  reason?: string;
  url?: string;
};

const loadHiddenFoldersFromStorage = (): string[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const storedValue = window.localStorage.getItem(HIDDEN_FOLDERS_STORAGE_KEY);
    if (!storedValue) {
      return [];
    }
    const parsed = JSON.parse(storedValue);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean);
    }
  } catch (error) {
    console.warn('Failed to parse hidden folders', error);
  }
  return [];
};

const persistHiddenFolders = (folders: string[]) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(HIDDEN_FOLDERS_STORAGE_KEY, JSON.stringify(folders));
  } catch (error) {
    console.warn('Failed to save hidden folders', error);
  }
};

const loadHiddenTagsFromStorage = (): string[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const storedValue = window.localStorage.getItem(HIDDEN_TAGS_STORAGE_KEY);
    if (!storedValue) {
      return [];
    }
    const parsed = JSON.parse(storedValue);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean);
    }
  } catch (error) {
    console.warn('Failed to parse hidden tags', error);
  }
  return [];
};

const persistHiddenTags = (tags: string[]) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(HIDDEN_TAGS_STORAGE_KEY, JSON.stringify(tags));
  } catch (error) {
    console.warn('Failed to save hidden tags', error);
  }
};

const loadBrokenAuditFromStorage = (): BrokenAudit => {
  if (typeof window === 'undefined') {
    return { ids: [] };
  }
  try {
    const storedValue = window.localStorage.getItem(BROKEN_AUDIT_STORAGE_KEY);
    if (!storedValue) {
      return { ids: [] };
    }
    const parsed = JSON.parse(storedValue) as BrokenAudit;
    if (parsed && Array.isArray(parsed.ids)) {
      return {
        checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : undefined,
        ids: parsed.ids.filter((item): item is string => typeof item === 'string')
      };
    }
  } catch (error) {
    console.warn('Failed to parse broken audit state', error);
  }
  return { ids: [] };
};

const persistBrokenAudit = (audit: BrokenAudit) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(BROKEN_AUDIT_STORAGE_KEY, JSON.stringify(audit));
  } catch (error) {
    console.warn('Failed to save broken audit state', error);
  }
};

const ImageGallery = forwardRef<ImageGalleryRef, ImageGalleryProps>(
  ({ refreshTrigger, namespace, onNamespaceChange }, ref) => {
  const getStoredPreferences = () => {
    if (typeof window === 'undefined') {
      return {
        variant: 'public',
        onlyCanonical: false,
        respectAspectRatio: false,
        onlyWithVariants: false,
        selectedFolder: 'all',
        selectedTag: '',
        searchTerm: '',
        viewMode: 'grid' as 'grid' | 'list',
        filtersCollapsed: false,
        bulkFolderInput: '',
        bulkFolderMode: 'existing' as 'existing' | 'new',
        showDuplicatesOnly: false,
        showBrokenOnly: false,
        pageSize: DEFAULT_PAGE_SIZE,
        dateFilter: null as DateFilter | null,
        currentPage: 1
      };
    }
    try {
      const stored = window.localStorage.getItem('galleryPreferences');
      if (stored) {
        const parsed = JSON.parse(stored) as {
          variant?: string;
          onlyCanonical?: boolean;
          respectAspectRatio?: boolean;
          onlyWithVariants?: boolean;
          selectedFolder?: string;
          selectedTag?: string;
          searchTerm?: string;
          viewMode?: 'grid' | 'list';
          filtersCollapsed?: boolean;
          showDuplicatesOnly?: boolean;
          showBrokenOnly?: boolean;
          pageSize?: number;
          dateFilter?: { year: number; month: number } | null;
          currentPage?: number;
        };
        const rawPageSize = typeof parsed.pageSize === 'number' ? parsed.pageSize : DEFAULT_PAGE_SIZE;
        const normalizedPageSize = PAGE_SIZE_OPTIONS.includes(rawPageSize)
          ? rawPageSize
          : DEFAULT_PAGE_SIZE;
        const storedVariant = typeof parsed.variant === 'string' ? parsed.variant : 'full';
        const normalizedVariant = storedVariant === 'public' || storedVariant === 'original'
          ? 'full'
          : storedVariant;
        const normalizedDateFilter = (() => {
          if (!parsed.dateFilter || typeof parsed.dateFilter !== 'object') return null;
          const year = (parsed.dateFilter as { year?: number }).year;
          const month = (parsed.dateFilter as { month?: number }).month;
          if (typeof year !== 'number' || typeof month !== 'number') return null;
          if (month < 0 || month > 11) return null;
          return { year, month };
        })();
        const normalizedCurrentPage = typeof parsed.currentPage === 'number' && parsed.currentPage > 0
          ? Math.floor(parsed.currentPage)
          : 1;
        return {
          variant: normalizedVariant,
          onlyCanonical: Boolean(parsed.onlyCanonical),
          respectAspectRatio: Boolean(parsed.respectAspectRatio),
          onlyWithVariants: Boolean(parsed.onlyWithVariants),
          selectedFolder: parsed.selectedFolder ?? 'all',
          selectedTag: parsed.selectedTag ?? '',
          searchTerm: parsed.searchTerm ?? '',
          viewMode: parsed.viewMode === 'list' ? 'list' : 'grid',
          filtersCollapsed: Boolean(parsed.filtersCollapsed),
          bulkFolderInput: typeof parsed.bulkFolderInput === 'string' ? parsed.bulkFolderInput : '',
          bulkFolderMode: parsed.bulkFolderMode === 'new' ? 'new' : 'existing',
          showDuplicatesOnly: Boolean(parsed.showDuplicatesOnly),
          showBrokenOnly: Boolean(parsed.showBrokenOnly),
          pageSize: normalizedPageSize,
          dateFilter: normalizedDateFilter,
          currentPage: normalizedCurrentPage
        };
      }
    } catch (error) {
      console.warn('Failed to parse gallery preferences', error);
    }
    return {
      variant: 'full',
      onlyCanonical: false,
      respectAspectRatio: false,
      onlyWithVariants: false,
      selectedFolder: 'all',
      selectedTag: '',
      searchTerm: '',
      viewMode: 'grid',
      filtersCollapsed: false,
      bulkFolderInput: '',
      bulkFolderMode: 'existing',
      showDuplicatesOnly: false,
      showBrokenOnly: false,
      pageSize: DEFAULT_PAGE_SIZE,
      dateFilter: null as DateFilter | null,
      currentPage: 1
    };
  };

  const storedPreferencesRef = useRef(getStoredPreferences());

  const [images, setImages] = useState<CloudflareImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVariant, setSelectedVariant] = useState<string>(storedPreferencesRef.current.variant);
  const [openCopyMenu, setOpenCopyMenu] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>(storedPreferencesRef.current.selectedFolder ?? 'all');
  const [searchTerm, setSearchTerm] = useState<string>(storedPreferencesRef.current.searchTerm ?? '');
  const [selectedTag, setSelectedTag] = useState<string>(storedPreferencesRef.current.selectedTag ?? '');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(storedPreferencesRef.current.viewMode ?? 'grid');
  const [embeddingPendingMap, setEmbeddingPendingMap] = useState<Record<string, EmbeddingPendingEntry>>({});
  const [currentPage, setCurrentPage] = useState(storedPreferencesRef.current.currentPage ?? 1);
  const [onlyCanonical, setOnlyCanonical] = useState(storedPreferencesRef.current.onlyCanonical);
  const [respectAspectRatio, setRespectAspectRatio] = useState(storedPreferencesRef.current.respectAspectRatio);
  const [onlyWithVariants, setOnlyWithVariants] = useState(storedPreferencesRef.current.onlyWithVariants);
  const [hiddenFolders, setHiddenFolders] = useState<string[]>(() => loadHiddenFoldersFromStorage());
  const [hiddenTags, setHiddenTags] = useState<string[]>(() => loadHiddenTagsFromStorage());
  const [filtersCollapsed, setFiltersCollapsed] = useState(storedPreferencesRef.current.filtersCollapsed ?? false);
  const [bulkSelectionMode, setBulkSelectionMode] = useState(false);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(() => new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkFolderInput, setBulkFolderInput] = useState<string>(storedPreferencesRef.current.bulkFolderInput ?? '');
  const [bulkFolderMode, setBulkFolderMode] = useState<'existing' | 'new'>(storedPreferencesRef.current.bulkFolderMode ?? 'existing');
  const [bulkTagsInput, setBulkTagsInput] = useState('');
  const [bulkApplyFolder, setBulkApplyFolder] = useState(true);
  const [bulkApplyTags, setBulkApplyTags] = useState(false);
  const [bulkTagsMode, setBulkTagsMode] = useState<'replace' | 'append'>('replace');
  const [bulkApplyDisplayName, setBulkApplyDisplayName] = useState(false);
  const [bulkDisplayNameMode, setBulkDisplayNameMode] = useState<'custom' | 'auto' | 'clear'>('custom');
  const [bulkDisplayNameInput, setBulkDisplayNameInput] = useState('');
  const [bulkApplyNamespace, setBulkApplyNamespace] = useState(false);
  const [bulkNamespaceInput, setBulkNamespaceInput] = useState('');
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkEmbeddingGenerating, setBulkEmbeddingGenerating] = useState(false);
  const [bulkAnimateFps, setBulkAnimateFps] = useState<string>('');
  const [bulkAnimateTouched, setBulkAnimateTouched] = useState(false);
  const [bulkAnimateLoop, setBulkAnimateLoop] = useState(true);
  const [bulkAnimateFilename, setBulkAnimateFilename] = useState('');
  const [bulkAnimateLoading, setBulkAnimateLoading] = useState(false);
  const [bulkAnimateError, setBulkAnimateError] = useState<string | null>(null);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState<boolean>(storedPreferencesRef.current.showDuplicatesOnly ?? false);
  const [showBrokenOnly, setShowBrokenOnly] = useState<boolean>(storedPreferencesRef.current.showBrokenOnly ?? false);
  const [embeddingFilter, setEmbeddingFilter] = useState<'none' | 'missing-clip' | 'missing-color' | 'missing-any'>('none');
  const [dateFilter, setDateFilter] = useState<DateFilter | null>(storedPreferencesRef.current.dateFilter ?? null);
  const [pageSize, setPageSize] = useState<number>(storedPreferencesRef.current.pageSize ?? DEFAULT_PAGE_SIZE);
  const [brokenAudit, setBrokenAudit] = useState<BrokenAudit>(() => loadBrokenAuditFromStorage());
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditProgress, setAuditProgress] = useState({ checked: 0, total: 0 });
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [refreshingCache, setRefreshingCache] = useState(false);
  const [namespaceSettingsOpen, setNamespaceSettingsOpen] = useState(false);
  const [namespaceDraft, setNamespaceDraft] = useState(namespace ?? '');
  const [namespaceSelectValue, setNamespaceSelectValue] = useState('');
  const [registryNamespaces, setRegistryNamespaces] = useState<string[]>([]);
  const [colorMetadataMap, setColorMetadataMap] = useState<Record<string, { dominantColors?: string[]; averageColor?: string }>>({});
  const didInitFilterPageRef = useRef(false);
  const utilityButtonClasses = 'text-[0.65rem] font-mono px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 transition';

  useEffect(() => {
    const next = namespace ?? '';
    setNamespaceDraft(next === '__all__' ? '' : next);
    setNamespaceSelectValue(next || '');
  }, [namespace]);

  useEffect(() => {
    let active = true;
    fetch('/api/namespaces')
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        const payload = Array.isArray(data?.namespaces) ? data.namespaces : [];
        setRegistryNamespaces(payload.filter((entry: unknown) => typeof entry === 'string'));
      })
      .catch((error) => {
        console.warn('Failed to load namespace registry', error);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return subscribeEmbeddingPending(setEmbeddingPendingMap);
  }, []);

  // Clear stale pending status for images that already have embeddings
  useEffect(() => {
    for (const image of images) {
      if (image.hasClipEmbedding || image.hasColorEmbedding) {
        clearPendingIfHasEmbeddings(image.id, image.hasClipEmbedding, image.hasColorEmbedding);
      }
    }
  }, [images]);

  const namespaceOptions = useMemo(() => {
    const rawSeen = new Set(images.map((image) => image.namespace).filter(Boolean));
    const envDefault = process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
    const knownRaw = process.env.NEXT_PUBLIC_KNOWN_NAMESPACES || '';
    const registryRaw = registryNamespaces;
    
    // Explicitly known items
    const defaults = new Set<string>();
    if (envDefault) defaults.add(envDefault);
    
    // Configured known items
    const known = new Set<string>();
    knownRaw.split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
      // Don't duplicate if it's already the default
      if (!defaults.has(s)) known.add(s);
    });

    const registry = new Set<string>();
    registryRaw.map((entry) => entry.trim()).filter(Boolean).forEach((entry) => {
      if (!defaults.has(entry) && !known.has(entry)) {
        registry.add(entry);
      }
    });

    // Discovered from current image set
    const discovered = new Set<string>();
    rawSeen.forEach(s => {
      if (!defaults.has(s) && !known.has(s) && !registry.has(s)) {
        discovered.add(s);
      }
    });

    const options = [
      { value: '__all__', label: 'All namespaces' },
      { value: '', label: '(no namespace)' },
    ];

    if (defaults.size > 0) {
      defaults.forEach(val => options.push({ value: val, label: `${val} (default)` }));
    }

    if (known.size > 0) {
      const sorted = Array.from(known).sort();
      sorted.forEach(val => options.push({ value: val, label: val }));
    }

    if (registry.size > 0) {
      const sorted = Array.from(registry).sort();
      sorted.forEach(val => options.push({ value: val, label: `${val} (registry)` }));
    }

    if (discovered.size > 0) {
      const sorted = Array.from(discovered).sort();
      sorted.forEach(val => options.push({ value: val, label: `${val} (discovered)` }));
    }

    options.push({ value: '__custom__', label: 'Enter manually...' });

    // Ensure the currently selected one is present if it wasn't covered above
    if (namespace && !options.some((opt) => opt.value === namespace) && namespace !== '__custom__') {
       // Check if we haven't added it (it might be __none__ which maps to '')
       options.splice(options.length - 1, 0, { value: namespace, label: namespace });
    }

    return options;
  }, [images, namespace, registryNamespaces]);

  const namespaceLabel = namespace === '__all__' ? 'All namespaces' : namespace;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('galleryPreferences', JSON.stringify({
        onlyCanonical,
        respectAspectRatio,
        variant: selectedVariant,
        onlyWithVariants,
        selectedFolder,
        selectedTag,
        searchTerm,
        viewMode,
        filtersCollapsed,
        bulkFolderInput,
        bulkFolderMode,
        showDuplicatesOnly,
        showBrokenOnly,
        pageSize,
        dateFilter,
        currentPage
      }));
    } catch (error) {
      console.warn('Failed to save gallery prefs', error);
    }
  }, [onlyCanonical, respectAspectRatio, selectedVariant, onlyWithVariants, selectedFolder, selectedTag, searchTerm, viewMode, filtersCollapsed, bulkFolderInput, bulkFolderMode, showDuplicatesOnly, showBrokenOnly, pageSize, dateFilter, currentPage]);
  useEffect(() => {
    persistHiddenFolders(hiddenFolders);
  }, [hiddenFolders]);
  useEffect(() => {
    persistHiddenTags(hiddenTags);
  }, [hiddenTags]);
  useEffect(() => {
    persistBrokenAudit(brokenAudit);
  }, [brokenAudit]);
  useEffect(() => {
    setSelectedImageIds(prev => {
      if (!prev.size) return prev;
      const validIds = new Set(images.map(img => img.id));
      const next = new Set<string>();
      prev.forEach(id => {
        if (validIds.has(id)) {
          next.add(id);
        }
      });
      return next;
    });
  }, [images]);
  useEffect(() => {
    if (!brokenAudit.ids.length) {
      return;
    }
    const validIds = new Set(images.map(img => img.id));
    setBrokenAudit(prev => {
      const filtered = prev.ids.filter(id => validIds.has(id));
      if (filtered.length === prev.ids.length) {
        return prev;
      }
      return { ...prev, ids: filtered };
    });
  }, [images, brokenAudit.ids.length]);
  useEffect(() => {
    if (
      selectedFolder !== 'all' &&
      selectedFolder !== 'no-folder' &&
      hiddenFolders.includes(selectedFolder)
    ) {
      setSelectedFolder('all');
    }
  }, [hiddenFolders, selectedFolder]);
  const [editingImage, setEditingImage] = useState<string | null>(null);
  const [editTags, setEditTags] = useState<string>('');
  const [editFolderSelect, setEditFolderSelect] = useState<string>('');
  const [newEditFolder, setNewEditFolder] = useState<string>('');
  const [altLoadingMap, setAltLoadingMap] = useState<Record<string, boolean>>({});
  
  // Hover preview state
  const [hoveredImage, setHoveredImage] = useState<string | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [showPreview, setShowPreview] = useState(false);
  const [utilityExpanded, setUtilityExpanded] = useState(false);
  const galleryTopRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollGalleryToTop = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const targetTop = galleryTopRef.current?.offsetTop ?? 0;
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }, []);
  const scrollToUploader = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const uploaderSection = document.getElementById('uploader-section');
    if (uploaderSection) {
      uploaderSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Refresh when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchImages({ silent: true }); // Silent refresh
    }
  }, [refreshTrigger]);

  const prevNamespaceRef = useRef(namespace);

  useEffect(() => {
    // Reset filters when namespace changes to avoid "empty" views due to stale filters
    if (prevNamespaceRef.current !== namespace) {
      setSelectedFolder('all');
      setSelectedTag('');
      setSearchTerm('');
      setOnlyCanonical(false); // Disable "Parents Only" as it might hide orphaned variants in the new namespace
      prevNamespaceRef.current = namespace;
    }

    // Cancel any pending request for the previous namespace
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    fetchImages();
  }, [namespace]);

  // Expose the refresh function via ref
  useImperativeHandle(ref, () => ({
    refreshImages: () => fetchImages({ silent: true }) // Silent refresh for better UX
  }));

  const fetchImages = async ({
    silent = false,
    forceRefresh = false
  }: { silent?: boolean; forceRefresh?: boolean } = {}) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (!silent) {
      setLoading(true);
    }
    if (forceRefresh) {
      setRefreshingCache(true);
    }
    try {
      const params = new URLSearchParams();
      if (forceRefresh) {
        params.set('refresh', '1');
      }
      if (namespace === '') {
        params.set('namespace', '__none__');
      } else if (namespace === '__all__') {
        params.set('namespace', '__all__');
      } else if (namespace && namespace !== '__all__') {
        params.set('namespace', namespace);
      }
      const query = params.toString();
      const url = query ? `/api/images?${query}` : '/api/images';
      const response = await fetch(url, { signal: controller.signal });
      const data = await response.json();
      if (response.ok) {
        // Deduplicate images by ID to prevent duplicate key errors in React
        const rawImages = data.images || [];
        const seen = new Set<string>();
        const uniqueImages = rawImages.filter((img: CloudflareImage) => {
          if (seen.has(img.id)) return false;
          seen.add(img.id);
          return true;
        });
        setImages(uniqueImages);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error('Failed to fetch images:', error);
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
        if (forceRefresh) {
          setRefreshingCache(false);
        }
      }
    }
  };
  const handleFoldersChanged = async () => {
    await fetchImages({ silent: true });
  };

  // Fetch color metadata from Redis for displayed images
  useEffect(() => {
    if (images.length === 0) return;
    
    const fetchColorMetadata = async () => {
      try {
        // Only fetch for images we don't already have metadata for
        const idsToFetch = images
          .filter(img => !colorMetadataMap[img.id])
          .map(img => img.id);
        
        if (idsToFetch.length === 0) return;
        
        // Batch in chunks of 100
        const chunkSize = 100;
        for (let i = 0; i < idsToFetch.length; i += chunkSize) {
          const chunk = idsToFetch.slice(i, i + chunkSize);
          const response = await fetch(`/api/images/colors?ids=${chunk.join(',')}`);
          if (response.ok) {
            const data = await response.json();
            if (data.colors) {
              setColorMetadataMap(prev => ({ ...prev, ...data.colors }));
            }
          }
        }
      } catch (error) {
        console.warn('Failed to fetch color metadata:', error);
      }
    };
    
    fetchColorMetadata();
  }, [images]);

  const deleteImage = async (imageId: string) => {
    try {
      const response = await fetch(`/api/images/${imageId}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setImages(prev => prev.filter(img => img.id !== imageId));
      }
    } catch (error) {
      console.error('Failed to delete image:', error);
    }
  };

  const generateAltTag = async (imageId: string) => {
    setAltLoadingMap(prev => ({ ...prev, [imageId]: true }));
    try {
      const response = await fetch(`/api/images/${imageId}/alt`, {
        method: 'POST',
      });
      const data = await response.json();

      if (!response.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to generate ALT text';
        toast.push(message);
        return;
      }

      if (!data?.altTag) {
        toast.push('ALT text response was empty');
        return;
      }

      setImages(prev => prev.map(img => (img.id === imageId ? { ...img, altTag: data.altTag } : img)));
      toast.push('ALT text updated');
    } catch (error) {
      console.error('Failed to generate ALT text:', error);
      toast.push('Failed to generate ALT text');
    } finally {
      setAltLoadingMap(prev => {
        const next = { ...prev };
        delete next[imageId];
        return next;
      });
    }
  };

  const startEdit = (image: CloudflareImage) => {
    setEditingImage(image.id);
    setEditFolderSelect(image.folder || '');
    setNewEditFolder('');
    setEditTags(image.tags ? image.tags.join(', ') : '');
  };

  const cancelEdit = () => {
    setEditingImage(null);
    setEditFolderSelect('');
    setNewEditFolder('');
    setEditTags('');
  };

  const saveEdit = async (imageId: string) => {
    try {
      const finalFolder = editFolderSelect === '__create__' ? (newEditFolder.trim() || undefined) : (editFolderSelect === '' ? undefined : editFolderSelect);

      const response = await fetch(`/api/images/${imageId}/update`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          folder: finalFolder,
          tags: editTags.trim() ? editTags.split(',').map(t => t.trim()) : []
        })
      });

      if (response.ok) {
        // Update the local state
        setImages(prev => prev.map(img => 
          img.id === imageId 
            ? { 
                ...img, 
                folder: finalFolder,
                tags: editTags.trim() ? editTags.split(',').map(t => t.trim()) : []
              }
            : img
        ));
        cancelEdit();
      } else {
        alert('Failed to update image metadata');
      }
    } catch (error) {
      console.error('Failed to update image:', error);
      alert('Failed to update image metadata');
    }
  };

  const toast = useToast();
  const brokenImageIds = useMemo(() => new Set(brokenAudit.ids), [brokenAudit.ids]);

  const runBrokenAudit = useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }
    setAuditLoading(true);
    setAuditEntries([]);
    setAuditProgress({ checked: 0, total: images.length });
    try {
      const chunkSize = 50;
      const total = images.length;
      const brokenIds = new Set<string>();
      let offset = 0;
      while (offset < total) {
        const url = new URL('/api/images/audit', window.location.origin);
        url.searchParams.set('variant', selectedVariant);
        url.searchParams.set('offset', String(offset));
        url.searchParams.set('limit', String(chunkSize));
        url.searchParams.set('verbose', '1');
        const response = await fetch(url.toString());
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || 'Audit request failed');
        }
        const payload = await response.json();
        const results = Array.isArray(payload.results) ? payload.results : [];
        const batchBroken = Array.isArray(payload.broken) ? payload.broken : [];
        batchBroken.forEach((entry: { id?: string }) => {
          if (entry?.id) {
            brokenIds.add(entry.id);
          }
        });
        setAuditEntries(prev => {
          const combined = [...prev, ...results];
          return combined.length > AUDIT_LOG_LIMIT
            ? combined.slice(combined.length - AUDIT_LOG_LIMIT)
            : combined;
        });
        const checkedCount = Number.isFinite(payload.checked) ? payload.checked : results.length || chunkSize;
        const nextChecked = Math.min(total, offset + checkedCount);
        setAuditProgress({ checked: nextChecked, total });
        offset += chunkSize;
      }
      setBrokenAudit({
        checkedAt: new Date().toISOString(),
        ids: Array.from(brokenIds)
      });
      toast.push(
        brokenIds.size
          ? `Audit complete: ${brokenIds.size} broken URL(s) found`
          : 'Audit complete: no broken URLs detected'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Audit failed';
      console.error('Broken URL audit failed', error);
      toast.push(message);
    } finally {
      setAuditLoading(false);
    }
  }, [images.length, selectedVariant, toast]);

  const copyToClipboard = async (url: string, label?: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        toast.push(label ? `${label} URL copied` : 'URL copied to clipboard');
        return;
      }

      const textArea = document.createElement('textarea');
      textArea.value = url;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      try {
        document.execCommand('copy');
        toast.push(label ? `${label} URL copied` : 'URL copied to clipboard');
      } catch (fallbackErr) {
        console.error('Fallback copy failed: ', fallbackErr);
        prompt('Copy this URL manually:', url);
      }

      document.body.removeChild(textArea);
    } catch (err) {
      console.error('Failed to copy: ', err);
      prompt('Copy this URL manually:', url);
    }
  };

  const formatCopyPayload = (url: string, altText?: string, includeAlt?: boolean) => {
    if (!includeAlt) {
      return url;
    }
    return `url: ${JSON.stringify(url)},\naltText: ${JSON.stringify(altText ?? '')}`;
  };

  const handleCopyUrl = async (
    event: React.MouseEvent<HTMLButtonElement>,
    url: string,
    label?: string,
    altText?: string
  ) => {
    const payload = formatCopyPayload(url, altText, event.shiftKey);
    await copyToClipboard(payload, label);
  };

  const downloadVariantToFile = async (url: string, filenameHint?: string) => {
    try {
      const downloadName = formatDownloadFileName(filenameHint);
      await downloadImageToFile(url, downloadName);
      toast.push('Download started');
    } catch (error) {
      console.error('Failed to download image', error);
      toast.push('Failed to download image');
    }
  };

  // Hover preview handlers
  const handleMouseEnter = (imageId: string, event: React.MouseEvent) => {
    if (!(event.nativeEvent as MouseEvent).shiftKey) {
      setShowPreview(false);
      return;
    }
    setHoveredImage(imageId);
    setMousePosition({ x: event.clientX, y: event.clientY });
    setShowPreview(true);
  };

  const handleMouseMove = (imageId: string, event: React.MouseEvent) => {
    if (!(event.nativeEvent as MouseEvent).shiftKey) {
      setShowPreview(false);
      return;
    }
    if (hoveredImage !== imageId) {
      setHoveredImage(imageId);
    }
    setMousePosition({ x: event.clientX, y: event.clientY });
    setShowPreview(true);
  };

  const handleMouseLeave = () => {
    setHoveredImage(null);
    setShowPreview(false);
  };

  const hideFolderByName = useCallback((folderName: string) => {
    const sanitized = folderName.trim();
    if (!sanitized) {
      return false;
    }
    let added = false;
    setHiddenFolders(prev => {
      if (prev.includes(sanitized)) {
        return prev;
      }
      added = true;
      return [...prev, sanitized];
    });
    return added;
  }, []);

  const unhideFolderByName = useCallback((folderName: string) => {
    const sanitized = folderName.trim();
    if (!sanitized) {
      return false;
    }
    let removed = false;
    setHiddenFolders(prev => {
      if (!prev.includes(sanitized)) {
        return prev;
      }
      removed = true;
      return prev.filter(folder => folder !== sanitized);
    });
    return removed;
  }, []);

  const clearHiddenFolders = useCallback(() => {
    if (hiddenFolders.length === 0) {
      return false;
    }
    setHiddenFolders([]);
    return true;
  }, [hiddenFolders]);

  const hideTagByName = useCallback((tagName: string) => {
    const sanitized = tagName.trim();
    if (!sanitized) {
      return false;
    }
    const normalized = sanitized.toLowerCase();
    let added = false;
    setHiddenTags(prev => {
      if (prev.some(tag => tag.toLowerCase() === normalized)) {
        return prev;
      }
      added = true;
      return [...prev, sanitized];
    });
    return added;
  }, []);

  const unhideTagByName = useCallback((tagName: string) => {
    const sanitized = tagName.trim();
    if (!sanitized) {
      return false;
    }
    const normalized = sanitized.toLowerCase();
    let removed = false;
    setHiddenTags(prev => {
      if (!prev.some(tag => tag.toLowerCase() === normalized)) {
        return prev;
      }
      removed = true;
      return prev.filter(tag => tag.toLowerCase() !== normalized);
    });
    return removed;
  }, []);

  const clearHiddenTags = useCallback(() => {
    if (hiddenTags.length === 0) {
      return false;
    }
    setHiddenTags([]);
    return true;
  }, [hiddenTags]);

  const selectedCount = selectedImageIds.size;

  useEffect(() => {
    if (bulkAnimateTouched) return;
    if (selectedCount === 0) {
      setBulkAnimateFps('');
      return;
    }
    const next = Math.max(1, selectedCount / 2);
    setBulkAnimateFps(next.toString());
  }, [bulkAnimateTouched, selectedCount]);

  const toggleSelection = useCallback((imageId: string) => {
    setSelectedImageIds(prev => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedImageIds(new Set());
  }, []);

  const selectAllOnPage = useCallback((pageItems: CloudflareImage[]) => {
    setSelectedImageIds(prev => {
      const next = new Set(prev);
      pageItems.forEach(item => next.add(item.id));
      return next;
    });
  }, []);


  useEffect(() => {
    if (!bulkSelectionMode && selectedImageIds.size) {
      clearSelection();
    }
  }, [bulkSelectionMode, selectedImageIds.size, clearSelection]);

  const openBulkEditModal = useCallback(() => {
    if (!selectedCount) {
      toast.push('Select at least one image');
      return;
    }
    setBulkFolderInput('');
    setBulkTagsInput('');
    setBulkApplyFolder(false);
    setBulkApplyTags(true);
    setBulkTagsMode('append');
    setBulkApplyDisplayName(false);
    setBulkDisplayNameMode('custom');
    setBulkDisplayNameInput('');
    setBulkApplyNamespace(false);
    setBulkNamespaceInput('');
    setBulkAnimateFilename('');
    setBulkAnimateLoop(true);
    setBulkAnimateTouched(false);
    setBulkAnimateError(null);
    setBulkEditOpen(true);
  }, [selectedCount, toast]);

  const closeBulkEditModal = useCallback(() => {
    setBulkEditOpen(false);
  }, []);

  const applyBulkUpdates = useCallback(async () => {
    if (!selectedCount) {
      toast.push('No images selected');
      return;
    }
    const parsedBulkTags = bulkTagsInput
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean);
    const hasTagChanges =
      bulkApplyTags &&
      (bulkTagsMode === 'replace' || parsedBulkTags.length > 0);
    const hasDisplayNameChanges = bulkApplyDisplayName;
    const hasNamespaceChanges = bulkApplyNamespace;
    if (!bulkApplyFolder && !hasTagChanges && !hasDisplayNameChanges && !hasNamespaceChanges) {
      toast.push('Choose at least one field to update');
      return;
    }
    setBulkUpdating(true);
    try {
      await Promise.all(
        Array.from(selectedImageIds).map(id => {
          const payload: Record<string, unknown> = {};
          if (bulkApplyFolder) {
            if (bulkFolderMode === 'existing') {
              payload.folder = bulkFolderInput || undefined;
            } else if (bulkFolderMode === 'new') {
              payload.folder = bulkFolderInput.trim() || undefined;
            }
          }
          if (bulkApplyTags) {
            if (bulkTagsMode === 'replace') {
              payload.tags = bulkTagsInput;
            } else if (parsedBulkTags.length > 0) {
              const target = images.find(img => img.id === id);
              const existingTags = Array.isArray(target?.tags) ? target.tags : [];
              const merged = new Map<string, string>();
              existingTags.forEach(tag => merged.set(tag.toLowerCase(), tag));
              parsedBulkTags.forEach(tag => merged.set(tag.toLowerCase(), tag));
              payload.tags = Array.from(merged.values());
            }
          }
          if (bulkApplyDisplayName) {
            if (bulkDisplayNameMode === 'clear') {
              payload.displayName = '';
            } else if (bulkDisplayNameMode === 'custom') {
              payload.displayName = bulkDisplayNameInput.trim();
            } else if (bulkDisplayNameMode === 'auto') {
              const target = images.find(img => img.id === id);
              const baseName = target?.filename || '';
              payload.displayName = truncateMiddle(baseName, 64);
            }
          }
          if (bulkApplyNamespace) {
            payload.namespace = bulkNamespaceInput.trim() || '';
          }
          return fetch(`/api/images/${id}/update`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        })
      );
      setImages(prev =>
        prev.map(img => {
          if (!selectedImageIds.has(img.id)) {
            return img;
          }
          const updatedFolder =
            bulkApplyFolder &&
            (bulkFolderMode === 'existing'
              ? bulkFolderInput || undefined
              : bulkFolderInput.trim() || undefined);
          let updatedTags = img.tags;
          if (bulkApplyTags) {
            if (bulkTagsMode === 'replace') {
              updatedTags = parsedBulkTags;
            } else if (parsedBulkTags.length > 0) {
              const merged = new Map<string, string>();
              (img.tags ?? []).forEach(tag => merged.set(tag.toLowerCase(), tag));
              parsedBulkTags.forEach(tag => merged.set(tag.toLowerCase(), tag));
              updatedTags = Array.from(merged.values());
            }
          }
          let updatedDisplayName = img.displayName;
          if (bulkApplyDisplayName) {
            if (bulkDisplayNameMode === 'clear') {
              updatedDisplayName = '';
            } else if (bulkDisplayNameMode === 'custom') {
              updatedDisplayName = bulkDisplayNameInput.trim();
            } else if (bulkDisplayNameMode === 'auto') {
              updatedDisplayName = truncateMiddle(img.filename || '', 64);
            }
          }
          const updatedNamespace = bulkApplyNamespace ? (bulkNamespaceInput.trim() || undefined) : img.namespace;

          return {
            ...img,
            folder: bulkApplyFolder ? updatedFolder : img.folder,
            tags: updatedTags,
            displayName: updatedDisplayName,
            namespace: updatedNamespace
          };
        })
      );
      toast.push('Images updated');
      clearSelection();
      setBulkSelectionMode(false);
      setBulkEditOpen(false);
    } catch (error) {
      console.error('Bulk update failed', error);
      toast.push('Bulk update failed');
    } finally {
      setBulkUpdating(false);
    }
  }, [
    bulkApplyFolder,
    bulkApplyTags,
    bulkFolderInput,
    bulkTagsInput,
    bulkTagsMode,
    bulkApplyDisplayName,
    bulkDisplayNameInput,
    bulkDisplayNameMode,
    bulkApplyNamespace,
    bulkNamespaceInput,
    images,
    selectedCount,
    selectedImageIds,
    toast,
    clearSelection
  ]);

  const createBulkAnimation = useCallback(async () => {
    if (selectedCount < 2) {
      toast.push('Select at least two images');
      return;
    }
    const fpsValue = Number(bulkAnimateFps);
    if (!Number.isFinite(fpsValue) || fpsValue <= 0) {
      setBulkAnimateError('FPS must be greater than 0');
      return;
    }
    setBulkAnimateLoading(true);
    setBulkAnimateError(null);
    try {
      const response = await fetch('/api/animate/selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selectedImageIds),
          fps: fpsValue,
          loop: bulkAnimateLoop,
          filename: bulkAnimateFilename.trim() || undefined,
          namespace: namespace && namespace !== '__all__' ? namespace : undefined
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create animation');
      }
      toast.push('Animated WebP created');
      await fetchImages({ forceRefresh: true });
    } catch (error) {
      console.error('Bulk animation failed', error);
      setBulkAnimateError(error instanceof Error ? error.message : 'Failed to create animation');
    } finally {
      setBulkAnimateLoading(false);
    }
  }, [
    bulkAnimateFps,
    bulkAnimateFilename,
    bulkAnimateLoop,
    fetchImages,
    namespace,
    selectedCount,
    selectedImageIds,
    toast
  ]);

  const deleteSelectedImages = useCallback(async () => {
    if (!selectedCount) {
      toast.push('Select images to delete');
      return;
    }
    const confirmed =
      typeof window === 'undefined'
        ? true
        : window.confirm(
            `Delete ${selectedCount} image${selectedCount === 1 ? '' : 's'}? This cannot be undone.`
          );
    if (!confirmed) {
      return;
    }
    setBulkDeleting(true);
    try {
      await Promise.all(
        Array.from(selectedImageIds).map(id =>
          fetch(`/api/images/${id}`, {
            method: 'DELETE'
          })
        )
      );
      setImages(prev => prev.filter(img => !selectedImageIds.has(img.id)));
      toast.push('Images deleted');
      clearSelection();
      setBulkSelectionMode(false);
    } catch (error) {
      console.error('Bulk delete failed', error);
      toast.push('Bulk delete failed');
    } finally {
      setBulkDeleting(false);
    }
  }, [selectedCount, selectedImageIds, toast, clearSelection]);

  const generateEmbeddingsForSelected = useCallback(async () => {
    if (!selectedCount) {
      toast.push('Select images to generate embeddings');
      return;
    }
    
    setBulkEmbeddingGenerating(true);
    try {
      const imageIds = Array.from(selectedImageIds);
      const response = await fetch('/api/images/embeddings/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageIds }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate embeddings');
      }
      
      const result = await response.json();
      
      // Update local state with embedding flags
      setImages(prev => prev.map(img => {
        if (selectedImageIds.has(img.id)) {
          const imgResult = result.results?.find((r: { imageId: string }) => r.imageId === img.id);
          if (imgResult?.success && !imgResult?.skipped) {
            return {
              ...img,
              hasClipEmbedding: imgResult.clipGenerated || img.hasClipEmbedding,
              hasColorEmbedding: imgResult.colorGenerated || img.hasColorEmbedding,
            };
          }
        }
        return img;
      }));
      
      toast.push(`Generated embeddings: ${result.success} success, ${result.skipped} skipped, ${result.errors} errors`);
    } catch (error) {
      console.error('Batch embedding generation failed', error);
      toast.push(error instanceof Error ? error.message : 'Embedding generation failed');
    } finally {
      setBulkEmbeddingGenerating(false);
    }
  }, [selectedCount, selectedImageIds, toast]);

  const getImageUrl = (image: CloudflareImage, variant: string) => {
    // Use the utility function with the variant string directly
    return getCloudflareImageUrl(image.id, variant === 'public' ? 'original' : variant);
  };

  // Helper function to get orientation icon based on aspect ratio
  const getOrientationIcon = (aspectRatioString: string) => {
    // Parse the aspect ratio to determine orientation
    const parts = aspectRatioString.split(':');
    if (parts.length === 2) {
      const width = parseFloat(parts[0]);
      const height = parseFloat(parts[1]);
      const ratio = width / height;
      
      if (Math.abs(ratio - 1) < 0.1) {
        // Square (1:1 or close)
        return (
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="inline-block">
            <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="0.8"/>
          </svg>
        );
      } else if (ratio > 1) {
        // Landscape (wider than tall)
        return (
          <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor" className="inline-block">
            <rect x="1" y="1" width="8" height="4" fill="none" stroke="currentColor" strokeWidth="0.8"/>
          </svg>
        );
      } else {
        // Portrait (taller than wide)
        return (
          <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor" className="inline-block">
            <rect x="1" y="1" width="4" height="8" fill="none" stroke="currentColor" strokeWidth="0.8"/>
          </svg>
        );
      }
    }
    
    // Default to square if we can't parse
    return (
      <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="inline-block">
        <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="0.8"/>
      </svg>
    );
  };

  // Component for displaying aspect ratio
  const AspectRatioDisplay: React.FC<{ imageId: string }> = ({ imageId }) => {
    const { aspectRatio, loading, error } = useImageAspectRatio(imageId);

    if (loading) {
      return (
        <p className="text-sm font-mono text-gray-400">
          📐 <span className="inline-block w-8 h-2 bg-gray-200 rounded animate-pulse"></span>
        </p>
      );
    }

    if (error || !aspectRatio) {
      return <p className="text-sm font-mono text-gray-400">📐 --</p>;
    }

    return (
      <p className="text-[0.6rem] font-mono text-gray-500 flex items-center gap-1">
        📐 {aspectRatio} {getOrientationIcon(aspectRatio)}
      </p>
    );
  };

  const VARIANT_PRESETS = ['small', 'medium', 'large', 'xlarge', 'full', 'thumbnail'];

  const getVariantUrls = (image: CloudflareImage) => {
    return getMultipleImageUrls(image.id, VARIANT_PRESETS);
  };
  const getVariantWidthLabel = (variant: string) => {
    const width = VARIANT_DIMENSIONS.get(variant);
    if (!width) {
      return null;
    }
    return `${width}px`;
  };

  const uniqueFolders = useMemo(() => {
    const folderNames = images
      .map(img => img.folder?.trim())
      .filter((folder): folder is string => Boolean(folder));
    return Array.from(new Set(folderNames)).sort((a, b) => a.localeCompare(b));
  }, [images]);
  const visibleFolders = useMemo(
    () => uniqueFolders.filter(folder => !hiddenFolders.includes(folder)),
    [uniqueFolders, hiddenFolders]
  );

  const childrenMap = useMemo(() => {
    const map: Record<string, CloudflareImage[]> = {};
    images.forEach(image => {
      if (image.parentId) {
        map[image.parentId] = [...(map[image.parentId] || []), image];
      }
    });
    return map;
  }, [images]);

  type DuplicateReason = 'originalUrl+contentHash';

  const normalizeUrlKey = (value?: string) => {
    if (!value) return undefined;
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return undefined;
      }
      const origin = `${parsed.protocol}//${parsed.host}`;
      return `${origin}${parsed.pathname || '/'}${parsed.search}`;
    } catch {
      return undefined;
    }
  };

  const normalizeHashKey = (value?: string) => {
    if (!value) return undefined;
    const trimmed = value.trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : undefined;
  };

  const truncateMiddle = (value: string, max = 64) => {
    if (value.length <= max) return value;
    const keep = max - 1;
    const head = Math.ceil(keep / 2);
    const tail = Math.floor(keep / 2);
    return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
  };

  // Move baseFilteredImages earlier so duplicateGroups can use the filtered list
  const baseFilteredImages = useMemo(() => {
    return filterImagesForGallery(images, {
      selectedFolder,
      selectedTag,
      searchTerm,
      onlyCanonical,
      hiddenFolders,
      hiddenTags
    });
  }, [images, selectedFolder, selectedTag, searchTerm, onlyCanonical, hiddenFolders, hiddenTags]);

  // Compute duplicates from the filtered images, not all images
  // This ensures "show duplicates only" shows duplicates within the current filter selection
  const duplicateGroups = useMemo(() => {
    const byKey = new Map<string, { items: CloudflareImage[]; reason: DuplicateReason }>();

    baseFilteredImages.forEach((image) => {
      const keyFromUrl = normalizeUrlKey(image.originalUrlNormalized);
      const keyFromHash = normalizeHashKey(image.contentHash);

      // Only consider duplicates when BOTH URL and content hash are present and match.
      if (!keyFromUrl || !keyFromHash) return;

      const reason: DuplicateReason = 'originalUrl+contentHash';
      const mapKey = `${keyFromUrl}|${keyFromHash}`;
      const existing = byKey.get(mapKey);
      if (existing) {
        existing.items.push(image);
      } else {
        byKey.set(mapKey, { items: [image], reason });
      }
    });

    return Array.from(byKey.entries())
      .filter(([, group]) => group.items.length > 1)
      .map(([key, group]) => ({
        key,
        reason: group.reason,
        label: 'Original URL + content hash',
        items: group.items
      }));
  }, [baseFilteredImages]);

  const duplicateIds = useMemo(() => {
    const ids = new Set<string>();
    duplicateGroups.forEach((group) => {
      group.items.forEach((image) => ids.add(image.id));
    });
    return ids;
  }, [duplicateGroups]);

  const duplicateGroupCount = duplicateGroups.length;
  const duplicateImageCount = duplicateIds.size;

  const selectDuplicateImages = useCallback(() => {
    if (!duplicateIds.size) {
      toast.push('No duplicates detected');
      return;
    }
    setBulkSelectionMode(true);
    setSelectedImageIds(prev => {
      const next = new Set(prev);
      duplicateIds.forEach(id => next.add(id));
      return next;
    });
    toast.push('Duplicate images selected');
  }, [duplicateIds, toast]);

  const selectDuplicatesKeepSingle = useCallback(
    (strategy: 'newest' | 'oldest') => {
      if (!duplicateGroups.length) {
        toast.push('No duplicates detected');
        return;
      }
      const idsToKeep = new Set<string>();
      duplicateGroups.forEach((group) => {
        const sorted = [...group.items].sort((a, b) =>
          strategy === 'newest'
            ? new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime()
            : new Date(a.uploaded).getTime() - new Date(b.uploaded).getTime()
        );
        if (sorted[0]) {
          idsToKeep.add(sorted[0].id);
        }
      });
      setBulkSelectionMode(true);
      setSelectedImageIds(() => {
        const next = new Set<string>();
        duplicateGroups.forEach((group) => {
          group.items.forEach((image) => {
            if (!idsToKeep.has(image.id)) {
              next.add(image.id);
            }
          });
        });
        return next;
      });
      toast.push(
        strategy === 'newest'
          ? 'Selected duplicates (keeping newest copy per filename)'
          : 'Selected duplicates (keeping oldest copy per filename)'
      );
    },
    [duplicateGroups, toast]
  );

  const uniqueTags = useMemo(() => {
    const tags = Array.from(
      new Set(images.flatMap(img => Array.isArray(img.tags) ? img.tags.filter(tag => tag && tag.trim()) : []))
    );
    return tags.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [images]);

  const folderFilterOptions = useMemo(
    () => [
      { value: 'all', label: 'All folders' },
      { value: 'no-folder', label: 'No folder' },
      ...visibleFolders.map(folder => ({ value: folder, label: folder as string }))
    ],
    [visibleFolders]
  );

  const variantOptions = useMemo(
    () => [
      { value: 'full', label: 'Full (No Resize)' },
      { value: 'w=300', label: 'Small (300px)' },
      { value: 'w=600', label: 'Medium (600px)' },
      { value: 'w=900', label: 'Large (900px)' },
      { value: 'w=1200', label: 'X-Large (1200px)' },
      { value: 'w=150', label: 'Thumbnail-ish (150px)' }
    ],
    []
  );

  const editFolderOptions = useMemo(
    () => [
      { value: '', label: '[none]' },
      ...uniqueFolders.map(folder => ({ value: folder as string, label: folder as string })),
      { value: '__create__', label: 'Create new folder...' }
    ],
    [uniqueFolders]
  );
  const bulkFolderOptions = useMemo(
    () => [
      { value: '', label: '[none]' },
      ...uniqueFolders.map(folder => ({ value: folder as string, label: folder as string })),
      { value: '__create__', label: 'Create new folder...' }
    ],
    [uniqueFolders]
  );

  const isSvgImage = (img: CloudflareImage) => img.filename?.toLowerCase().endsWith('.svg') ?? false;

  // baseFilteredImages is now computed earlier (before duplicateGroups) so duplicates
  // are detected within the current filter selection

  const duplicateFilteredImages = useMemo(() => {
    if (!showDuplicatesOnly) {
      return baseFilteredImages;
    }
    return baseFilteredImages.filter((image) => duplicateIds.has(image.id));
  }, [baseFilteredImages, showDuplicatesOnly, duplicateIds]);

  const duplicatesSortedByFilename = useMemo(() => {
    return showDuplicatesOnly
      ? [...duplicateFilteredImages].sort((a, b) =>
          (a.filename || '').localeCompare(b.filename || '')
        )
      : duplicateFilteredImages;
  }, [duplicateFilteredImages, showDuplicatesOnly]);

  const brokenFilteredImages = useMemo(() => {
    if (!showBrokenOnly) {
      return duplicatesSortedByFilename;
    }
    return duplicatesSortedByFilename.filter((image) => brokenImageIds.has(image.id));
  }, [duplicatesSortedByFilename, showBrokenOnly, brokenImageIds]);

  const embeddingFilteredImages = useMemo(() => {
    if (embeddingFilter === 'none') {
      return brokenFilteredImages;
    }
    return brokenFilteredImages.filter((image) => {
      if (embeddingFilter === 'missing-clip') {
        return !image.hasClipEmbedding;
      }
      if (embeddingFilter === 'missing-color') {
        return !image.hasColorEmbedding;
      }
      // missing-any
      return !image.hasClipEmbedding || !image.hasColorEmbedding;
    });
  }, [brokenFilteredImages, embeddingFilter]);

  const filteredWithVariants = useMemo(() => {
    if (!onlyWithVariants) {
      return embeddingFilteredImages;
    }
    const parentIdsWithChildren = new Set(
      Object.entries(childrenMap)
        .filter(([, value]) => (value?.length ?? 0) > 0)
        .map(([key]) => key)
    );
    return embeddingFilteredImages.filter(image => parentIdsWithChildren.has(image.id));
  }, [embeddingFilteredImages, onlyWithVariants, childrenMap]);

  const sortedImages = useMemo(() => {
    return [...filteredWithVariants].sort((a, b) => new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime());
  }, [filteredWithVariants]);

  // Apply date filter (month) if set
  const dateFilteredImages = useMemo(() => {
    if (!dateFilter) return sortedImages;
    return sortedImages.filter((image) => {
      const d = new Date(image.uploaded);
      return d.getFullYear() === dateFilter.year && d.getMonth() === dateFilter.month;
    });
  }, [sortedImages, dateFilter]);

  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
    selectedFolder !== 'all' ||
    selectedTag ||
    onlyCanonical ||
    respectAspectRatio ||
    onlyWithVariants ||
    showDuplicatesOnly ||
    showBrokenOnly ||
    hiddenFolders.length > 0 ||
    hiddenTags.length > 0 ||
    dateFilter !== null
  );

  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setSelectedFolder('all');
    setSelectedTag('');
    setOnlyCanonical(false);
    setRespectAspectRatio(false);
    setOnlyWithVariants(false);
    setShowDuplicatesOnly(false);
    setShowBrokenOnly(false);
    setHiddenFolders([]);
    setHiddenTags([]);
    setDateFilter(null);
  }, []);

  const totalPages = Math.max(1, Math.ceil(dateFilteredImages.length / pageSize));
  const pageIndex = Math.min(currentPage, totalPages);
  const pageSliceStart = (pageIndex - 1) * pageSize;
  const pageImages = dateFilteredImages.slice(pageSliceStart, pageSliceStart + pageSize);
  const showPagination = dateFilteredImages.length > pageSize;
  const hasResults = dateFilteredImages.length > 0;

  useEffect(() => {
    if (!didInitFilterPageRef.current) {
      didInitFilterPageRef.current = true;
      return;
    }
    setCurrentPage(1);
    scrollGalleryToTop();
  }, [selectedFolder, selectedTag, searchTerm, onlyWithVariants, showDuplicatesOnly, showBrokenOnly, pageSize, dateFilter, scrollGalleryToTop]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const formatDateRangeLabel = (items: CloudflareImage[]) => {
    if (!items.length) return null;

    const formatDate = (value: string) =>
      new Date(value).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });

    const newestLabel = formatDate(items[0].uploaded);
    const oldestLabel = formatDate(items[items.length - 1].uploaded);

    return newestLabel === oldestLabel ? newestLabel : `${newestLabel} - ${oldestLabel}`;
  };

  const getPageDateRangeLabel = (pageNumber: number) => {
    if (pageNumber < 1 || pageNumber > totalPages) return null;
    const startIndex = (pageNumber - 1) * pageSize;
    const slice = dateFilteredImages.slice(startIndex, startIndex + pageSize);
    return formatDateRangeLabel(slice);
  };

  const currentPageRangeLabel = formatDateRangeLabel(pageImages);
  const prevPageRangeLabel = getPageDateRangeLabel(pageIndex - 1);
  const nextPageRangeLabel = getPageDateRangeLabel(pageIndex + 1);

  const goToPageNumber = useCallback(
    (target: number) => {
      setCurrentPage(prev => {
        const next = Math.min(Math.max(1, target), totalPages);
        if (next !== prev) {
          scrollGalleryToTop();
        }
        return next;
      });
    },
    [scrollGalleryToTop, totalPages]
  );

  const goToPreviousPage = () => goToPageNumber(pageIndex - 1);
  const goToNextPage = () => goToPageNumber(pageIndex + 1);
  const goToFirstPage = () => goToPageNumber(1);
  const goToLastPage = () => goToPageNumber(totalPages);
  const jumpBackTenPages = () => goToPageNumber(pageIndex - 10);
  const jumpForwardTenPages = () => goToPageNumber(pageIndex + 10);

  const handleBulkFolderSelect = useCallback(
    (value: string) => {
      if (value === '__create__') {
        setBulkFolderMode('new');
        setBulkFolderInput('');
      } else {
        setBulkFolderMode('existing');
        setBulkFolderInput(value);
      }
    },
    [setBulkFolderInput, setBulkFolderMode]
  );

  useEffect(() => {
    scrollGalleryToTop();
  }, [scrollGalleryToTop]);

  if (loading) {
    return (
      <div id="image-gallery-loading" className="bg-white rounded-lg shadow-lg p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-300 rounded w-1/4 mb-4"></div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="aspect-square bg-gray-300 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="image-gallery-card" ref={galleryTopRef} className="overscroll-none bg-white rounded-lg shadow-lg p-6">
      <div
        id="gallery-top-bar"
        className="sticky top-0 z-20 -m-6 mb-6 p-6 pb-4 bg-white/95 backdrop-blur rounded-t-lg border-b border-gray-100"
      >
        <div className="flex flex-col gap-3 mb-4">
          <div id="first-row-controls" className="flex flex-wrap items-center justify-between gap-4">
            <div>
            <p className="text-[0.7em] font-mono font-mono text-gray-900">
              Image Gallery ({filteredWithVariants.length}/{images.length})
            </p>
            {namespace && (
              <p className="font-mono text-[0.7em] text-gray-500">Namespace: {namespaceLabel}</p>
            )}
            {showPagination && currentPageRangeLabel && (
              <p className="font-mono text-[0.7em] font-mono text-gray-500">
                Showing uploads from {currentPageRangeLabel}
              </p>
            )}
          </div>
            {showPagination && (
              <div className="flex items-center gap-2 text-[0.7em] font-mono text-gray-600">
                <button
                  onClick={goToFirstPage}
                  disabled={pageIndex === 1}
                  className="px-3 py-1 border rounded-md disabled:opacity-40"
                  title="First page"
                >
                  First
                </button>
                <button
                  onClick={jumpBackTenPages}
                  disabled={pageIndex === 1}
                  className="px-3 py-1 border rounded-md disabled:opacity-40"
                  title="Back 10 pages"
                >
                  -10
                </button>
                <button
                  onClick={goToPreviousPage}
                  disabled={pageIndex === 1}
                  className="px-3 py-1 border rounded-md disabled:opacity-40"
                  title={prevPageRangeLabel ? `Previous (${prevPageRangeLabel})` : 'Previous page'}
                >
                  Prev
                </button>
                <span>
                  Page {pageIndex} / {totalPages}
                </span>
                <button
                  onClick={goToNextPage}
                  disabled={pageIndex === totalPages}
                  className="px-3 py-1 border rounded-md disabled:opacity-40"
                  title={nextPageRangeLabel ? `Next (${nextPageRangeLabel})` : 'Next page'}
                >
                  Next
                </button>
                <button
                  onClick={jumpForwardTenPages}
                  disabled={pageIndex === totalPages}
                  className="px-3 py-1 border rounded-md disabled:opacity-40"
                  title="Forward 10 pages"
                >
                  +10
                </button>
                <button
                  onClick={goToLastPage}
                  disabled={pageIndex === totalPages}
                  className="px-3 py-1 border rounded-md disabled:opacity-40"
                  title="Last page"
                >
                  Last
                </button>
                {/* Month filter */}
                <DateNavigator
                  allImages={sortedImages}
                  currentFilter={dateFilter}
                  onFilterChange={setDateFilter}
                />
              </div>
            )}
          </div>
          <div id="second-row-controls" className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setBulkSelectionMode(prev => !prev)}
                className="px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition"
                aria-pressed={bulkSelectionMode}
              >
                {bulkSelectionMode ? 'Done selecting' : 'Select images'}
              </button>
              <button
                onClick={() => setFiltersCollapsed(prev => !prev)}
                className="px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition"
                aria-pressed={!filtersCollapsed}
              >
                {filtersCollapsed ? 'Show filters' : 'Hide filters'}
              </button>
              <button
                onClick={clearFilters}
                disabled={!hasActiveFilters}
                className="px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition disabled:opacity-50"
              >
                Clear filters
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-gray-100/50 rounded-md px-2 py-0.5">
                <label htmlFor="page-size-toolbar" className="text-[0.65rem] font-mono text-gray-500 whitespace-nowrap">
                  Gallery Size:
                </label>
                <MonoSelect
                  id="page-size-toolbar"
                  value={String(pageSize)}
                  onChange={(nextValue) => {
                    const parsed = Number(nextValue);
                    setPageSize(PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : DEFAULT_PAGE_SIZE);
                  }}
                  options={PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: String(size) }))}
                  className="w-18"
                  size='sm'
                />
              </div>
              <button
                onClick={() => fetchImages({ forceRefresh: true })}
                disabled={refreshingCache}
                className="px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition disabled:opacity-50"
                title="Refresh the server-side Cloudflare cache"
              >
                {refreshingCache ? 'Refreshing…' : 'Refresh cache'}
              </button>
              <button
                onClick={() => setNamespaceSettingsOpen(true)}
                className="px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition flex items-center gap-2"
                title="Namespace settings"
              >
                <Settings className="h-3 w-3" />
                Namespace
              </button>
              <button
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                className="px-3 py-1 text-[0.7em] font-mono bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                {viewMode === 'grid' ? '📋 List' : '🔲 Grid'}
              </button>
            </div>
          </div>
        </div>

        {(bulkSelectionMode || selectedCount > 0) && (
          <div className="mb-4 flex flex-wrap items-center gap-3 text-[0.7em] font-mono text-gray-700">
            <span>{selectedCount} selected</span>
            <button
              onClick={() => selectAllOnPage(pageImages)}
              className="px-2 py-1 border rounded-md hover:bg-gray-100"
            >
              Select page
            </button>
            <button
              onClick={clearSelection}
              className="px-2 py-1 border rounded-md hover:bg-gray-100"
            >
              Clear
            </button>
            <button
              onClick={openBulkEditModal}
              className="px-2 py-1 bg-gray-900 text-white rounded-md hover:bg-black disabled:opacity-40"
              disabled={!selectedCount}
            >
              Bulk edit
            </button>
            <button
              onClick={generateEmbeddingsForSelected}
              className="px-2 py-1 border border-green-300 text-green-700 rounded-md hover:bg-green-50 disabled:opacity-40 inline-flex items-center gap-1"
              disabled={!selectedCount || bulkEmbeddingGenerating}
              title="Generate CLIP and color embeddings for selected images"
            >
              <Cpu className="h-3 w-3" />
              {bulkEmbeddingGenerating ? 'Generating…' : 'Embeddings'}
            </button>
            <button
              onClick={deleteSelectedImages}
              className="px-2 py-1 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-40"
              disabled={!selectedCount || bulkDeleting}
            >
              {bulkDeleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        )}
      </div>

      {duplicateGroupCount > 0 && (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[0.65rem] font-mono text-amber-900">
          <div>
            Found {duplicateGroupCount} duplicate group{duplicateGroupCount === 1 ? '' : 's'} affecting {duplicateImageCount} image{duplicateImageCount === 1 ? '' : 's'} (must match both original URL and content hash).
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowDuplicatesOnly(prev => !prev)}
              className="px-3 py-1 rounded-md border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 transition"
            >
              {showDuplicatesOnly ? 'Show all images' : 'Show duplicates only'}
            </button>
            <button
              onClick={selectDuplicateImages}
              className="px-3 py-1 rounded-md border border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200 transition"
            >
              Select all duplicates
            </button>
            <button
              onClick={() => selectDuplicatesKeepSingle('newest')}
              className="px-3 py-1 rounded-md border border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200 transition"
            >
              Select duplicates (keep newest)
            </button>
            <button
              onClick={() => selectDuplicatesKeepSingle('oldest')}
              className="px-3 py-1 rounded-md border border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200 transition"
            >
              Select duplicates (keep oldest)
            </button>
          </div>
        </div>
      )}

      <div
        className={`overflow-hidden transition-[max-height] duration-300 ease-in-out ${filtersCollapsed ? 'max-h-0' : 'max-h-[1200px]'}`}
        aria-hidden={filtersCollapsed}
      >
        <div
          id="gallery-filter-controls"
          className={`grid grid-cols-1 md:grid-cols-6 gap-4 p-4 bg-gray-50 rounded-lg items-end transition-opacity duration-300 ${filtersCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
          <div>
          <label htmlFor="search" className="block text-[0.7em] font-mono font-mono font-medum text-gray-700 mb-1">
            Search
          </label>
          <input
            id="search"
            type="text"
            placeholder="Search files, tags, folders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-[0.7em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="folder-filter" className="block text-[0.7em] font-mono font-mono font-medum text-gray-700">
              Folder
            </label>
            <FolderManagerButton onFoldersChanged={handleFoldersChanged} size="sm" label="Manage" />
          </div>
          <MonoSelect
            id="folder-filter"
            value={selectedFolder}
            onChange={setSelectedFolder}
            options={folderFilterOptions}
            className="w-full"
            size="sm"
          />
        </div>
        
        <div>
          <label htmlFor="tag-filter" className="block text-[0.7em] font-mono font-mono font-medum text-gray-700 mb-1">
            Tag
          </label>
          <input
            id="tag-filter"
            list="tag-filter-list"
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            placeholder="All tags"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-[0.7em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <datalist id="tag-filter-list">
            {uniqueTags.map(tag => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor="variant-select" className="block text-[0.7em] font-mono font-mono font-medum text-gray-700 mb-1">
            Image Size
          </label>
          <MonoSelect
            id="variant-select"
            value={selectedVariant}
            onChange={setSelectedVariant}
            options={variantOptions}
            className="w-full"
            size="sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-[0.7em] font-mono text-gray-700">
          <label htmlFor="canonical-filter" className="flex items-center gap-1 font-mono">
            <input
              id="canonical-filter"
              type="checkbox"
              checked={onlyCanonical}
              onChange={(e) => setOnlyCanonical(e.target.checked)}
              className="h-3 w-3 font-mono text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            canonical
          </label>
          <label htmlFor="aspect-filter" className="flex items-center gap-1 font-mono">
            <input
              id="aspect-filter"
              type="checkbox"
              checked={respectAspectRatio}
              onChange={(e) => setRespectAspectRatio(e.target.checked)}
              className="h-3 w-3 font-mono text-[0.7em] font-mono text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            aspect
          </label>
          <label htmlFor="variants-filter" className="flex items-center gap-1 font-mono">
            <input
              id="variants-filter"
              type="checkbox"
              checked={onlyWithVariants}
              onChange={(e) => setOnlyWithVariants(e.target.checked)}
              className="h-3 w-3 font-mono text-[0.7em] font-mono text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            parents
          </label>
          <label htmlFor="duplicates-filter" className="flex items-center gap-1 font-mono">
            <input
              id="duplicates-filter"
              type="checkbox"
              checked={showDuplicatesOnly}
              onChange={(e) => setShowDuplicatesOnly(e.target.checked)}
              className="h-3 w-3 font-mono text-[0.7em] font-mono text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            duplicates
          </label>
          <label htmlFor="broken-filter" className="flex items-center gap-1 font-mono">
            <input
              id="broken-filter"
              type="checkbox"
              checked={showBrokenOnly}
              onChange={(e) => setShowBrokenOnly(e.target.checked)}
              className="h-3 w-3 font-mono text-[0.7em] font-mono text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            broken
          </label>
        </div>
        <div className="md:col-span-6 flex flex-wrap items-center gap-3 text-[0.65rem] font-mono text-gray-600">
          <button
            onClick={runBrokenAudit}
            disabled={auditLoading}
            className="inline-flex items-center gap-2 px-3 py-1 border border-gray-300 rounded-md bg-white hover:bg-gray-100 disabled:opacity-50"
          >
            <AlertTriangle className="h-3 w-3" />
            {auditLoading ? 'Auditing…' : 'Audit broken URLs'}
          </button>
          <span>
            Broken: {brokenAudit.ids.length}
          </span>
          {brokenAudit.checkedAt && (
            <span>
              Last audit: {new Date(brokenAudit.checkedAt).toLocaleString()}
            </span>
          )}
          {(auditLoading || auditProgress.checked > 0) && (
            <span>
              Checked: {auditProgress.checked}/{auditProgress.total}
            </span>
          )}
        </div>
        {(auditLoading || auditEntries.length > 0) && (
          <div className="md:col-span-6 rounded-md border border-gray-200 bg-white p-3 text-[0.65rem] font-mono text-gray-700">
            <div className="flex items-center justify-between">
              <span>Audit log {auditEntries.length >= AUDIT_LOG_LIMIT ? `(last ${AUDIT_LOG_LIMIT})` : ''}</span>
              {auditLoading && <span className="text-gray-500">Running…</span>}
            </div>
            <div className="mt-2 h-1 w-full rounded-full bg-gray-100">
              <div
                className="h-1 rounded-full bg-blue-500 transition-[width]"
                style={{
                  width: auditProgress.total
                    ? `${Math.min(100, (auditProgress.checked / auditProgress.total) * 100)}%`
                    : '0%'
                }}
              />
            </div>
            <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
              {auditEntries.map((entry) => (
                <div key={`${entry.id}-${entry.url ?? ''}-${entry.status ?? ''}`} className="flex items-start justify-between gap-2">
                  <div className="text-gray-600">
                    <div>{entry.id}</div>
                    <div className="text-gray-400">{entry.filename ?? '[no filename]'}</div>
                  </div>
                  <span className="text-gray-500">
                    {entry.status ?? '—'} {entry.reason ?? ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="md:col-span-6">
          <GalleryCommandBar
            hiddenFolders={hiddenFolders}
            hiddenTags={hiddenTags}
            knownFolders={uniqueFolders}
            knownTags={uniqueTags}
            onHideFolder={hideFolderByName}
            onUnhideFolder={unhideFolderByName}
            onClearHidden={clearHiddenFolders}
            onHideTag={hideTagByName}
            onUnhideTag={unhideTagByName}
            onClearHiddenTags={clearHiddenTags}
            onSelectFolder={setSelectedFolder}
            selectedTag={selectedTag}
            onSelectTag={setSelectedTag}
            onClearTagFilter={() => setSelectedTag('')}
            showParentsOnly={onlyWithVariants}
            onSetParentsOnly={setOnlyWithVariants}
            currentPage={pageIndex}
            totalPages={totalPages}
            onGoToPage={goToPageNumber}
            embeddingFilter={embeddingFilter}
            onSetEmbeddingFilter={setEmbeddingFilter}
          />
        </div>
          {hiddenFolders.length > 0 && (
            <div className="md:col-span-6 flex flex-wrap items-center gap-2 p-3 bg-white border border-gray-200 rounded-lg text-[0.65rem] font-mono text-gray-700">
              <span className="uppercase tracking-wide text-gray-500 text-[0.6rem]">Hidden folders</span>
              {hiddenFolders.map(folder => (
                <button
                  key={folder}
                  onClick={() => unhideFolderByName(folder)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-900 text-white hover:bg-black transition"
                  title="Unhide folder"
                >
                  {folder}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
              <button
                onClick={clearHiddenFolders}
                className="ml-auto text-[0.6rem] uppercase tracking-wide text-blue-600 hover:text-blue-700"
              >
                Clear all
              </button>
            </div>
          )}
          {hiddenTags.length > 0 && (
            <div className="md:col-span-6 flex flex-wrap items-center gap-2 p-3 bg-white border border-gray-200 rounded-lg text-[0.65rem] font-mono text-gray-700">
              <span className="uppercase tracking-wide text-gray-500 text-[0.6rem]">Hidden tags</span>
              {hiddenTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => unhideTagByName(tag)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-900 text-white hover:bg-black transition"
                  title="Unhide tag"
                >
                  {tag}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
              <button
                onClick={clearHiddenTags}
                className="ml-auto text-[0.6rem] uppercase tracking-wide text-blue-600 hover:text-blue-700"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        className="hidden sm:block fixed right-4 top-1/2 -translate-y-1/2 z-30"
        onMouseEnter={() => setUtilityExpanded(true)}
        onMouseLeave={() => setUtilityExpanded(false)}
        onFocusCapture={() => setUtilityExpanded(true)}
        onBlurCapture={() => setUtilityExpanded(false)}
      >
        {utilityExpanded ? (
          <div className="pointer-events-auto flex flex-col gap-3 bg-gray-900 text-white border border-gray-700 rounded-2xl shadow-xl px-4 py-3 min-w-[220px]">
            <div className="flex items-center justify-between text-[0.6rem] uppercase tracking-wide text-gray-300">
              <span>Utility</span>
              <button
                onClick={() => setUtilityExpanded(false)}
                className="text-gray-400 hover:text-white"
                aria-label="Collapse utility bar"
              >
                ✕
              </button>
            </div>
            <button
              onClick={() => setFiltersCollapsed(prev => !prev)}
              className={`${utilityButtonClasses} text-left bg-white/10 hover:bg-white/20`}
              aria-pressed={!filtersCollapsed}
            >
              {filtersCollapsed ? 'Show filters' : 'Hide filters'}
            </button>
            {selectedCount > 0 && (
              <div className="flex flex-col gap-1 text-[0.6rem] text-white">
                <span>{selectedCount} selected</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => selectAllOnPage(pageImages)}
                    className={`${utilityButtonClasses} border border-white/20`}
                  >
                    Select page
                  </button>
                  <button
                    onClick={openBulkEditModal}
                    className={`${utilityButtonClasses} bg-blue-600 hover:bg-blue-500`}
                  >
                    Bulk edit
                  </button>
                  <button
                    onClick={clearSelection}
                    className={`${utilityButtonClasses} border border-white/20`}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 text-[0.6rem] text-gray-200">
              <button
                onClick={goToFirstPage}
                disabled={pageIndex === 1}
                className={`${utilityButtonClasses} disabled:opacity-40`}
              >
                First
              </button>
              <button
                onClick={jumpBackTenPages}
                disabled={pageIndex === 1}
                className={`${utilityButtonClasses} disabled:opacity-40`}
              >
                -10
              </button>
              <button
                onClick={goToPreviousPage}
                disabled={pageIndex === 1}
                className={`${utilityButtonClasses} disabled:opacity-40`}
              >
                Prev
              </button>
              <span className="text-[0.6rem]">
                {pageIndex}/{totalPages}
              </span>
              <button
                onClick={goToNextPage}
                disabled={pageIndex === totalPages}
                className={`${utilityButtonClasses} disabled:opacity-40`}
              >
                Next
              </button>
              <button
                onClick={jumpForwardTenPages}
                disabled={pageIndex === totalPages}
                className={`${utilityButtonClasses} disabled:opacity-40`}
              >
                +10
              </button>
              <button
                onClick={goToLastPage}
                disabled={pageIndex === totalPages}
                className={`${utilityButtonClasses} disabled:opacity-40`}
              >
                Last
              </button>
            </div>
            <div className="flex flex-col gap-2 text-[0.6rem] text-gray-200">
              <button
                onClick={scrollGalleryToTop}
                className={`${utilityButtonClasses} text-left`}
              >
                Scroll top
              </button>
              <button
                onClick={scrollToUploader}
                className={`${utilityButtonClasses} text-left`}
              >
                Go to uploader
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setUtilityExpanded(true)}
            className="pointer-events-auto flex items-center gap-2 bg-gray-900/90 text-white border border-gray-700 rounded-full shadow-lg px-3 py-2 text-[0.65rem] font-mono uppercase tracking-wide hover:bg-gray-800"
            aria-label="Expand utility bar"
          >
            Utility
          </button>
        )}
      </div>

      {!hasResults ? (
        <div id="gallery-empty-state" className="text-center py-12">
          <div className="text-gray-400 mb-2">
            <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 20 20" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-gray-500">
            {images.length === 0 ? 'No images uploaded yet' : 'No images match your filters'}
          </p>
          <p className="text-[0.7em] font-mono text-gray-400">
            {images.length === 0 ? 'Upload some images to see them here' : 'Try adjusting your search or filters'}
          </p>
          {images.length > 0 && hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="mt-3 px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        viewMode === 'grid' ? (
          <div id="gallery-results-grid" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 [grid-auto-rows:1fr]">
            {pageImages.map((image) => {
              const variationChildren = childrenMap[image.id] || [];
              const imageUrl = getImageUrl(image, selectedVariant);
              const svgImage = isSvgImage(image);
              const displayUrl = svgImage ? getCloudflareImageUrl(image.id, 'original') : imageUrl;
              const isSelected = selectedImageIds.has(image.id);
              return (
                <div
                  key={image.id}
                  className={`z-0 group bg-gray-100 rounded-lg overflow-hidden flex flex-col h-full border ${
                    isSelected ? 'border-blue-500 ring-2 ring-blue-400' : 'border-transparent'
                  } ${bulkSelectionMode ? 'cursor-pointer' : ''}`}
                >
                  <Link
                    href={`/images/${image.id}`}
                    className={`relative block w-full ${respectAspectRatio ? '' : 'aspect-square'}`}
                    style={
                      respectAspectRatio && image.dimensions
                        ? { paddingBottom: `${(image.dimensions.height / image.dimensions.width) * 100}%` }
                        : respectAspectRatio
                          ? { paddingBottom: '75%' }
                          : undefined
                    }
                    onClick={(e) => {
                      if (bulkSelectionMode) {
                        e.preventDefault();
                        toggleSelection(image.id);
                      }
                    }}
                    onMouseEnter={(e) => handleMouseEnter(image.id, e)}
                    onMouseMove={(e) => handleMouseMove(image.id, e)}
                    onMouseLeave={handleMouseLeave}
                    prefetch={false}
                  >
                    {svgImage ? (
                      <img
                        draggable
                        onDragStart={(e) => handleImageDragStart(e, image)}
                        src={displayUrl}
                        alt={image.displayName || image.filename}
                        className={`absolute inset-0 w-full h-full ${respectAspectRatio ? 'object-contain bg-white' : 'object-cover'}`}
                      />
                    ) : (
                      <Image
                        draggable
                        onDragStart={(e) => handleImageDragStart(e, image)}
                        src={displayUrl}
                        alt={image.displayName || image.filename}
                        fill
                        className={respectAspectRatio ? 'object-contain bg-gray-50' : 'object-cover'}
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      />
                    )}
                    {bulkSelectionMode && (
                      <label className="absolute top-2 left-2 flex items-center gap-1 text-[0.65rem] font-mono bg-white/90 px-2 py-1 rounded-md shadow cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleSelection(image.id);
                          }}
                          className="h-3 w-3"
                        />
                        Select
                      </label>
                    )}
                    {!bulkSelectionMode && hasSearchExclusionTag(image.tags) && (
                      <div 
                        className="absolute top-2 left-2 p-1 bg-black/70 rounded-md shadow"
                        title={getExclusionTooltip(image.tags)}
                      >
                        <SearchExclusionIcon className="h-4 w-4 text-white" title={getExclusionTooltip(image.tags)} />
                      </div>
                    )}
                  </Link>
                  
                  {/* Metadata footer */}
                  <div id="metadata-footer" className="px-3 py-2 bg-white border-t border-gray-100 flex-1 flex flex-col">
                    <div className="flex-1 flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[0.6rem] font-mono font-semibold text-gray-900 truncate" title={image.displayName || image.filename} style={{ lineHeight: '1.2' }}>
                          {image.displayName || image.filename}
                        </p>
                        <EmbeddingStatusDot
                          hasClipEmbedding={image.hasClipEmbedding}
                          hasColorEmbedding={image.hasColorEmbedding}
                          pendingStatus={embeddingPendingMap[image.id]?.status}
                          size={8}
                        />
                        {duplicateIds.has(image.id) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-amber-800">
                            <AlertTriangle className="h-3 w-3" />
                            Duplicate
                          </span>
                        )}
                      </div>
                      <div className="text-gray-500 text-[0.6rem] mt-1 space-y-0.5">
                        <p>{new Date(image.uploaded).toLocaleDateString()}</p>
                        <p>📁 {image.folder ? image.folder : '[none]'}</p>
                        <p className="flex items-center gap-1">
                          <span>🧭 {image.namespace ? image.namespace : '[none]'}</span>
                          {image.namespace && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                copyToClipboard(image.namespace, 'Namespace');
                              }}
                              className="inline-flex items-center text-gray-400 hover:text-gray-600"
                              title="Copy namespace"
                              aria-label="Copy namespace"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          )}
                        </p>
                        <AspectRatioDisplay imageId={image.id} />
                        {image.tags && image.tags.length > 0 ? (
                          <p>🏷️ {image.tags.slice(0, 2).join(', ')}{image.tags.length > 2 ? '...' : ''}</p>
                        ) : (
                          <p className="text-gray-400">🏷️ [no tags]</p>
                        )}
                        <p
                          className={`text-[0.6rem] truncate leading-snug ${image.altTag ? 'text-gray-600' : 'text-gray-400 italic'}`}
                          title={image.altTag || undefined}
                        >
                          {image.altTag ? `📝 ${image.altTag}` : 'No ALT text yet'}
                        </p>
                        {variationChildren.length > 0 && (
                          <p className="text-[0.6rem] text-blue-600 flex items-center gap-1" title="Has variations">
                            <Layers className="h-3.5 w-3.5" />
                            {variationChildren.length} variation{variationChildren.length > 1 ? 's' : ''}
                          </p>
                        )}
                        {/* Color metadata display */}
                        {colorMetadataMap[image.id] && (
                          <div className="font-3270 text-[0.55rem] leading-tight mt-1 space-y-0.5">
                            {colorMetadataMap[image.id].averageColor && (
                              <div className="flex items-center gap-1.5">
                                <span 
                                  className="inline-block w-3 h-3 rounded-sm border border-gray-200 shadow-sm"
                                  style={{ backgroundColor: colorMetadataMap[image.id].averageColor }}
                                  title={colorMetadataMap[image.id].averageColor}
                                />
                                <span className="text-gray-500 uppercase tracking-wide">
                                  avg {colorMetadataMap[image.id].averageColor}
                                </span>
                              </div>
                            )}
                            {colorMetadataMap[image.id].dominantColors && colorMetadataMap[image.id].dominantColors!.length > 0 && (
                              <div className="flex items-center gap-1">
                                <span className="text-gray-400 mr-0.5">◆</span>
                                {colorMetadataMap[image.id].dominantColors!.slice(0, 5).map((color, idx) => (
                                  <span 
                                    key={idx}
                                    className="inline-block w-3 h-3 rounded-sm border border-gray-200 shadow-sm"
                                    style={{ backgroundColor: color }}
                                    title={color}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="pt-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); generateAltTag(image.id); }}
                        disabled={Boolean(altLoadingMap[image.id])}
                        className="w-full inline-flex items-center justify-center gap-2 bg-gray-900 text-white rounded-md px-3 py-1.5 text-[0.6rem] transition hover:bg-black disabled:opacity-50"
                      >
                        <Sparkles className="text-[0.8rem] h-3.5 w-3.5" />
                        {altLoadingMap[image.id] ? 'Generating ALT...' : image.altTag ? 'Refresh text' : 'Gen ALT text'}
                      </button>
                    </div>
                  </div>

                  {/* Action bar below metadata to ensure icons are never obscured */}
                  <div className="flex flex-wrap justify-center gap-1.5 py-1.5 bg-white border-b border-gray-200 z-30 mt-auto">
                    <button
                      onClick={(e) => { e.stopPropagation(); setOpenCopyMenu(openCopyMenu === image.id ? null : image.id); }}
                      className="inline-flex items-center justify-center bg-black text-white rounded-full px-2.5 py-1 text-[0.7rem] shadow-sm min-h-[32px] min-w-[32px] cursor-pointer transition-transform transform hover:scale-105 active:scale-95 hover:shadow-lg focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-black/40"
                      title="Copy URL"
                      aria-label="Copy URL"
                    >
                      <Copy className="h-[12px] w-[12px]" />
                    </button>
                    <button
                      onClick={() => window.open(`/images/${image.id}`, '_blank')}
                      className="inline-flex items-center justify-center bg-black text-white rounded-full px-2.5 py-1 text-[0.7rem] shadow-sm min-h-[32px] min-w-[32px] cursor-pointer transition-transform transform hover:scale-105 active:scale-95 hover:shadow-lg focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-black/40"
                      title="Open in new tab"
                      aria-label="Open in new tab"
                    >
                      <ExternalLink className="h-[12px] w-[12px]" />
                    </button>
                    <button
                      onClick={() => startEdit(image)}
                      className="inline-flex items-center justify-center bg-black text-white rounded-full px-2.5 py-1 text-[0.7rem] shadow-sm min-h-[32px] min-w-[32px] cursor-pointer transition-transform transform hover:scale-105 active:scale-95 hover:shadow-lg focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-black/40"
                      title="Edit folder/tags"
                      aria-label="Edit folder/tags"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 20 20">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    {/* Variants button removed — clipboard button opens the full-sheet modal */}
                    <button
                      onClick={() => deleteImage(image.id)}
                      className="inline-flex items-center justify-center bg-black text-white rounded-full px-2.5 py-1 text-[0.7rem] shadow-sm min-h-[32px] min-w-[32px] cursor-pointer transition-transform transform hover:scale-105 active:scale-95 hover:shadow-lg focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-black/40"
                      title="Delete image"
                      aria-label="Delete image"
                    >
                      <Trash2 className="h-[12px] w-[12px]" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {pageImages.map((image) => {
              const variationChildren = childrenMap[image.id] || [];
              const imageUrl = getImageUrl(image, selectedVariant);
              const svgImage = isSvgImage(image);
              const displayUrl = svgImage ? getCloudflareImageUrl(image.id, 'original') : imageUrl;
              const isSelected = selectedImageIds.has(image.id);
              return (
                <div
                  key={image.id}
                  className={`flex items-center space-x-4 p-4 border rounded-lg hover:bg-gray-50 ${
                    isSelected ? 'border-blue-500 ring-2 ring-blue-400' : 'border-gray-200'
                  }`}
                >
                  <Link
                    href={`/images/${image.id}`}
                    className="w-32 h-32 relative bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => handleMouseEnter(image.id, e)}
                    onMouseMove={(e) => handleMouseMove(image.id, e)}
                    onMouseLeave={handleMouseLeave}
                    onClick={(e) => {
                      if (bulkSelectionMode) {
                        e.preventDefault();
                        toggleSelection(image.id);
                      }
                    }}
                    prefetch={false}
                  >
                    {svgImage ? (
                      <img
                        draggable
                        onDragStart={(e) => handleImageDragStart(e, image)}
                        src={displayUrl}
                        alt={image.filename}
                        className="absolute inset-0 w-full h-full object-contain bg-white"
                      />
                    ) : (
                      <Image
                        draggable
                        onDragStart={(e) => handleImageDragStart(e, image)}
                        src={displayUrl}
                        alt={image.filename}
                        fill
                        className="object-cover"
                        sizes="64px"
                      />
                    )}
                  </Link>
                  {bulkSelectionMode && (
                    <label className="flex items-center gap-2 text-[0.7em] font-mono">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelection(image.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3 w-3"
                      />
                      Select
                    </label>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[0.7em] font-mono font-mono font-medum text-gray-900 truncate" title={image.displayName || image.filename}>
                        {image.displayName || image.filename}
                      </p>
                      {duplicateIds.has(image.id) && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-amber-800">
                          <AlertTriangle className="h-3 w-3" />
                          Duplicate
                        </span>
                      )}
                    </div>
                    <p className="text-[0.7em] font-mono text-gray-500">
                      {new Date(image.uploaded).toLocaleDateString()}
                    </p>
                    <p className="text-[0.7em] font-mono text-gray-500">📁 {image.folder ? image.folder : '[none]'}</p>
                    <p className="text-[0.7em] font-mono text-gray-500 flex items-center gap-1">
                      <span>🧭 {image.namespace ? image.namespace : '[none]'}</span>
                      {image.namespace && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            copyToClipboard(image.namespace, 'Namespace');
                          }}
                          className="inline-flex items-center text-gray-400 hover:text-gray-600"
                          title="Copy namespace"
                          aria-label="Copy namespace"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      )}
                    </p>
                    <div className="text-[0.7em] font-mono text-gray-500">
                      <AspectRatioDisplay imageId={image.id} />
                    </div>
                    {image.tags && image.tags.length > 0 ? (
                      <p className="text-[0.7em] font-mono text-gray-500">🏷️ {image.tags.join(', ')}</p>
                    ) : (
                      <p className="text-[0.7em] font-mono text-gray-400">🏷️ [no tags]</p>
                    )}
                    <p
                      className={`text-[0.7em] font-mono mt-1 ${image.altTag ? 'text-gray-600' : 'text-gray-400 italic'}`}
                      title={image.altTag || undefined}
                    >
                      {image.altTag ? `📝 ${image.altTag}` : 'No ALT text yet'}
                    </p>
                    {variationChildren.length > 0 && (
                      <p className="text-[0.7em] font-mono text-blue-600 flex items-center gap-1 mt-1" title="Has variations">
                        <Layers className="h-3.5 w-3.5" />
                        {variationChildren.length} variation{variationChildren.length > 1 ? 's' : ''}
                      </p>
                    )}
                    {/* Color metadata display */}
                    {colorMetadataMap[image.id] && (
                      <div className="font-3270 text-[0.6rem] leading-tight mt-1.5 flex items-center gap-3">
                        {colorMetadataMap[image.id].averageColor && (
                          <div className="flex items-center gap-1.5">
                            <span 
                              className="inline-block w-3.5 h-3.5 rounded-sm border border-gray-200 shadow-sm"
                              style={{ backgroundColor: colorMetadataMap[image.id].averageColor }}
                              title={colorMetadataMap[image.id].averageColor}
                            />
                            <span className="text-gray-500 uppercase tracking-wide">
                              avg {colorMetadataMap[image.id].averageColor}
                            </span>
                          </div>
                        )}
                        {colorMetadataMap[image.id].dominantColors && colorMetadataMap[image.id].dominantColors!.length > 0 && (
                          <div className="flex items-center gap-1">
                            <span className="text-gray-400 mr-0.5">◆</span>
                            {colorMetadataMap[image.id].dominantColors!.slice(0, 5).map((color, idx) => (
                              <span 
                                key={idx}
                                className="inline-block w-3.5 h-3.5 rounded-sm border border-gray-200 shadow-sm"
                                style={{ backgroundColor: color }}
                                title={color}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => generateAltTag(image.id)}
                      disabled={Boolean(altLoadingMap[image.id])}
                      className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 text-[0.7em] font-mono rounded-md border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {altLoadingMap[image.id] ? 'Generating ALT...' : image.altTag ? 'Refresh' : 'Generate ALT text'}
                    </button>
                  </div>
                  
                  <div className="flex space-x-2">
                    <div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenCopyMenu(openCopyMenu === image.id ? null : image.id); }}
                        className="p-2 text-gray-400 hover:text-blue-600 transition-colors cursor-pointer transition-transform transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
                        title="Copy URL"
                      >
                        <Copy className="h-[12px] w-[12px]" />
                      </button>
                    </div>
                    <button
                      onClick={() => window.open(`/images/${image.id}`, '_blank')}
                      className="p-2 text-gray-400 hover:text-green-600 transition-colors cursor-pointer transition-transform transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-300"
                      title="Open in new tab"
                    >
                      <ExternalLink className="h-[12px] w-[12px]" />
                    </button>
                    <button
                      onClick={() => startEdit(image)}
                      className="p-2 text-gray-400 hover:text-yellow-600 transition-colors cursor-pointer transition-transform transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-300"
                      title="Edit folder/tags"
                    >
                      <svg className="h-[12px] w-[12px]" fill="none" stroke="currentColor" viewBox="0 0 20 20">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => deleteImage(image.id)}
                      className="p-2 text-gray-400 hover:text-red-600 transition-colors cursor-pointer transition-transform transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-300"
                      title="Delete image"
                    >
                      <Trash2 className="h-[12px] w-[12px]" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {showPagination && hasResults && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-6 text-[0.7em] font-mono text-gray-600 border-t border-gray-100 pt-4">
          <div>
            {currentPageRangeLabel && (
              <p>Currently viewing uploads from {currentPageRangeLabel}</p>
            )}
            <p className="text-[0.7em] font-mono text-gray-400">Page {pageIndex} of {totalPages}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={goToPreviousPage}
              disabled={pageIndex === 1}
              className="px-3 py-1.5 border rounded-md disabled:opacity-40"
              title={prevPageRangeLabel ? `Previous (${prevPageRangeLabel})` : 'Previous page'}
            >
              Previous
            </button>
            <button
              onClick={goToNextPage}
              disabled={pageIndex === totalPages}
              className="px-3 py-1.5 border rounded-md disabled:opacity-40"
              title={nextPageRangeLabel ? `Next (${nextPageRangeLabel})` : 'Next page'}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Global Copy Modal (works for grid and list) */}
      {openCopyMenu && (() => {
        const modalImage = images.find(i => i.id === openCopyMenu);
        if (!modalImage) return null;
        const blurOverlayStyle: CSSProperties = {
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)'
        };
        return (
          <>
              <div
                className="fixed inset-0 bg-black/30 backdrop-blur-md z-[100000]"
                style={blurOverlayStyle}
                onClick={(e) => { e.stopPropagation(); setOpenCopyMenu(null); }}
              />
              <div className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 bg-white rounded-lg shadow-xl z-[100001] text-[0.7em] font-mono text-gray-800 border">
              <div className="flex items-center justify-between p-3 border-b">
                <div className="text-[0.7em] font-mono font-mono font-medum">Copy Image URL</div>
                <button
                  onClick={(e) => { e.stopPropagation(); setOpenCopyMenu(null); }}
                  className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-[0.7em] font-mono"
                  title="Close"
                >
                  ×
                </button>
              </div>
              <div className="p-3 max-h-80 overflow-auto">
                {Object.entries(getVariantUrls(modalImage)).map(([variant, url]) => {
                  const widthLabel = getVariantWidthLabel(variant);
                  return (
                    <div key={variant} className="flex items-center justify-between gap-2 py-2 border-b border-gray-100 last:border-b-0">
                      <div className="flex-1 min-w-0 mr-3">
                        <div className="text-[0.7em] font-mono font-mono font-semibold text-gray-900 capitalize flex items-center gap-2">
                          <span>{variant}</span>
                          {widthLabel && <span className="text-gray-400 normal-case">{widthLabel}</span>}
                        </div>
                        <div className="text-[0.7em] font-mono text-gray-500 truncate">{String(url)}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            await handleCopyUrl(e, String(url), variant, modalImage.altTag);
                            setOpenCopyMenu(null);
                          }}
                          className="px-3 py-1 bg-blue-100 hover:bg-blue-200 active:bg-blue-300 rounded text-[0.7em] font-mono font-medium flex-shrink-0 cursor-pointer transition transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300"
                        >
                          Copy
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            await downloadVariantToFile(String(url), modalImage.filename);
                          }}
                          className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-[0.7em] font-mono font-medium flex-shrink-0 cursor-pointer"
                          title="Download"
                        >
                          Download
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="px-3 pb-3 text-[0.7em] font-mono text-gray-500">Tip: Shift+Copy adds ALT text.</div>
            </div>
          </>
        );
      })()}

      {namespaceSettingsOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-[100000]"
            onClick={() => setNamespaceSettingsOpen(false)}
          />
          <div className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 bg-white rounded-lg shadow-xl z-[100001] text-[0.75em] font-mono text-gray-800 border">
            <div className="flex items-center justify-between p-3 border-b">
              <div className="text-[0.8em] font-mono font-medium">Namespace</div>
              <button
                onClick={() => setNamespaceSettingsOpen(false)}
                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-[0.75em] font-mono"
                title="Close"
              >
                ×
              </button>
            </div>
            <div className="p-3 space-y-3">
              <label className="block text-[0.75em] text-gray-600">
                Namespace
                <div className="mt-1 space-y-2">
                  <MonoSelect
                    id="namespace-select"
                    value={namespaceSelectValue}
                    onChange={(value) => {
                      setNamespaceSelectValue(value);
                      if (value === '__custom__') {
                        return;
                      }
                      setNamespaceDraft(value);
                      onNamespaceChange?.(value);
                      setNamespaceSettingsOpen(false);
                    }}
                    options={namespaceOptions}
                    className="w-full"
                    size="sm"
                  />
                  <input
                    value={namespaceDraft}
                    onChange={(e) => {
                      setNamespaceDraft(e.target.value);
                      setNamespaceSelectValue('__custom__');
                    }}
                    placeholder="Custom namespace (optional)"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-[0.85em] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={namespaceSelectValue !== '__custom__'}
                  />
                </div>
              </label>
              <p className="text-[0.7em] text-gray-500">
                Only images in this namespace are shown and used for duplicate checks (unless you pick "All namespaces").
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 p-3 border-t">
              <button
                onClick={() => setNamespaceSettingsOpen(false)}
                className="px-3 py-1 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const next = namespaceSelectValue === '__custom__'
                    ? namespaceDraft.trim()
                    : namespaceSelectValue;
                  onNamespaceChange?.(next);
                  setNamespaceSettingsOpen(false);
                }}
                className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </>
      )}

      {/* Edit Modal */}
      {editingImage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Edit Image Organization
            </h3>
            
            <div id="gallery-results-list" className="space-y-4">
              <div>
                <label htmlFor="edit-folder" className="block text-[0.7em] font-mono font-mono font-medum text-gray-700 mb-1">
                  Folder
                </label>
                <div>
                  <MonoSelect
                    id="edit-folder"
                    value={editFolderSelect}
                    onChange={setEditFolderSelect}
                    options={editFolderOptions}
                    className="w-full"
                    size="sm"
                  />
                  {editFolderSelect === '__create__' && (
                    <input
                      value={newEditFolder}
                      onChange={(e) => setNewEditFolder(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-[0.9em] font-mono mt-2"
                      placeholder="Type new folder name"
                    />
                  )}
                </div>
                <p className="text-[0.7em] font-mono text-gray-500 mt-1">Select existing folder or create a new one</p>
              </div>
              
              <div>
                <label htmlFor="edit-tags" className="block text-[0.7em] font-mono font-mono font-medum text-gray-700 mb-1">
                  Tags
                </label>
                <input
                  id="edit-tags"
                  type="text"
                  placeholder="logo, header, banner (comma separated)"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-[0.7em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[0.7em] font-mono text-gray-500 mt-1">Separate tags with commas</p>
              </div>
            </div>
            
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={cancelEdit}
                className="px-4 py-2 text-[0.7em] font-mono text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => saveEdit(editingImage)}
                className="px-4 py-2 text-[0.7em] font-mono bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Edit Modal */}
      {bulkEditOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] px-4">
          <div className="bg-white rounded-lg w-full max-w-lg p-6 space-y-4 text-[0.7em] font-mono">
            <div className="flex items-center justify-between">
              <p className="text-gray-900 font-semibold">Bulk edit ({selectedCount} images)</p>
              <button onClick={closeBulkEditModal} className="text-gray-500 hover:text-gray-700">
                ×
              </button>
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={bulkApplyFolder}
                  onChange={(e) => setBulkApplyFolder(e.target.checked)}
                  className="h-3 w-3"
                />
                Update folder
              </label>
              {bulkApplyFolder && (
                <div className="space-y-2">
                  {bulkFolderMode === 'existing' ? (
                    <>
                      <MonoSelect
                        value={bulkFolderInput}
                        onChange={handleBulkFolderSelect}
                        options={bulkFolderOptions}
                        className="w-full"
                        placeholder="[none]"
                        size="sm"
                      />
                      <p className="text-[0.6rem] text-gray-500">
                        Choose an existing folder or pick “Create new folder…” to type a new name.
                      </p>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={bulkFolderInput}
                        onChange={(e) => setBulkFolderInput(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2"
                        placeholder="Type new folder name"
                      />
                      <button
                        type="button"
                        onClick={() => handleBulkFolderSelect('')}
                        className="text-[0.6rem] text-blue-600 underline"
                      >
                        ← Back to folder list
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={bulkApplyTags}
                  onChange={(e) => setBulkApplyTags(e.target.checked)}
                  className="h-3 w-3"
                />
                Update tags
              </label>
              {bulkApplyTags && (
                <div className="space-y-2">
                  <div className="flex items-center gap-4 text-[0.65rem] text-gray-600">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="bulk-tags-mode"
                        checked={bulkTagsMode === 'replace'}
                        onChange={() => setBulkTagsMode('replace')}
                        className="h-3 w-3"
                      />
                      Replace
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="bulk-tags-mode"
                        checked={bulkTagsMode === 'append'}
                        onChange={() => setBulkTagsMode('append')}
                        className="h-3 w-3"
                      />
                      Append
                    </label>
                  </div>
                  <textarea
                    value={bulkTagsInput}
                    onChange={(e) => setBulkTagsInput(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                    placeholder="Comma-separated tags"
                    rows={3}
                  />
                  <p className="text-[0.6rem] text-gray-500">
                    {bulkTagsMode === 'replace'
                      ? 'Replace tags with this list (empty clears tags).'
                      : 'Append tags to each image (empty keeps existing tags).'}
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={bulkApplyDisplayName}
                  onChange={(e) => setBulkApplyDisplayName(e.target.checked)}
                  className="h-3 w-3"
                />
                Update display name
              </label>
              {bulkApplyDisplayName && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-4 text-[0.65rem] text-gray-600">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="bulk-display-name-mode"
                        checked={bulkDisplayNameMode === 'custom'}
                        onChange={() => setBulkDisplayNameMode('custom')}
                        className="h-3 w-3"
                      />
                      Custom
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="bulk-display-name-mode"
                        checked={bulkDisplayNameMode === 'auto'}
                        onChange={() => setBulkDisplayNameMode('auto')}
                        className="h-3 w-3"
                      />
                      Auto (trim filename)
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="bulk-display-name-mode"
                        checked={bulkDisplayNameMode === 'clear'}
                        onChange={() => setBulkDisplayNameMode('clear')}
                        className="h-3 w-3"
                      />
                      Clear
                    </label>
                  </div>
                  {bulkDisplayNameMode === 'custom' && (
                    <input
                      type="text"
                      value={bulkDisplayNameInput}
                      onChange={(e) => setBulkDisplayNameInput(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2"
                      placeholder="Display name"
                    />
                  )}
                  <p className="text-[0.6rem] text-gray-500">
                    Auto mode uses the filename trimmed to 64 characters.
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={bulkApplyNamespace}
                  onChange={(e) => setBulkApplyNamespace(e.target.checked)}
                  className="h-3 w-3"
                />
                Move to namespace
              </label>
              {bulkApplyNamespace && (
                <div className="space-y-2">
                  <MonoSelect
                    value={bulkNamespaceInput}
                    onChange={setBulkNamespaceInput}
                    options={[
                      { value: '', label: '[none]' },
                      ...registryNamespaces.map(ns => ({ value: ns, label: ns }))
                    ]}
                    className="w-full"
                    placeholder="[none]"
                    size="sm"
                  />
                  <p className="text-[0.6rem] text-gray-500">
                    Move selected images to a different namespace. Empty clears the namespace.
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-2 border-t border-gray-200 pt-3">
              <p className="text-[0.65rem] text-gray-500 uppercase tracking-wide">Animate selection</p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-[0.65rem] text-gray-600">
                  FPS
                  <input
                    type="number"
                    min="0.1"
                    step="0.5"
                    value={bulkAnimateFps}
                    onChange={(e) => {
                      setBulkAnimateTouched(true);
                      setBulkAnimateFps(e.target.value);
                    }}
                    className="w-20 border border-gray-300 rounded px-2 py-1"
                  />
                </label>
                <label className="flex items-center gap-2 text-[0.65rem] text-gray-600">
                  Loop
                  <input
                    type="checkbox"
                    checked={bulkAnimateLoop}
                    onChange={(e) => setBulkAnimateLoop(e.target.checked)}
                    className="h-3 w-3"
                  />
                </label>
                <label className="flex items-center gap-2 text-[0.65rem] text-gray-600">
                  Output name
                  <input
                    type="text"
                    value={bulkAnimateFilename}
                    onChange={(e) => setBulkAnimateFilename(e.target.value)}
                    placeholder="animated-webp"
                    className="w-40 border border-gray-300 rounded px-2 py-1"
                  />
                </label>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={createBulkAnimation}
                  disabled={bulkAnimateLoading || selectedCount < 2}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-md disabled:opacity-50"
                >
                  {bulkAnimateLoading ? 'Building…' : 'Create animated WebP'}
                </button>
                {bulkAnimateError && <p className="text-[0.65rem] text-red-600">{bulkAnimateError}</p>}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={closeBulkEditModal}
                className="px-4 py-2 border border-gray-300 rounded-md"
                disabled={bulkUpdating}
              >
                Cancel
              </button>
              <button
                onClick={applyBulkUpdates}
                disabled={bulkUpdating}
                className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50"
              >
                {bulkUpdating ? 'Updating…' : 'Apply changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hover Preview */}
      {hoveredImage && showPreview && (
        <HoverPreview
          imageId={hoveredImage}
          filename={images.find(img => img.id === hoveredImage)?.filename || 'Unknown'}
          isVisible={showPreview}
          mousePosition={mousePosition}
          onClose={handleMouseLeave}
          dimensions={images.find(img => img.id === hoveredImage)?.dimensions}
        />
      )}
    </div>
  );
});

ImageGallery.displayName = 'ImageGallery';

export default ImageGallery;
