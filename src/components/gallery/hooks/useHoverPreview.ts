import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';

export const useHoverPreview = () => {
  const [hoveredImage, setHoveredImage] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = useCallback((imageId: string, event: MouseEvent) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setHoveredImage(imageId);
    setMousePosition({ x: event.clientX, y: event.clientY });
    hoverTimeoutRef.current = setTimeout(() => {
      setShowPreview(true);
    }, 300);
  }, []);

  const handleMouseMove = useCallback((imageId: string, event: MouseEvent) => {
    if (hoveredImage === imageId) {
      setMousePosition({ x: event.clientX, y: event.clientY });
    }
  }, [hoveredImage]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setShowPreview(false);
    setHoveredImage(null);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  return {
    hoveredImage,
    showPreview,
    mousePosition,
    handleMouseEnter,
    handleMouseMove,
    handleMouseLeave,
  };
};
