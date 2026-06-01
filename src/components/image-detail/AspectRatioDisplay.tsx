import { useImageAspectRatio } from '@/hooks/useImageAspectRatio';

const OrientationIcon = ({ aspectRatio }: { aspectRatio: string }) => {
  const parts = aspectRatio.split(':');
  if (parts.length === 2) {
    const width = parseFloat(parts[0]);
    const height = parseFloat(parts[1]);
    const ratio = width / height;

    if (Math.abs(ratio - 1) < 0.1) {
      return (
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="inline-block">
          <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="0.8" />
        </svg>
      );
    }
    if (ratio > 1) {
      return (
        <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor" className="inline-block">
          <rect x="1" y="1" width="8" height="4" fill="none" stroke="currentColor" strokeWidth="0.8" />
        </svg>
      );
    }
    return (
      <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor" className="inline-block">
        <rect x="1" y="1" width="4" height="8" fill="none" stroke="currentColor" strokeWidth="0.8" />
      </svg>
    );
  }

  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="inline-block">
      <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
};

export const AspectRatioDisplay = ({ imageId, className }: { imageId: string; className?: string }) => {
  const { aspectRatio, loading, error } = useImageAspectRatio(imageId, Boolean(imageId));

  if (!imageId) {
    return null;
  }

  if (loading) {
    return (
      <p className={`text-[11px] font-mono text-gray-400 ${className ?? ''}`}>
        <span className="inline-block w-8 h-2 bg-gray-200 rounded animate-pulse" />
      </p>
    );
  }

  if (error || !aspectRatio) {
    return <p className={`text-[11px] font-mono text-gray-400 ${className ?? ''}`}>--</p>;
  }

  return (
    <p className={`text-[11px] font-mono text-gray-500 flex items-center gap-1 ${className ?? ''}`}>
      {aspectRatio} <OrientationIcon aspectRatio={aspectRatio} />
    </p>
  );
};
