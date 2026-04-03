const lastProjectUrlStorageKey = 'pcs:last-project-url';

export const rememberLastProjectUrl = (projectUrl: string): void => {
  try {
    window.localStorage.setItem(lastProjectUrlStorageKey, projectUrl);
  } catch {
    // Ignore storage errors in constrained browser contexts.
  }
};

export const readLastProjectUrl = (): string | null => {
  try {
    return window.localStorage.getItem(lastProjectUrlStorageKey);
  } catch {
    return null;
  }
};

