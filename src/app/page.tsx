'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import ImageUploader from '@/components/ImageUploader';
import ImageGallery from '@/components/ImageGallery';
import {
  GALLERY_NAMESPACE_STORAGE_KEY,
  parseGalleryNamespaceFromSearch,
} from '@/components/gallery/focusNavigation';
import { useSearchParams } from 'next/navigation';

function HomeContent() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const galleryRef = useRef<{ refreshImages: () => void }>(null);
  const envDefaultNamespace = process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || 'cf-default';
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const galleryInstanceKey = search ? `gallery:${search}` : 'gallery';
  // Derive the initial namespace synchronously from the URL so that a navigation
  // like /?gns=__all__&focus=<id> passes the correct scope into ImageGallery on
  // its very first render. Without this, the gallery would mount under the env
  // default namespace, decide the focus target's namespace doesn't match, and
  // drop the focus on the first fetch -- producing the "all namespaces, page 1"
  // regression. localStorage hydration still happens in the effect below for
  // the no-query case, since localStorage isn't available during SSR.
  const [namespace, setNamespace] = useState<string>(() => {
    const queryNamespace = parseGalleryNamespaceFromSearch(search);
    if (queryNamespace !== undefined) {
      return queryNamespace || envDefaultNamespace;
    }
    return envDefaultNamespace;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const queryNamespace = parseGalleryNamespaceFromSearch(search);
    const stored = window.localStorage.getItem(GALLERY_NAMESPACE_STORAGE_KEY);
    const nextNamespace =
      queryNamespace !== undefined
        ? (queryNamespace || envDefaultNamespace)
        : stored === '__none__'
          ? envDefaultNamespace
          : stored === '__all__'
            ? '__all__'
            : stored || envDefaultNamespace;
    if (queryNamespace !== undefined) {
      if (nextNamespace === '__all__') {
        window.localStorage.setItem(GALLERY_NAMESPACE_STORAGE_KEY, '__all__');
      } else {
        window.localStorage.setItem(GALLERY_NAMESPACE_STORAGE_KEY, nextNamespace);
      }
    }
    setNamespace((prev) => (prev === nextNamespace ? prev : nextNamespace));
  }, [envDefaultNamespace, search]);

  const handleNamespaceChange = (value: string) => {
    if (typeof window !== 'undefined') {
      if (value === '__all__') {
        window.localStorage.setItem(GALLERY_NAMESPACE_STORAGE_KEY, '__all__');
      } else {
        window.localStorage.setItem(GALLERY_NAMESPACE_STORAGE_KEY, value || envDefaultNamespace);
      }
    }
    setNamespace(value || envDefaultNamespace);
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
              key={galleryInstanceKey}
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

export default function Home() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-gray-50" />}>
      <HomeContent />
    </Suspense>
  );
}
