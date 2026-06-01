import {
  inspectArchiveText,
  isArchiveHost,
} from '@/server/archiveDiagnostics';

export const getArchivePageDiagnostics = async (
  pageUrl: string,
  page: {
    title: () => Promise<string>;
    evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
    url: () => string;
  },
  status?: number
) => {
  if (!isArchiveHost(pageUrl) && !isArchiveHost(page.url())) {
    return null;
  }

  const [title, text] = await Promise.all([
    page.title().catch(() => ''),
    page.evaluate(() => document.body?.innerText?.slice(0, 4000) || '').catch(() => ''),
  ]);

  return inspectArchiveText({
    sourceUrl: pageUrl,
    finalUrl: page.url(),
    status,
    contentType: 'text/html',
    title,
    text,
  });
};
