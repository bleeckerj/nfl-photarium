export type ScrollStreamPage = {
  evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
  waitForNetworkIdle: (options: { timeout: number }) => Promise<void>;
};

export type ScrollStreamMediaElement = {
  mediaKind: 'image' | 'video';
  src: string;
  srcset: string;
  dataSrcset: string;
  dataSrc: string;
  naturalWidth: number;
  naturalHeight: number;
  poster: string;
  inMainContent: boolean;
  inUiChrome: boolean;
};

export type ScrollStreamStep = {
  target: 'container' | 'window';
  moved: boolean;
  atEnd: boolean;
};

export const triggerScrollLazyLoad = async (page: ScrollStreamPage): Promise<void> => {
  await page.evaluate(async () => {
    const pickScrollTarget = (): { kind: 'window' | 'element'; element: HTMLElement | null } => {
      const root = (document.scrollingElement as HTMLElement | null) || document.documentElement;
      const windowDelta = Math.max(0, root.scrollHeight - window.innerHeight);

      let bestElement: HTMLElement | null = null;
      let bestDelta = 0;
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('main, [role="main"], section, article, div'));
      for (const el of candidates) {
        if (!el || el === root || el === document.body) continue;
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') continue;
        const delta = el.scrollHeight - el.clientHeight;
        if (delta < 300 || el.clientHeight < 220) continue;
        if (delta > bestDelta) {
          bestDelta = delta;
          bestElement = el;
        }
      }

      if (bestElement && bestDelta > windowDelta + 200) {
        return { kind: 'element', element: bestElement };
      }
      return { kind: 'window', element: null };
    };

    const target = pickScrollTarget();
    if (target.kind === 'element' && target.element) {
      const el = target.element;
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      const step = Math.max(120, el.clientHeight * 0.8);
      for (let y = 0; y <= maxTop; y += step) {
        el.scrollTop = Math.min(maxTop, y);
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise(r => setTimeout(r, 120));
      }
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise(r => setTimeout(r, 220));
      return;
    }

    const scrollHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const viewHeight = window.innerHeight;
    const step = Math.max(120, viewHeight * 0.8);
    for (let y = 0; y < scrollHeight; y += step) {
      window.scrollTo(0, y);
      window.dispatchEvent(new Event('scroll'));
      await new Promise(r => setTimeout(r, 100));
    }

    window.scrollTo(0, 0);
    window.dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 200));
  });

  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    await page.waitForNetworkIdle({ timeout: 3000 });
  } catch {
    // Continue anyway.
  }
};

export const extractScrollStreamMediaElements = async (
  page: ScrollStreamPage
): Promise<ScrollStreamMediaElement[]> => {
  return page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    const sources = Array.from(document.querySelectorAll('source'));
    const videos = Array.from(document.querySelectorAll('video'));

    const results: Array<{
      mediaKind: 'image' | 'video';
      src: string;
      srcset: string;
      dataSrcset: string;
      dataSrc: string;
      naturalWidth: number;
      naturalHeight: number;
      poster: string;
      inMainContent: boolean;
      inUiChrome: boolean;
    }> = [];
    const classifyContext = (element: Element | null): { inMainContent: boolean; inUiChrome: boolean } => {
      let inMainContent = false;
      let inUiChrome = false;
      let current: Element | null = element;
      while (current) {
        const tagName = current.tagName.toLowerCase();
        const role = (current.getAttribute('role') || '').toLowerCase();
        const id = (current.getAttribute('id') || '').toLowerCase();
        const className = (current.getAttribute('class') || '').toLowerCase();
        const ariaLabel = (current.getAttribute('aria-label') || '').toLowerCase();
        const signal = `${id} ${className} ${ariaLabel}`;
        if (
          tagName === 'main' ||
          tagName === 'article' ||
          role === 'main' ||
          signal.includes('product') ||
          signal.includes('content')
        ) {
          inMainContent = true;
        }
        if (
          tagName === 'header' ||
          tagName === 'nav' ||
          tagName === 'footer' ||
          role === 'navigation' ||
          signal.includes('menu') ||
          signal.includes('nav') ||
          signal.includes('header') ||
          signal.includes('footer') ||
          signal.includes('masthead') ||
          signal.includes('browsecatalog')
        ) {
          inUiChrome = true;
        }
        current = current.parentElement;
      }
      return { inMainContent, inUiChrome };
    };
    const pushBackgroundUrls = (value: string | null | undefined, sourceElement?: Element | null) => {
      if (!value || value === 'none') return;
      const urlRegex = /url\((['"]?)(.*?)\1\)/g;
      let match: RegExpExecArray | null;
      while ((match = urlRegex.exec(value)) !== null) {
        const candidate = (match[2] || '').trim();
        if (!candidate || candidate.startsWith('data:')) continue;
        const context = classifyContext(sourceElement || null);
        results.push({
          mediaKind: 'image',
          src: candidate,
          srcset: '',
          dataSrcset: '',
          dataSrc: '',
          naturalWidth: 0,
          naturalHeight: 0,
          poster: '',
          inMainContent: context.inMainContent,
          inUiChrome: context.inUiChrome,
        });
      }
    };

    for (const img of imgs) {
      const context = classifyContext(img);
      results.push({
        mediaKind: 'image',
        src: img.currentSrc || img.src || '',
        srcset: img.srcset || '',
        dataSrcset: img.dataset.srcset || img.getAttribute('data-srcset') || '',
        dataSrc: img.dataset.src || img.dataset.lazySrc || img.dataset.original || img.getAttribute('data-lazy') || '',
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        poster: '',
        inMainContent: context.inMainContent,
        inUiChrome: context.inUiChrome,
      });
    }

    for (const source of sources) {
      const context = classifyContext(source);
      results.push({
        mediaKind: 'image',
        src: '',
        srcset: source.srcset || '',
        dataSrcset: source.dataset?.srcset || source.getAttribute('data-srcset') || '',
        dataSrc: source.dataset?.src || '',
        naturalWidth: 0,
        naturalHeight: 0,
        poster: '',
        inMainContent: context.inMainContent,
        inUiChrome: context.inUiChrome,
      });
    }

    for (const video of videos) {
      const source = video.querySelector('source');
      const src = video.currentSrc || video.src || source?.src || '';
      const filenameHint = video.getAttribute('aria-label') || video.getAttribute('title') || src;
      const context = classifyContext(video);
      results.push({
        mediaKind: 'video',
        src,
        srcset: '',
        dataSrcset: '',
        dataSrc: filenameHint,
        naturalWidth: video.videoWidth || 0,
        naturalHeight: video.videoHeight || 0,
        poster: video.poster || '',
        inMainContent: context.inMainContent,
        inUiChrome: context.inUiChrome,
      });
    }

    for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]'))) {
      if (!link.href) continue;
      const context = classifyContext(link);
      results.push({
        mediaKind: 'image',
        src: link.href,
        srcset: '',
        dataSrcset: '',
        dataSrc: '',
        naturalWidth: 0,
        naturalHeight: 0,
        poster: '',
        inMainContent: context.inMainContent,
        inUiChrome: context.inUiChrome,
      });
    }

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const inlineStyle = element.getAttribute('style');
      if (inlineStyle && inlineStyle.includes('background')) {
        pushBackgroundUrls(inlineStyle, element);
      }
      const computedBackground = window.getComputedStyle(element).backgroundImage;
      pushBackgroundUrls(computedBackground, element);
    }

    return results;
  });
};

export const findScrollStreamNextPageUrl = async (
  page: ScrollStreamPage
): Promise<string | null> => {
  return page.evaluate(() => {
    const nextLink = document.querySelector('link[rel="next"]') as HTMLLinkElement;
    if (nextLink?.href) return nextLink.href;

    const paginationLinks = Array.from(document.querySelectorAll('a[href*="page="], a.next, a[rel="next"], .pagination a'));
    for (const link of paginationLinks) {
      const el = link as HTMLAnchorElement;
      const text = el.textContent?.toLowerCase() || '';
      if (text.includes('next') || text.includes('→') || text.includes('›') || el.rel === 'next') {
        return el.href;
      }
    }

    const currentPageMatch = window.location.search.match(/page=(\d+)/);
    const currentPage = currentPageMatch ? parseInt(currentPageMatch[1], 10) : 1;
    const nextPageLinks = Array.from(document.querySelectorAll(`a[href*="page=${currentPage + 1}"]`)) as HTMLAnchorElement[];
    if (nextPageLinks.length > 0) {
      return nextPageLinks[0].href;
    }

    return null;
  });
};

export const scrollStreamPageStep = async (
  page: ScrollStreamPage
): Promise<ScrollStreamStep> => {
  return page.evaluate(() => {
    const root = (document.scrollingElement as HTMLElement | null) || document.documentElement;
    const windowDelta = Math.max(0, root.scrollHeight - window.innerHeight);

    let bestElement: HTMLElement | null = null;
    let bestDelta = 0;
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('main, [role="main"], section, article, div'));
    for (const el of candidates) {
      if (!el || el === root || el === document.body) continue;
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') continue;
      const delta = el.scrollHeight - el.clientHeight;
      if (delta < 300 || el.clientHeight < 220) continue;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestElement = el;
      }
    }

    if (bestElement && bestDelta > windowDelta + 200) {
      const step = Math.max(120, bestElement.clientHeight * 0.85);
      const before = bestElement.scrollTop;
      const maxTop = Math.max(0, bestElement.scrollHeight - bestElement.clientHeight);
      bestElement.scrollTop = Math.min(maxTop, before + step);
      bestElement.dispatchEvent(new Event('scroll', { bubbles: true }));
      const after = bestElement.scrollTop;
      return { target: 'container', moved: after > before + 1, atEnd: maxTop - after < 2 };
    }

    const before = window.scrollY;
    window.scrollBy(0, Math.max(120, window.innerHeight * 0.9));
    window.dispatchEvent(new Event('scroll'));
    const rootAfter = (document.scrollingElement as HTMLElement | null) || document.documentElement;
    const maxY = Math.max(0, rootAfter.scrollHeight - window.innerHeight);
    const after = window.scrollY;
    return { target: 'window', moved: after > before + 1, atEnd: maxY - after < 2 };
  });
};
