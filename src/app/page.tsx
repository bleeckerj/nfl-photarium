'use client';

import { useEffect, useRef, useState } from 'react';
import ImageUploader from '@/components/ImageUploader';
import ImageGallery from '@/components/ImageGallery';

export default function Home() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const galleryRef = useRef<{ refreshImages: () => void }>(null);
  // Initialize with the environment variable default to avoid "no namespace" flash/defaulting
  const [namespace, setNamespace] = useState<string>(process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('imageNamespace');
    const envDefault = process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
    if (stored === '__none__') {
      setNamespace('');
    } else {
      setNamespace(stored || envDefault);
    }
  }, []);

  const handleNamespaceChange = (value: string) => {
    if (typeof window !== 'undefined') {
      if (value === '') {
        window.localStorage.setItem('imageNamespace', '__none__');
      } else {
        window.localStorage.setItem('imageNamespace', value);
      }
    }
    setNamespace(value);
    // Gallery handles refresh via useEffect when namespace changes
  };

  const handleImageUploaded = () => {
    // Trigger gallery refresh
    if (galleryRef.current) {
      galleryRef.current.refreshImages();
    }
    // Also update the trigger as a fallback
    setRefreshTrigger(prev => prev + 1);
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
          <section id="uploader-section" className="max-w-4xl">
            <p className="text-sm font-mono text-gray-900 mb-2">
              Cloudflare Image Upload
            </p>
            <ImageUploader onImageUploaded={handleImageUploaded} namespace={namespace} />
          </section>
        </div>
      </div>
    </main>
  );
}
