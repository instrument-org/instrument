import path from "node:path";

import { readBytes } from "../workspace-files";
import { type AppSlug } from "./manifest";
import { readAppIcon, writeAppIcon } from "./store";

/**
 * An app's own icon, drawn in place of its Mac app's icon and its site's,
 * kept in the apps store beside the app. The agent authors it (a mark drawn
 * for a service whose site has none worth showing, a local server with no
 * Mac app, or one the user asked for) and `instrument app icon` sets it after
 * checking it draws well. SVG first, since it is sharp at every size; an
 * earlier build's app folder kept it as one of these files.
 */
export const APP_ICON_FILE_NAMES = ["icon.svg", "icon.png"] as const;

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

/**
 * An icon file an earlier build kept in an app's folder, when it has one: what
 * the launch takes into the store with the app.
 */
export async function readIconInFolder(
  appDir: string,
): Promise<undefined | { bytes: Buffer; fileName: IconFileName }> {
  for (const fileName of APP_ICON_FILE_NAMES) {
    try {
      return {
        bytes: await readBytes(path.join(appDir, fileName), {
          ownFolder: path.dirname(appDir),
        }),
        fileName,
      };
    } catch {
      // Not this one.
    }
  }
  return undefined;
}

/** The app's own icon, when it has one. */
export async function findAppIcon(
  slug: AppSlug,
): Promise<undefined | { bytes: Buffer; fileName: IconFileName }> {
  const icon = await readAppIcon(slug);
  return icon
    ? { bytes: Buffer.from(icon.data, "base64"), fileName: icon.fileName }
    : undefined;
}

/** Draws the app with the icon, replacing whichever one it had. */
export async function setAppIcon(
  slug: AppSlug,
  bytes: Uint8Array,
  fileName: IconFileName,
) {
  await writeAppIcon(slug, {
    data: Buffer.from(bytes).toString("base64"),
    fileName,
  });
}
