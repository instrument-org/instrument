import { app, nativeImage, type NativeImage } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { createScopedLogger } from "./electron-logger";
import { renderedKindOf } from "./rendered-kinds";
import { renderPicture } from "./rendered-pictures";

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
 * Pages, Markdown and code are the exception: the app draws those itself
 * (`rendered-pictures.ts`), since the system runs no page's scripts and has
 * no picture of Markdown or code off a Mac. One drawing at the largest size
 * is kept, and the smaller sizes are scaled from it.
 *
 * Where the system draws nothing (Linux, or a picture it would not read), a
 * PNG or JPEG is scaled down here instead, which still spares the renderer
 * decoding a camera's full-size photo for a tile an inch across.
 */

/** The sizes asked for, in px along the longer side: a row's, a tile's and a preview pane's. */
export const THUMBNAIL_SIZES = [64, 512, 1024] as const;
export type ThumbnailSize = (typeof THUMBNAIL_SIZES)[number];

/**
 * Kinds that are pages, drawn in a page's shape so they sit in a grid as the
 * pages they are. A page's file is laid out by the system at the shape it is
 * asked for; text always comes back square, a white sheet with the text at
 * its top, and is carried on down in white to a page's length rather than
 * cut, which would lose the ends of its lines.
 */
const PAGE_SHAPED = /\.(?:csv|htm|html|json|markdown|md|rtf|txt)$/i;
/** A page's width over its height, as the renderer draws a page. */
const PAGE_ASPECT = 0.78;
/** Part of the key, so pictures drawn before a change to how they are drawn are drawn again. */
const DRAWING = "5";

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
    const rendered =
      renderedKindOf(hostPath) === undefined
        ? null
        : await renderedAt(hostPath, stats.mtimeMs, size, deps);
    const image =
      rendered ??
      pageShaped(
        hostPath,
        await withTurn(() =>
          draw(
            hostPath,
            PAGE_SHAPED.test(hostPath)
              ? { height: size, width: Math.round(size * PAGE_ASPECT) }
              : { height: size, width: size },
          ),
        ),
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

const renderedInFlight = new Map<string, Promise<NativeImage | null>>();

async function draw(
  hostPath: string,
  box: { height: number; width: number },
): Promise<NativeImage | null> {
  const size = Math.max(box.height, box.width);
  if (process.platform === "darwin" || process.platform === "win32") {
    try {
      return await nativeImage.createThumbnailFromPath(hostPath, box);
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

/**
 * A page's picture that came back in some other shape, brought to a page's.
 * The size an image reports is the box it was asked for, not what the system
 * drew in it, so the picture is read back from its own pixels first. Text is
 * carried on down in white; a page's file drawn wider than a page (one with
 * too little in it to fill one) is cut to a page from the left.
 */
function pageShaped(hostPath: string, image: NativeImage | null) {
  if (!image || image.isEmpty() || !PAGE_SHAPED.test(hostPath)) {
    return image;
  }
  const drawn = nativeImage.createFromBuffer(image.toPNG());
  const { height, width } = drawn.getSize();
  const pageHeight = Math.round(width / PAGE_ASPECT);
  if (height >= pageHeight - 1) {
    return drawn;
  }
  if (/\.html?$/i.test(hostPath)) {
    return drawn.crop({
      height,
      width: Math.round(height * PAGE_ASPECT),
      x: 0,
      y: 0,
    });
  }
  // BGRA rows, so white is every byte full; the picture is laid over the top.
  const page = Buffer.alloc(width * pageHeight * 4, 0xff);
  drawn.toBitmap().copy(page);
  return nativeImage.createFromBitmap(page, { height: pageHeight, width });
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

/**
 * The file as the app draws it, scaled to `size` tall from the one drawing
 * kept at the largest size; null when it could not be drawn, which leaves it
 * to the system. A page photographed before it finished loading is shown but
 * not kept, so the next ask draws it again.
 */
async function renderedAt(
  hostPath: string,
  modifiedAt: number,
  size: ThumbnailSize,
  deps: Deps,
): Promise<NativeImage | null> {
  const key = createHash("sha256")
    .update(`${hostPath}\0${modifiedAt}\0rendered\0${DRAWING}`)
    .digest("hex");
  let pending = renderedInFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const stored = path.join(deps.dir, `${key}.png`);
      const kept = await fs.readFile(stored).catch(() => null);
      if (kept) {
        return nativeImage.createFromBuffer(kept);
      }
      try {
        const { complete, image } = await renderPicture(hostPath);
        if (complete) {
          await fs.mkdir(deps.dir, { recursive: true });
          await fs.writeFile(stored, image.toPNG());
        }
        return image;
      } catch {
        return null;
      }
    })().finally(() => {
      renderedInFlight.delete(key);
    });
    renderedInFlight.set(key, pending);
  }
  const full = await pending;
  if (!full || full.isEmpty()) {
    return null;
  }
  const { height, width } = full.getSize();
  if (height <= size) {
    return full;
  }
  return full.resize({
    height: size,
    quality: "good",
    width: Math.max(1, Math.round((width * size) / height)),
  });
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
