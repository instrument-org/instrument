import fs from "node:fs/promises";
import path from "node:path";

import { type AbsolutePath } from "../../schemas/paths";

/**
 * An app's own icon: a file in its folder, drawn in place of its Mac app's
 * icon and its site's. The agent authors it (a mark drawn for a service whose
 * site has none worth showing, a local server with no Mac app, or one the
 * user asked for) and `app icon` puts it there after checking it draws well.
 * SVG first, since it is sharp at every size.
 */
const APP_ICON_FILE_NAMES = ["icon.svg", "icon.png"] as const;

/** Drawn up to 64px on a 2x screen, so smaller goes soft. */
const MIN_PNG_SIZE = 128;
const MAX_BYTES = 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

type IconFileName = (typeof APP_ICON_FILE_NAMES)[number];

/**
 * Which file the bytes make, or why they are not an icon. Square, because
 * every surface draws an app in a square; a PNG large enough not to blur.
 */
export function checkAppIcon(
  bytes: Uint8Array,
): { error: string } | { fileName: IconFileName } {
  const buffer = Buffer.from(bytes);
  if (buffer.length > MAX_BYTES) {
    return {
      error: `the icon is ${Math.round(buffer.length / 1024)} KB; keep it under 1 MB.`,
    };
  }
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    // IHDR is always the first chunk: width and height at bytes 16 and 20.
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width !== height) {
      return { error: `the PNG is ${width}x${height}; an icon is square.` };
    }
    if (width < MIN_PNG_SIZE) {
      return {
        error: `the PNG is ${width}px; an icon needs at least ${MIN_PNG_SIZE}px, or draw it as an SVG.`,
      };
    }
    return { fileName: "icon.png" };
  }
  const text = buffer.toString("utf8");
  const svg = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (svg) {
    const viewBox =
      /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(
        svg,
      );
    if (!viewBox) {
      return { error: "the SVG has no viewBox, so it cannot scale." };
    }
    const width = Number(viewBox[1]);
    const height = Number(viewBox[2]);
    if (width !== height) {
      return {
        error: `the SVG's viewBox is ${width}x${height}; an icon is square.`,
      };
    }
    return { fileName: "icon.svg" };
  }
  return { error: "the file is neither a PNG nor an SVG." };
}

/** The app's own icon file, when its folder has one. */
export async function findAppIcon(
  appDir: AbsolutePath,
): Promise<undefined | { bytes: Buffer; fileName: IconFileName }> {
  for (const fileName of APP_ICON_FILE_NAMES) {
    try {
      return {
        bytes: await fs.readFile(path.join(appDir, fileName)),
        fileName,
      };
    } catch {
      // Not this one.
    }
  }
  return undefined;
}

/** Puts the icon in the folder, replacing whichever one was there. */
export async function writeAppIcon(
  appDir: AbsolutePath,
  bytes: Uint8Array,
  fileName: IconFileName,
) {
  await Promise.all(
    APP_ICON_FILE_NAMES.filter((name) => name !== fileName).map((name) =>
      fs.rm(path.join(appDir, name), { force: true }),
    ),
  );
  await fs.writeFile(path.join(appDir, fileName), bytes);
}
