import { app, nativeImage, type NativeImage } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { createScopedLogger } from "./electron-logger";

const log = createScopedLogger("FileThumbnails");

/**
 * A file on this computer drawn small, the way the Finder draws it: the
 * system's own thumbnail (Quick Look on a Mac, the shell on Windows), which
 * reads a picture, a PDF's first page, a page's file as a page and a text
 * file as its text, each in its own shape and off the app's own processes.
 *
 * Kept on disk by the file's path, its mtime and the size asked for, so a
 * folder of pictures costs the system's work once and a read from disk on
 * every launch after it; a file written since is a new name and drawn again.
 * A file the system has no picture of is remembered as such the same way, so
 * a folder of them is not asked about on every visit.
 *
 * Where the system draws nothing (Linux, or a picture it would not read), a
 * PNG or JPEG is scaled down here instead, which still spares the renderer
 * decoding a camera's full-size photo for a tile an inch across.
 */

/** The sizes asked for, in px along the longer side: a row's and a tile's. */
export const THUMBNAIL_SIZES = [64, 512] as const;
export type ThumbnailSize = (typeof THUMBNAIL_SIZES)[number];

/**
 * Kinds the system draws as a square of text or of page, whatever the
 * document is: trimmed to a page's shape from the left, where the text
 * starts, so they sit in a grid as the pages they are.
 */
const PAGE_SHAPED = /\.(?:csv|htm|html|json|markdown|md|rtf|txt)$/i;
/** A page's width over its height, as the renderer draws a page. */
const PAGE_ASPECT = 0.78;
/** Part of the key, so pictures drawn before a change to how they are drawn are drawn again. */
const DRAWING = "2";

/** How many are kept on disk; past it the least recently written go. */
const KEPT = 4000;
/** How many are drawn at once: the system's generator runs out of process. */
const CONCURRENCY = 4;

export interface Deps {
  dir: string;
}

/** Where thumbnails are kept: beside the app's other caches of the person's files. */
export function fileThumbnailDeps(): Deps {
  return { dir: path.join(app.getPath("userData"), "file-thumbnails") };
}

const inFlight = new Map<string, Promise<Buffer | null>>();
let running = 0;
const waiting: (() => void)[] = [];
let written = 0;

/** The file's thumbnail as a PNG, or null where there is no picture of it. */
export async function fileThumbnail(
  hostPath: string,
  size: ThumbnailSize,
  deps: Deps,
): Promise<Buffer | null> {
  const stats = await fs.stat(hostPath);
  if (!stats.isFile()) {
    return null;
  }
  const key = createHash("sha256")
    .update(`${hostPath}\0${stats.mtimeMs}\0${size}\0${DRAWING}`)
    .digest("hex");
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }
  const request = (async () => {
    const stored = path.join(deps.dir, `${key}.png`);
    const none = path.join(deps.dir, `${key}.none`);
    const kept = await fs.readFile(stored).catch(() => null);
    if (kept) {
      return kept;
    }
    if (
      await fs.stat(none).then(
        () => true,
        () => false,
      )
    ) {
      return null;
    }
    const image = pageShaped(
      hostPath,
      await withTurn(() => draw(hostPath, size)),
    );
    await fs.mkdir(deps.dir, { recursive: true });
    if (!image || image.isEmpty()) {
      await fs.writeFile(none, "");
      return null;
    }
    const png = image.toPNG();
    await fs.writeFile(stored, png);
    written += 1;
    if (written % 200 === 1) {
      void prune(deps.dir);
    }
    return png;
  })().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

async function draw(
  hostPath: string,
  size: ThumbnailSize,
): Promise<NativeImage | null> {
  if (process.platform === "darwin" || process.platform === "win32") {
    try {
      return await nativeImage.createThumbnailFromPath(hostPath, {
        height: size,
        width: size,
      });
    } catch {
      // No system picture of it; a PNG or JPEG can still be scaled here.
    }
  }
  if (!/\.(?:jpe?g|png)$/i.test(hostPath)) {
    return null;
  }
  const image = nativeImage.createFromPath(hostPath);
  if (image.isEmpty()) {
    return null;
  }
  const { height, width } = image.getSize();
  const scale = Math.min(1, size / Math.max(width, height));
  return image.resize({
    height: Math.max(1, Math.round(height * scale)),
    quality: "good",
    width: Math.max(1, Math.round(width * scale)),
  });
}

function pageShaped(hostPath: string, image: NativeImage | null) {
  if (!image || image.isEmpty() || !PAGE_SHAPED.test(hostPath)) {
    return image;
  }
  const { height, width } = image.getSize();
  const pageWidth = Math.round(height * PAGE_ASPECT);
  if (pageWidth >= width) {
    return image;
  }
  return image.crop({ height, width: pageWidth, x: 0, y: 0 });
}

/** Lets the oldest go once more than {@link KEPT} are on disk. */
async function prune(dir: string) {
  try {
    const names = await fs.readdir(dir);
    if (names.length <= KEPT) {
      return;
    }
    const aged = await Promise.all(
      names.map(async (name) => {
        const stats = await fs.stat(path.join(dir, name)).catch(() => null);
        return { at: stats?.mtimeMs ?? 0, name };
      }),
    );
    aged.sort((left, right) => left.at - right.at);
    await Promise.all(
      aged
        .slice(0, aged.length - KEPT)
        .map(({ name }) => fs.rm(path.join(dir, name), { force: true })),
    );
  } catch (error) {
    log.warn(`Could not prune ${dir}: ${String(error)}`);
  }
}

async function withTurn<T>(work: () => Promise<T>): Promise<T> {
  if (running >= CONCURRENCY) {
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  }
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}
