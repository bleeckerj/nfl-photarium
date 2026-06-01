// Puppeteer is optional in this project; route code asks this loader so tests can
// inject a fake browser without forcing the dependency into every environment.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let puppeteer: any = null;

const getPuppeteerTestOverride = () =>
  (globalThis as typeof globalThis & { __PHOTARIUM_TEST_PUPPETEER__?: unknown })
    .__PHOTARIUM_TEST_PUPPETEER__;

export const loadPuppeteer = async () => {
  const override = getPuppeteerTestOverride();
  if (override) return override;
  if (puppeteer) return puppeteer;
  try {
    puppeteer = await (Function('return import("puppeteer")')());
    return puppeteer;
  } catch {
    return null;
  }
};
