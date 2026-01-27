/**
 * useGalleryPagination Hook
 * 
 * Manages pagination state and navigation.
 */

'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { CloudflareImage, DateFilter } from '../types';
import { DEFAULT_PAGE_SIZE } from '../constants';
import { formatDateRangeLabel } from '../utils';

interface UseGalleryPaginationOptions {
  filteredImages: CloudflareImage[];
  initialPage: number;
  initialPageSize: number;
  onFilterChange?: () => void;
}

interface UseGalleryPaginationReturn {
  currentPage: number;
  setCurrentPage: (page: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  totalPages: number;
  pageImages: CloudflareImage[];
  showPagination: boolean;
  hasResults: boolean;
  pageIndex: number;
  
  // Navigation
  goToPageNumber: (target: number) => void;
  goToPreviousPage: () => void;
  goToNextPage: () => void;
  goToFirstPage: () => void;
  goToLastPage: () => void;
  jumpBackTenPages: () => void;
  jumpForwardTenPages: () => void;
  
  // Date range labels
  currentPageRangeLabel: string | null;
  prevPageRangeLabel: string | null;
  nextPageRangeLabel: string | null;
  
  // Scroll
  scrollGalleryToTop: () => void;
}

export function useGalleryPagination({
  filteredImages,
  initialPage,
  initialPageSize,
}: UseGalleryPaginationOptions): UseGalleryPaginationReturn {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize || DEFAULT_PAGE_SIZE);
  const galleryTopRef = useRef<HTMLDivElement | null>(null);
  const didInitFilterPageRef = useRef(false);

  const totalPages = Math.max(1, Math.ceil(filteredImages.length / pageSize));
  const pageIndex = Math.min(currentPage, totalPages);
  const pageSliceStart = (pageIndex - 1) * pageSize;
  const pageImages = filteredImages.slice(pageSliceStart, pageSliceStart + pageSize);
  const showPagination = filteredImages.length > pageSize;
  const hasResults = filteredImages.length > 0;

  // Scroll to top
  const scrollGalleryToTop = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }, []);

  // Navigation functions
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

  const goToPreviousPage = useCallback(() => goToPageNumber(pageIndex - 1), [goToPageNumber, pageIndex]);
  const goToNextPage = useCallback(() => goToPageNumber(pageIndex + 1), [goToPageNumber, pageIndex]);
  const goToFirstPage = useCallback(() => goToPageNumber(1), [goToPageNumber]);
  const goToLastPage = useCallback(() => goToPageNumber(totalPages), [goToPageNumber, totalPages]);
  const jumpBackTenPages = useCallback(() => goToPageNumber(pageIndex - 10), [goToPageNumber, pageIndex]);
  const jumpForwardTenPages = useCallback(() => goToPageNumber(pageIndex + 10), [goToPageNumber, pageIndex]);

  // Adjust current page if it exceeds total pages
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Date range labels
  const currentPageRangeLabel = useMemo(() => formatDateRangeLabel(pageImages), [pageImages]);
  
  const getPageDateRangeLabel = useCallback(
    (pageNumber: number) => {
      if (pageNumber < 1 || pageNumber > totalPages) return null;
      const startIndex = (pageNumber - 1) * pageSize;
      const slice = filteredImages.slice(startIndex, startIndex + pageSize);
      return formatDateRangeLabel(slice);
    },
    [filteredImages, pageSize, totalPages]
  );

  const prevPageRangeLabel = useMemo(() => getPageDateRangeLabel(pageIndex - 1), [getPageDateRangeLabel, pageIndex]);
  const nextPageRangeLabel = useMemo(() => getPageDateRangeLabel(pageIndex + 1), [getPageDateRangeLabel, pageIndex]);

  // Scroll to top on initial mount
  useEffect(() => {
    scrollGalleryToTop();
  }, [scrollGalleryToTop]);

  return {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    pageImages,
    showPagination,
    hasResults,
    pageIndex,
    goToPageNumber,
    goToPreviousPage,
    goToNextPage,
    goToFirstPage,
    goToLastPage,
    jumpBackTenPages,
    jumpForwardTenPages,
    currentPageRangeLabel,
    prevPageRangeLabel,
    nextPageRangeLabel,
    scrollGalleryToTop,
  };
}
