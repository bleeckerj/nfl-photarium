'use client';

import { useCallback, useMemo, useState, type CSSProperties } from 'react';

export type RotatedVideoAsset = {
  id: string;
  playbackUrl?: string;
  filename: string;
};

export const normalizeRotationPreview = (value: number) => ((value % 360) + 360) % 360;

export function useVideoRotation(videoId: string) {
  const [previewRotation, setPreviewRotation] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotatedAsset, setRotatedAsset] = useState<RotatedVideoAsset | null>(null);
  const normalizedRotation = normalizeRotationPreview(previewRotation);

  const previewStyle = useMemo<CSSProperties>(() => ({
    transform: `rotate(${previewRotation}deg)`,
    transformOrigin: 'center center',
    transition: 'transform 200ms ease',
  }), [previewRotation]);

  const adjust = useCallback((delta: -90 | 90) => {
    setPreviewRotation((current) => current + delta);
    setError(null);
    setRotatedAsset(null);
  }, []);

  const confirm = useCallback(async () => {
    if (normalizedRotation !== 90 && normalizedRotation !== 180 && normalizedRotation !== 270) {
      setError('Rotate left or right before confirming');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(videoId)}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ degrees: normalizedRotation }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === 'string' ? payload.error : 'Failed to rotate video'
        );
      }
      const created = payload?.video as RotatedVideoAsset | undefined;
      if (!created?.id) throw new Error('Rotation completed without a new video asset');
      setRotatedAsset(created);
      setPreviewRotation(0);
    } catch (rotationError) {
      setError(rotationError instanceof Error ? rotationError.message : 'Failed to rotate video');
    } finally {
      setLoading(false);
    }
  }, [normalizedRotation, videoId]);

  return {
    normalizedRotation,
    previewStyle,
    loading,
    error,
    rotatedAsset,
    adjust,
    confirm,
  };
}
