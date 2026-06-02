/**
 * Headless browser scrolling endpoint for infinite scroll pages.
 * 
 * This uses Puppeteer to:
 * 1. Load the page in a headless browser
 * 2. Scroll down to trigger lazy loading
 * 3. Wait for new images to appear
 * 4. Repeat until no new content or max scrolls reached
 * 5. Extract all image URLs
 * 
 * Requires: npm install puppeteer
 * 
 * Environment variables:
 * - PUPPETEER_EXECUTABLE_PATH: Path to Chrome/Chromium (optional, auto-detects)
 * - IMPORT_SCROLL_MAX_SCROLLS: Max number of scroll iterations (default: 10)
 * - IMPORT_SCROLL_TIMEOUT_MS: Initial DOM navigation timeout (default: 30000)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  isPrivateHost,
  isValidUrl,
  serializeMediaCandidate,
  shouldIncludeImageWithOptions,
} from '@/server/page-import/scrollMediaCandidates';
import { extractMediaFromPage } from '@/server/page-import/scrollPuppeteer';
import { normalizeCookieHeader } from '@/server/pageImportCookies';

const DEFAULT_MAX_SCROLLS = 10;
const DEFAULT_SCROLL_DELAY_MS = 1500;
const DEFAULT_TIMEOUT_MS = 30000;
// For scroll mode, we trust puppeteer found real images, so use a very low threshold
const SCROLL_MODE_MIN_BYTES = 1024; // 1KB - just filter out tiny tracking pixels

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pageUrl = typeof body?.url === 'string' ? body.url.trim() : '';
    const includeUiChrome = Boolean(body?.includeUiChrome);
    const includeSmallAssets = Boolean(body?.includeSmallAssets);
    let cookieHeader: string | null = null;
    try {
      cookieHeader = normalizeCookieHeader(body?.cookieHeader);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid cookie header' }, { status: 400 });
    }
    const minBytes = Number.isFinite(body?.minBytes)
      ? Number(body.minBytes)
      : (includeSmallAssets ? 1024 : SCROLL_MODE_MIN_BYTES);
    const maxImages = Number.isFinite(body?.maxImages) ? Math.max(0, Number(body.maxImages)) : undefined;
    const maxScrolls = Number.isFinite(body?.maxScrolls) 
      ? Math.max(1, Math.min(50, Number(body.maxScrolls))) 
      : Number(process.env.IMPORT_SCROLL_MAX_SCROLLS) || DEFAULT_MAX_SCROLLS;
    const scrollDelayMs = Number.isFinite(body?.scrollDelayMs)
      ? Math.max(500, Math.min(5000, Number(body.scrollDelayMs)))
      : DEFAULT_SCROLL_DELAY_MS;

    if (!pageUrl || !isValidUrl(pageUrl)) {
      return NextResponse.json({ error: 'A valid page URL is required' }, { status: 400 });
    }

    const parsed = new URL(pageUrl);
    if (isPrivateHost(parsed.hostname)) {
      return NextResponse.json({ error: 'Private or localhost URLs are not allowed' }, { status: 400 });
    }

    console.log(`[import/page/scroll] Starting headless scroll for: ${pageUrl}`);
    console.log(`[import/page/scroll] maxScrolls=${maxScrolls}, scrollDelayMs=${scrollDelayMs}`);

    const { images, videos, scrollCount, protectionMode, archiveDiagnostics, error } = await extractMediaFromPage(pageUrl, {
      maxScrolls,
      scrollDelayMs,
      timeoutMs: Number(process.env.IMPORT_SCROLL_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
      viewport: { width: 1280, height: 900 },
      cookieHeader,
    });

    if (error) {
      return NextResponse.json(
        { error, details: archiveDiagnostics ? { archiveDiagnostics } : undefined },
        { status: archiveDiagnostics?.challengeDetected ? 403 : 500 }
      );
    }

    console.log(`[import/page/scroll] Found ${images.length} images and ${videos.length} videos after ${scrollCount} scrolls`);

    const filteredImages = images.filter(img => {
      if (protectionMode) {
        return /\/contents\/gfx\/imagecache\//i.test(img.url);
      }
      return shouldIncludeImageWithOptions(img, { includeUiChrome, includeSmallAssets });
    });

    if (protectionMode && filteredImages.length === 0) {
      return NextResponse.json(
        {
          error:
            'This page appears to block automated product scraping (McMaster protection response). Open the page in your browser and import direct image URLs, or use an authenticated scraping workflow.',
          details: { protectionMode: true },
        },
        { status: 403 }
      );
    }
    
    const limitedImages = typeof maxImages === 'number' && maxImages > 0
      ? filteredImages.slice(0, maxImages)
      : filteredImages;
    const limitedVideos = typeof maxImages === 'number' && maxImages > 0
      ? videos.slice(0, maxImages)
      : videos;

    console.log(`[import/page/scroll] Returning ${limitedImages.length} images and ${limitedVideos.length} videos`);

    const normalizedImages = limitedImages.map(serializeMediaCandidate);
    const normalizedVideos = limitedVideos.map(serializeMediaCandidate);

    return NextResponse.json({
      sourceUrl: pageUrl,
      minBytes,
      maxImages: typeof maxImages === 'number' ? maxImages : null,
      includeUiChrome,
      includeSmallAssets,
      scrollCount,
      mode: 'scroll',
      archiveDiagnostics,
      images: normalizedImages,
      videos: normalizedVideos,
      media: [...normalizedImages, ...normalizedVideos],
    });
  } catch (error) {
    console.error('Scroll import error:', error);
    return NextResponse.json({ error: 'Failed to scan page with scrolling' }, { status: 500 });
  }
}
