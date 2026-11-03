// A headless Chromium for building, filming and rendering takes, from the
// Playwright Studio's own tests use.

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const { chromium } = createRequire(
  path.join(REPO_ROOT, "apps/studio/package.json"),
)("playwright");

/** Playwright's own Chromium, or the installed Chrome where that is missing. */
export async function launch() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return chromium.launch({ channel: "chrome", headless: true });
  }
}

/**
 * A page at an exact size and pixel density, set over CDP so a raw capture
 * honors it (Playwright's own viewport does not reach `Page.captureScreenshot`).
 */
export async function sizedPage(browser, { height, scale = 1, width }) {
  const page = await browser.newPage({ viewport: { height, width } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: scale,
    height,
    mobile: false,
    width,
  });
  /**
   * A capture straight from the compositor. Playwright's own screenshot waits
   * for the page to finish loading, which a replay's frame never does.
   */
  const capture = async (file, { format = "png", quality } = {}) => {
    const { data } = await cdp.send("Page.captureScreenshot", {
      format,
      ...(quality && { quality }),
    });
    const bytes = Buffer.from(data, "base64");
    if (file) writeFileSync(file, bytes);
    return bytes;
  };
  return { capture, cdp, page };
}
