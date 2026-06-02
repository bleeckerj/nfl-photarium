'use client';

export function GalleryLoadingState() {
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
