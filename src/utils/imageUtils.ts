// Cloudflare Images utility functions

export interface ImageVariant {
  name: string;
  value: string;
  description: string;
  width?: number;
}

// Predefined image variants for easy use
export const IMAGE_VARIANTS: ImageVariant[] = [
  { name: 'original', value: 'public', description: 'Original full size', width: undefined },
  { name: 'small', value: 'w=300', description: 'Small (300px width)', width: 300 },
  { name: 'medium', value: 'w=600', description: 'Medium (600px width)', width: 600 },
  { name: 'large', value: 'w=900', description: 'Large (900px width)', width: 900 },
  { name: 'xlarge', value: 'w=1200', description: 'Extra Large (1200px width)', width: 1200 },
  { name: 'thumbnail', value: 'w=150', description: 'Thumbnail size (150px width)', width: 150 },
];

/**
 * Generate a Cloudflare Images URL for a specific variant/size
 * @param imageId - The Cloudflare image ID
 * @param variant - The variant name ('small', 'medium', 'large', etc.) or custom transform string
 * @param accountHash - Your Cloudflare account hash (from environment)
 * @returns The complete image URL
 */
export function getCloudflareImageUrl(
  imageId: string, 
  variant: string = 'original',
  accountHash?: string
): string {
  const hash = accountHash || process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH;
  
  if (!hash) {
    throw new Error('Cloudflare account hash not found');
  }

  // Check if it's a predefined variant
  const predefinedVariant = IMAGE_VARIANTS.find(v => v.name === variant);
  const variantValue = predefinedVariant ? predefinedVariant.value : variant;

  const includesParams = variantValue.includes('?');
  const base = `https://imagedelivery.net/${hash}/${imageId}/${variantValue}`;
  if (variantValue.includes('format=')) {
    return base;
  }
  return `${base}${includesParams ? '&' : '?'}format=webp`;
}

/**
 * Get multiple URLs for an image at different sizes
 * @param imageId - The Cloudflare image ID
 * @param variants - Array of variant names to generate URLs for
 * @param accountHash - Your Cloudflare account hash
 * @returns Object with variant names as keys and URLs as values
 */
export function getMultipleImageUrls(
  imageId: string,
  variants: string[] = ['small', 'medium', 'large', 'original'],
  accountHash?: string
): Record<string, string> {
  const urls: Record<string, string> = {};
  
  variants.forEach(variant => {
    urls[variant] = getCloudflareImageUrl(imageId, variant, accountHash);
  });

  return urls;
}

/**
 * Generate a responsive image srcSet for use with Next.js Image component
 * @param imageId - The Cloudflare image ID
 * @param accountHash - Your Cloudflare account hash
 * @returns srcSet string for responsive images
 */
export function getResponsiveSrcSet(imageId: string, accountHash?: string): string {
  const sizes = [
    { width: 300, descriptor: '300w' },
    { width: 600, descriptor: '600w' },
    { width: 900, descriptor: '900w' },
    { width: 1200, descriptor: '1200w' },
  ];

  return sizes
    .map(({ width, descriptor }) => 
      `${getCloudflareImageUrl(imageId, `w=${width}`, accountHash)} ${descriptor}`
    )
    .join(', ');
}

/**
 * Get an image URL with custom Cloudflare transformations
 * @param imageId - The Cloudflare image ID
 * @param transformations - Object with transformation parameters
 * @param accountHash - Your Cloudflare account hash
 * @returns The complete image URL with transformations
 */
export function getCustomImageUrl(
  imageId: string,
  transformations: {
    width?: number;
    height?: number;
    fit?: 'scale-down' | 'contain' | 'cover' | 'crop' | 'pad';
    gravity?: 'auto' | 'side' | 'left' | 'right' | 'top' | 'bottom' | 'center';
    quality?: number;
    format?: 'auto' | 'avif' | 'webp' | 'jpg' | 'png';
  },
  accountHash?: string
): string {
  const params = new URLSearchParams();
  
  if (transformations.width) params.append('w', transformations.width.toString());
  if (transformations.height) params.append('h', transformations.height.toString());
  if (transformations.fit) params.append('fit', transformations.fit);
  if (transformations.gravity) params.append('gravity', transformations.gravity);
  if (transformations.quality) params.append('quality', transformations.quality.toString());
  if (transformations.format) params.append('format', transformations.format);

  const variantString = params.toString();
  return getCloudflareImageUrl(imageId, variantString, accountHash);
}

/**
 * Common aspect ratios for easy recognition
 */
export const COMMON_ASPECT_RATIOS = [
  { ratio: 16/9, name: '16:9' },
  { ratio: 4/3, name: '4:3' },
  { ratio: 3/2, name: '3:2' },
  { ratio: 1/1, name: '1:1' },
  { ratio: 4/5, name: '4:5' },
  { ratio: 2/3, name: '2:3' },
  { ratio: 3/4, name: '3:4' },
  { ratio: 9/16, name: '9:16' },
  { ratio: 5/4, name: '5:4' },
  { ratio: 21/9, name: '21:9' },
];

/**
 * Calculate aspect ratio from width and height
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns Object with decimal ratio and nearest common ratio name
 */
export function calculateAspectRatio(width: number, height: number): {
  decimal: number;
  common: string;
  dimensions: { width: number; height: number };
} {
  const decimal = width / height;
  
  // Find the closest common aspect ratio
  let closestRatio = COMMON_ASPECT_RATIOS[0];
  let smallestDifference = Math.abs(decimal - closestRatio.ratio);
  
  for (const commonRatio of COMMON_ASPECT_RATIOS) {
    const difference = Math.abs(decimal - commonRatio.ratio);
    if (difference < smallestDifference) {
      smallestDifference = difference;
      closestRatio = commonRatio;
    }
  }
  
  // If the difference is very small (within 0.05), use the common ratio
  // Otherwise, create a custom ratio string
  const threshold = 0.05;
  const ratioName = smallestDifference < threshold 
    ? closestRatio.name 
    : `${Math.round(width/10)}:${Math.round(height/10)}`;
  
  return {
    decimal,
    common: ratioName,
    dimensions: { width, height }
  };
}

/**
 * Load an image and return its dimensions
 * @param imageUrl - The image URL to load
 * @returns Promise with image dimensions
 */
export function getImageDimensions(imageUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight
      });
    };
    
    img.onerror = () => {
      reject(new Error(`Failed to load image: ${imageUrl}`));
    };
    
    // Set crossOrigin to handle CORS for Cloudflare Images
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;
  });
}
