'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ImageUploader from '@/components/ImageUploader';
import ImageGallery from '@/components/ImageGallery';
import TextSearch from '@/components/TextSearch';
import { RedisInfoModal } from '@/components/RedisInfoModal';
import { Database } from 'lucide-react';

export default function Home() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const galleryRef = useRef<{ refreshImages: () => void }>(null);
  // Initialize with the environment variable default to avoid "no namespace" flash/defaulting
  const [namespace, setNamespace] = useState<string>(process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '');
  const [isVectorReady, setIsVectorReady] = useState(false);
  const [showRedisInfo, setShowRedisInfo] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('imageNamespace');
    const envDefault = process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
    if (stored === '__none__') {
      setNamespace('');
    } else if (stored === '__all__') {
      setNamespace('__all__');
    } else {
      setNamespace(stored || envDefault);
    }

    // Check availability of vector search
    fetch('/api/images/vectors/status')
      .then(res => res.json())
      .then(data => setIsVectorReady(data.available ?? false))
      .catch(() => setIsVectorReady(false));
  }, []);

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

  const router = useRouter();

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
          {/* Semantic Search - only show if Redis is available */}
          {isVectorReady ? (
            <section id="search-section" className="max-w-md">
              <details className="group">
                <summary className="text-sm font-mono text-gray-900 mb-2 cursor-pointer list-none flex items-center gap-2">
                  <span className="text-gray-400 group-open:rotate-90 transition-transform">▶</span>
                  Semantic Search
                </summary>
                <div className="mt-2">
                  <TextSearch 
                    onImageClick={(id) => router.push(`/images/${id}`)}
                  />
                </div>
              </details>
            </section>
          ) : (
            <section id="search-section-disabled" className="max-w-md">
              <button 
                onClick={() => setShowRedisInfo(true)}
                className="text-sm font-mono text-gray-400 mb-2 cursor-pointer flex items-center gap-2 hover:text-gray-600 transition-colors group"
                title="Click for more info"
              >
                <Database className="w-4 h-4 text-gray-300 group-hover:text-gray-500" />
                <span className="line-through decoration-gray-300">Semantic Search</span>
                <span className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-500 group-hover:bg-gray-200">Disabled</span>
              </button>
              <RedisInfoModal isOpen={showRedisInfo} onClose={() => setShowRedisInfo(false)} />
            </section>
          )}
          
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
            <ImageUploader onImageUploaded={handleImageUploaded} namespace={namespace === '__all__' ? '' : namespace} />
          </section>
        </div>
      </div>
    </main>
  );
}
