type PageImportNavigationWaitUntil = 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';

export type PageImportNavigationResponse = {
  status?: () => number;
};

export type PageImportBrowserPage = {
  goto: (
    url: string,
    options: { waitUntil: PageImportNavigationWaitUntil; timeout: number }
  ) => Promise<PageImportNavigationResponse | null>;
  url: () => string;
  waitForNetworkIdle: (options: { timeout: number }) => Promise<void>;
};

export type PageImportNavigationResult = {
  response: PageImportNavigationResponse | null;
  timedOut: boolean;
  finalUrl: string;
  warning?: string;
};

const DEFAULT_NETWORK_IDLE_TIMEOUT_MS = 3000;

const isNavigationTimeoutError = (error: unknown) =>
  error instanceof Error && /navigation timeout .* exceeded/i.test(error.message);

const getCurrentPageUrl = (page: Pick<PageImportBrowserPage, 'url'>) => {
  try {
    return page.url();
  } catch {
    return '';
  }
};

const isUsableLoadedUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export const navigatePageForImport = async (
  page: PageImportBrowserPage,
  url: string,
  options: { timeoutMs: number }
): Promise<PageImportNavigationResult> => {
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs,
    });
    return {
      response,
      timedOut: false,
      finalUrl: getCurrentPageUrl(page) || url,
    };
  } catch (error) {
    if (!isNavigationTimeoutError(error)) {
      throw error;
    }

    const finalUrl = getCurrentPageUrl(page);
    if (!isUsableLoadedUrl(finalUrl)) {
      throw error;
    }

    return {
      response: null,
      timedOut: true,
      finalUrl,
      warning:
        'Page load timed out before all browser navigation signals completed; scanning the loaded document anyway.',
    };
  }
};

export const waitForPageImportNetworkIdle = async (
  page: Pick<PageImportBrowserPage, 'waitForNetworkIdle'>,
  timeoutMs = DEFAULT_NETWORK_IDLE_TIMEOUT_MS
) => {
  try {
    await page.waitForNetworkIdle({
      timeout: Math.max(500, Math.min(timeoutMs, DEFAULT_NETWORK_IDLE_TIMEOUT_MS)),
    });
    return true;
  } catch {
    return false;
  }
};
