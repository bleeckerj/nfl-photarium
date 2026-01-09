import { 
  getCloudflareImageUrl, 
  getMultipleImageUrls, 
  getCustomImageUrl,
  getResponsiveSrcSet 
} from '@/utils/imageUtils';

// Example usage of Cloudflare Images utility functions

const imageId = 'your-image-id-here';

// Get URLs at different preset sizes
const smallUrl = getCloudflareImageUrl(imageId, 'small');     // 100px width
const mediumUrl = getCloudflareImageUrl(imageId, 'medium');   // 300px width
const largeUrl = getCloudflareImageUrl(imageId, 'large');     // 800px width
const originalUrl = getCloudflareImageUrl(imageId, 'original'); // Full size

console.log('Small image:', smallUrl);
console.log('Medium image:', mediumUrl);
console.log('Large image:', largeUrl);
console.log('Original image:', originalUrl);

// Get multiple sizes at once
const allSizes = getMultipleImageUrls(imageId, ['small', 'medium', 'large', 'full']);
console.log('All sizes:', allSizes);

// Get custom transformations
const customUrl = getCustomImageUrl(imageId, {
  width: 500,
  height: 300,
  fit: 'cover',
  quality: 85,
  format: 'webp'
});
console.log('Custom transformed image:', customUrl);

// Get responsive srcSet for Next.js Image component
const srcSet = getResponsiveSrcSet(imageId);
console.log('Responsive srcSet:', srcSet);

// Example: Using with Next.js Image component
/*
<Image
  src={getCloudflareImageUrl(imageId, 'medium')}
  alt="Description"
  width={300}
  height={200}
  srcSet={getResponsiveSrcSet(imageId)}
  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
/>
*/

export {};
