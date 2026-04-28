'use client';

import { useEffect, useRef, useState } from 'react';
import ImageUploader from '@/components/ImageUploader';
import ImageGallery from '@/components/ImageGallery';
import { parseGalleryNamespaceFromSearch } from '@/components/gallery/focusNavigation';

export default function Home() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const galleryRef = useRef<{ refreshImages: () => void }>(null);
  const envDefaultNamespace = process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
  // Keep the initial server/client render deterministic; hydrate from localStorage in an effect.
  const [namespace, setNamespace] = useState<string>(envDefaultNamespace);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const queryNamespace = parseGalleryNamespaceFromSearch(window.location.search);
    const stored = window.localStorage.getItem('imageNamespace');
    const nextNamespace =
      queryNamespace !== undefined
        ? queryNamespace
        : stored === '__none__'
          ? ''
          : stored === '__all__'
            ? '__all__'
            : stored || envDefaultNamespace;
    if (queryNamespace !== undefined) {
      if (nextNamespace === '') {
        window.localStorage.setItem('imageNamespace', '__none__');
      } else if (nextNamespace === '__all__') {
        window.localStorage.setItem('imageNamespace', '__all__');
      } else {
        window.localStorage.setItem('imageNamespace', nextNamespace);
      }
    }
    setNamespace((prev) => (prev === nextNamespace ? prev : nextNamespace));
  }, [envDefaultNamespace]);

  const handleNamespaceChange = (value: string) => {
    if (typeof window !== 'undefined') {
      if (value === '') {
        window.localStorage.setItem('imageNamespace', '__none__');
      } else if (value === '__all__') {
        window.localStorage.setItem('imageNamespace', '__all__');
      } else {
        window.localStorage.setItem('imageNamespace', value);
      }
    }
    setNamespace(value);
    // Gallery handles refresh via useEffect when namespace changes
  };

  const handleImageUploaded = () => {
    // Trigger gallery refresh (single path to avoid extra parent churn)
    if (galleryRef.current) {
      galleryRef.current.refreshImages();
    } else {
      // Fallback only when ref is unavailable
      setRefreshTrigger(prev => prev + 1);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 overscroll-none">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          <section className="z-999" id="gallery-section">
            <ImageGallery
              ref={galleryRef}
              refreshTrigger={refreshTrigger}
              namespace={namespace}
              onNamespaceChange={handleNamespaceChange}
            />
          </section>
          <section id="uploader-section" className="max-w-5xl">
            <p className="text-sm font-mono text-gray-900 mb-2">
              Cloudflare Image Upload
            </p>
            <ImageUploader
              onImageUploaded={handleImageUploaded}
              namespace={namespace}
              onNamespaceChange={handleNamespaceChange}
            />
          </section>
        </div>
      </div>
    </main>
  );
}
