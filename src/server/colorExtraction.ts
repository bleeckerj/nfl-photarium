/**
 * Color Extraction Service
 * 
 * Extracts color information from images for color-based similarity search:
 * - Color histogram: 64-bin RGB histogram for palette matching
 * - Dominant colors: Top N colors via k-means clustering
 * - Average color: Simple mean RGB value
 * 
 * These embeddings enable searches like "find blue images" or 
 * "find images with similar color palette".
 */

import sharp from 'sharp';

// Color histogram uses 4 bins per channel (4^3 = 64 total bins)
export const COLOR_HISTOGRAM_DIM = 64;
export const COLOR_HISTOGRAM_BINS_PER_CHANNEL = 4;

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ColorInfo {
  /** 64-bin RGB histogram (normalized, sums to 1) */
  histogram: number[];
  /** Top 5 dominant colors as hex strings */
  dominantColors: string[];
  /** Average color as hex string */
  averageColor: string;
  /** Average color as RGB */
  averageRgb: RGB;
}

/**
 * Extract color information from an image URL
 * 
 * @param imageUrl - URL of the image to analyze
 * @returns Color information including histogram and dominant colors
 */
export async function extractColorsFromUrl(imageUrl: string): Promise<ColorInfo | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error(`[Color] Failed to fetch image: ${response.status}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return extractColorsFromBuffer(buffer);
  } catch (error) {
    console.error('[Color] Error extracting colors from URL:', error);
    return null;
  }
}

/**
 * Extract color information from image bytes
 * 
 * @param imageBuffer - Raw image data
 * @returns Color information including histogram and dominant colors
 */
export async function extractColorsFromBuffer(imageBuffer: Buffer): Promise<ColorInfo | null> {
  try {
    // Resize to small size for faster processing (color doesn't need high res)
    const { data, info } = await sharp(imageBuffer)
      .resize(100, 100, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixelCount = info.width * info.height;
    const pixels: RGB[] = [];

    // Extract all pixel colors
    for (let i = 0; i < data.length; i += 3) {
      pixels.push({
        r: data[i],
        g: data[i + 1],
        b: data[i + 2],
      });
    }

    // Calculate histogram
    const histogram = calculateHistogram(pixels);

    // Calculate average color
    const averageRgb = calculateAverageColor(pixels);
    const averageColor = rgbToHex(averageRgb);

    // Extract dominant colors via simplified k-means
    const dominantColors = extractDominantColors(pixels, 5).map(rgbToHex);

    return {
      histogram,
      dominantColors,
      averageColor,
      averageRgb,
    };
  } catch (error) {
    console.error('[Color] Error extracting colors:', error);
    return null;
  }
}

/**
 * Calculate a 64-bin RGB histogram
 * Each channel is quantized to 4 levels (0-3), giving 4^3 = 64 bins
 */
function calculateHistogram(pixels: RGB[]): number[] {
  const histogram = new Array(COLOR_HISTOGRAM_DIM).fill(0);

  for (const pixel of pixels) {
    // Quantize each channel to 0-3 range
    const rBin = Math.min(3, Math.floor(pixel.r / 64));
    const gBin = Math.min(3, Math.floor(pixel.g / 64));
    const bBin = Math.min(3, Math.floor(pixel.b / 64));

    // Calculate bin index: r * 16 + g * 4 + b
    const binIndex = rBin * 16 + gBin * 4 + bBin;
    histogram[binIndex]++;
  }

  // Normalize to sum to 1
  const total = pixels.length;
  return histogram.map(count => count / total);
}

/**
 * Calculate average color of all pixels
 */
function calculateAverageColor(pixels: RGB[]): RGB {
  if (pixels.length === 0) {
    return { r: 0, g: 0, b: 0 };
  }

  let sumR = 0, sumG = 0, sumB = 0;
  for (const pixel of pixels) {
    sumR += pixel.r;
    sumG += pixel.g;
    sumB += pixel.b;
  }

  return {
    r: Math.round(sumR / pixels.length),
    g: Math.round(sumG / pixels.length),
    b: Math.round(sumB / pixels.length),
  };
}

/**
 * Extract dominant colors using simplified k-means clustering
 * 
 * This is a fast approximation - for production, consider using
 * a proper k-means library for better results.
 */
function extractDominantColors(pixels: RGB[], k: number): RGB[] {
  if (pixels.length === 0) return [];
  if (pixels.length <= k) return [...pixels];

  // Initialize centroids by sampling evenly from pixels
  const step = Math.floor(pixels.length / k);
  let centroids: RGB[] = [];
  for (let i = 0; i < k; i++) {
    centroids.push({ ...pixels[i * step] });
  }

  // Run k-means for a fixed number of iterations
  const maxIterations = 10;
  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign each pixel to nearest centroid
    const clusters: RGB[][] = Array.from({ length: k }, () => []);

    for (const pixel of pixels) {
      let minDist = Infinity;
      let closestIdx = 0;

      for (let i = 0; i < centroids.length; i++) {
        const dist = colorDistance(pixel, centroids[i]);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = i;
        }
      }

      clusters[closestIdx].push(pixel);
    }

    // Update centroids to cluster means
    const newCentroids: RGB[] = [];
    for (let i = 0; i < k; i++) {
      if (clusters[i].length > 0) {
        newCentroids.push(calculateAverageColor(clusters[i]));
      } else {
        // Keep old centroid if cluster is empty
        newCentroids.push(centroids[i]);
      }
    }

    centroids = newCentroids;
  }

  // Sort by cluster size (most dominant first)
  // Re-calculate cluster sizes
  const clusterSizes: number[] = new Array(k).fill(0);
  for (const pixel of pixels) {
    let minDist = Infinity;
    let closestIdx = 0;
    for (let i = 0; i < centroids.length; i++) {
      const dist = colorDistance(pixel, centroids[i]);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }
    clusterSizes[closestIdx]++;
  }

  // Sort centroids by cluster size
  const indexed = centroids.map((c, i) => ({ color: c, size: clusterSizes[i] }));
  indexed.sort((a, b) => b.size - a.size);

  return indexed.map(item => item.color);
}

/**
 * Calculate Euclidean distance between two colors in RGB space
 */
function colorDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Convert RGB to hex string
 */
export function rgbToHex(rgb: RGB): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Parse hex color to RGB
 */
export function hexToRgb(hex: string): RGB | null {
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;

  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

/**
 * Calculate color histogram similarity using histogram intersection
 * 
 * @param a - First histogram
 * @param b - Second histogram  
 * @returns Similarity score between 0 and 1 (1 = identical)
 */
export function histogramSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Histogram dimension mismatch: ${a.length} vs ${b.length}`);
  }

  // Histogram intersection: sum of min values
  let intersection = 0;
  for (let i = 0; i < a.length; i++) {
    intersection += Math.min(a[i], b[i]);
  }

  return intersection;
}

/**
 * Batch extract colors from multiple images
 * 
 * @param imageUrls - Array of image URLs
 * @param concurrency - Maximum concurrent extractions (default: 10)
 * @param onProgress - Optional progress callback
 * @returns Map of URL to color info (null for failed)
 */
export async function batchExtractColors(
  imageUrls: string[],
  concurrency = 10,
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, ColorInfo | null>> {
  const results = new Map<string, ColorInfo | null>();
  let completed = 0;

  for (let i = 0; i < imageUrls.length; i += concurrency) {
    const batch = imageUrls.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const colors = await extractColorsFromUrl(url);
        return { url, colors };
      })
    );

    for (const { url, colors } of batchResults) {
      results.set(url, colors);
      completed++;
    }

    if (onProgress) {
      onProgress(completed, imageUrls.length);
    }
  }

  return results;
}
