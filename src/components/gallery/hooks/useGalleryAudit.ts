/**
 * useGalleryAudit Hook
 * 
 * Handles broken URL audit functionality.
 */

'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { loadBrokenAudit, persistBrokenAudit } from '../storage';
import { AUDIT_LOG_LIMIT } from '../constants';
import type { CloudflareImage, BrokenAudit, AuditLogEntry, AuditProgress } from '../types';

interface UseGalleryAuditOptions {
  images: CloudflareImage[];
  selectedVariant: string;
  toast: { push: (message: string) => void };
}

interface UseGalleryAuditReturn {
  brokenAudit: BrokenAudit;
  brokenImageIds: Set<string>;
  auditLoading: boolean;
  auditProgress: AuditProgress;
  auditEntries: AuditLogEntry[];
  runBrokenAudit: () => Promise<void>;
}

export function useGalleryAudit({
  images,
  selectedVariant,
  toast,
}: UseGalleryAuditOptions): UseGalleryAuditReturn {
  const [brokenAudit, setBrokenAudit] = useState<BrokenAudit>(() => loadBrokenAudit());
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditProgress, setAuditProgress] = useState<AuditProgress>({ checked: 0, total: 0 });
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);

  const brokenImageIds = useMemo(() => new Set(brokenAudit.ids), [brokenAudit.ids]);

  // Persist broken audit
  useEffect(() => {
    persistBrokenAudit(brokenAudit);
  }, [brokenAudit]);

  // Clean up broken audit IDs when images change
  useEffect(() => {
    if (!brokenAudit.ids.length) return;
    const validIds = new Set(images.map(img => img.id));
    setBrokenAudit(prev => {
      const filtered = prev.ids.filter(id => validIds.has(id));
      if (filtered.length === prev.ids.length) return prev;
      return { ...prev, ids: filtered };
    });
  }, [images, brokenAudit.ids.length]);

  const runBrokenAudit = useCallback(async () => {
    if (typeof window === 'undefined') return;
    
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
        
        const checkedCount = Number.isFinite(payload.checked)
          ? payload.checked
          : results.length || chunkSize;
        const nextChecked = Math.min(total, offset + checkedCount);
        setAuditProgress({ checked: nextChecked, total });
        offset += chunkSize;
      }
      
      setBrokenAudit({
        checkedAt: new Date().toISOString(),
        ids: Array.from(brokenIds),
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

  return {
    brokenAudit,
    brokenImageIds,
    auditLoading,
    auditProgress,
    auditEntries,
    runBrokenAudit,
  };
}
