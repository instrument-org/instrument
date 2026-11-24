import { imageSize } from "image-size";
import fs from "node:fs/promises";

/**
 * The most pixels a screenshot of an element or of the whole page
 * (`screenshot --full`) has on either side, which the app's browser cuts a
 * larger one to, from its top left corner. It is the largest texture
 * Chromium draws, and where Chromium's own DevTools cuts a full-size
 * screenshot. A capture that tall, 1280 CSS pixels wide at two device pixels
 * to each, is 168 MB as a bitmap in the main process.
 */
export const MAX_SCREENSHOT_PIXELS = 16_384;

/**
 * What to tell the agent about a saved screenshot that is as large as one
 * gets on a side, so what it shows may stop short of the element or page it
 * was taken of. Nothing for any other image, or a file that cannot be read.
 */
export async function cutScreenshotNote(
  hostPath: string,
): Promise<string | undefined> {
  let size: { height: number; width: number };
  try {
    size = imageSize(await fs.readFile(hostPath));
  } catch {
    return undefined;
  }
  const sides = [
    ...(size.height >= MAX_SCREENSHOT_PIXELS ? ["tall"] : []),
    ...(size.width >= MAX_SCREENSHOT_PIXELS ? ["wide"] : []),
  ];
  if (sides.length === 0) {
    return undefined;
  }
  return `The screenshot is ${MAX_SCREENSHOT_PIXELS} pixels ${sides.join(" and ")}, the most one has: anything of the page past that is not in it. For the rest, capture an element lower down (\`screenshot <selector>\`), scroll and capture the viewport, or \`pdf\` the page.`;
}
