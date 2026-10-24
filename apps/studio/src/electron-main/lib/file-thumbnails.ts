import { app, nativeImage, type NativeImage } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { createScopedLogger } from "./electron-logger";
import { fileIcon } from "./mac-native";
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
 * a folder of them is not asked about on every visit. What is on disk is held
 * inside a count, a size and an age ({@link pruneThumbnails}), so the store
 * does not come to hold a picture of every version of every file the person
 * has ever looked at.
 *
 * Pages, Markdown, code and SVGs are the exception: the app draws those
 * itself (`rendered-pictures.ts`), since the system runs no page's scripts,
 * has no picture of Markdown or code off a Mac, and draws an SVG sized in
 * points cut short. One drawing at the largest size
 * is kept, and the smaller sizes are scaled from it.
 *
 * Where the system draws nothing (Linux, or a picture it would not read), a
 * PNG or JPEG is scaled down here instead, which still spares the renderer
 * decoding a camera's full-size photo for a tile an inch across.
 *
 * A folder on a Mac is drawn as the Finder's icon for it, which is how an app
 * or another package the browser lists as one item shows as itself.
 */

/** The sizes asked for, in px along the longer side: a row's, a tile's and a preview pane's. */
export const THUMBNAIL_SIZES = [64, 512, 1024] as const;
export type ThumbnailSize = (typeof THUMBNAIL_SIZES)[number];
/** The app's theme, which a page, Markdown or code file is drawn in; the system's pictures have none. */
export type ThumbnailTheme = "dark" | "light";

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
const DRAWING = "10";

/** How many are kept on disk; past it the least recently drawn go. */
const KEPT = 4000;
/** How much disk they are kept on; past it the least recently drawn go. */
const KEPT_BYTES = 256 * 1024 * 1024;
/** How long one is kept since it was drawn. */
const KEPT_MS = 60 * 24 * 60 * 60 * 1000;
/** How many are drawn at once: the system's generator runs out of process. */
const CONCURRENCY = 4;
/** Sharp enough that a page's small type reads as it does in a PNG. */
const JPEG_QUALITY = 90;

export interface Deps {
  dir: string;
}

/** A picture encoded, and the format it is in, which is also its file's extension. */
interface Encoded {
  bytes: Buffer;
  format: "jpg" | "png";
}

/**
 * A thumbnail encoded. An incomplete one is a page photographed before it
 * finished loading: shown, but kept nowhere, so the next ask draws it again.
 */
export interface Thumbnail extends Encoded {
  complete: boolean;
}

/** Where thumbnails are kept: beside the app's other caches of the person's files. */
export function fileThumbnailDeps(): Deps {
  return { dir: path.join(app.getPath("userData"), "file-thumbnails") };
}

const inFlight = new Map<string, Promise<null | Thumbnail>>();
let running = 0;
const waiting: (() => void)[] = [];
let written = 0;

/** The file's thumbnail, or null where there is no picture of it. */
export async function fileThumbnail(
  hostPath: string,
  size: ThumbnailSize,
  deps: Deps,
  theme: ThumbnailTheme = "light",
): Promise<null | Thumbnail> {
  const stats = await fs.stat(hostPath);
  const isFolder = stats.isDirectory();
  if (!stats.isFile() && !isFolder) {
    return null;
  }
  const isRendered = !isFolder && renderedKindOf(hostPath) !== undefined;
  const key = createHash("sha256")
    .update(
      `${hostPath}\0${stats.mtimeMs}\0${size}\0${DRAWING}${isRendered ? `\0${theme}` : ""}`,
    )
    .digest("hex");
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }
  const request = (async () => {
    const none = path.join(deps.dir, `${key}.none`);
    const kept = await readKept(deps.dir, key);
    if (kept) {
      return { complete: true, ...kept };
    }
    if (
      await fs.stat(none).then(
        () => true,
        () => false,
      )
    ) {
      return null;
    }
    const rendered = isRendered
      ? await renderedAt(hostPath, stats.mtimeMs, size, theme, deps)
      : null;
    const complete = rendered?.complete ?? true;
    const image = isFolder
      ? await withTurn(() => iconOf(hostPath, size))
      : (rendered?.image ??
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
        ));
    await fs.mkdir(deps.dir, { recursive: true });
    if (!image || image.isEmpty()) {
      // A file macOS refuses the app has a picture once the person lets the
      // app in, which the marker would hide until the file next changed.
      if (!isFolder && (await isRefusedByMacos(hostPath))) {
        return null;
      }
      await fs.writeFile(none, "");
      return null;
    }
    const encoded = encode(image);
    if (!complete) {
      return { complete, ...encoded };
    }
    await fs.writeFile(
      path.join(deps.dir, `${key}.${encoded.format}`),
      encoded.bytes,
    );
    written += 1;
    if (written % 200 === 1) {
      void pruneThumbnails(deps.dir);
    }
    return { complete, ...encoded };
  })().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

/**
 * The picture as a JPEG where every pixel is opaque, and as a PNG where any
 * of it shows through. Both encode on the main thread, and a JPEG takes a
 * tenth to a fiftieth of a PNG's time there and comes out far smaller, which
 * is most of what a folder of thumbnails costs the app's own thread.
 */
function encode(image: NativeImage): Encoded {
  const bitmap = image.toBitmap();
  // Four bytes a pixel, alpha last whichever order the other three are in.
  for (let at = 3; at < bitmap.length; at += 4) {
    if (bitmap[at] !== 0xff) {
      return { bytes: image.toPNG(), format: "png" };
    }
  }
  return { bytes: image.toJPEG(JPEG_QUALITY), format: "jpg" };
}

/** The picture kept on disk under `key`, in whichever format it was kept in. */
async function readKept(dir: string, key: string): Promise<Encoded | null> {
  for (const format of ["jpg", "png"] as const) {
    const bytes = await fs
      .readFile(path.join(dir, `${key}.${format}`))
      .catch(() => null);
    if (bytes) {
      return { bytes, format };
    }
  }
  return null;
}

/** Whether macOS's privacy controls keep the app from opening the file. */
async function isRefusedByMacos(hostPath: string): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }
  return fs.open(hostPath, "r").then(
    async (handle) => {
      await handle.close();
      return false;
    },
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "EPERM",
  );
}

const renderedInFlight = new Map<
  string,
  Promise<null | { complete: boolean; image: NativeImage }>
>();

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

/** The Finder's icon for a folder, `size` px square; nothing off a Mac. */
async function iconOf(
  hostPath: string,
  size: number,
): Promise<NativeImage | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  const png = await fileIcon(hostPath, size).catch(() => null);
  return png ? nativeImage.createFromBuffer(png) : null;
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

/** What a thumbnail has to be inside to be kept. */
export interface Keep {
  bytes: number;
  count: number;
  ms: number;
}

const KEEP: Keep = { bytes: KEPT_BYTES, count: KEPT, ms: KEPT_MS };

/**
 * Lets go of the ones drawn longest ago: any drawn more than `ms` ago, and
 * then the oldest left while there are more than `count` of them or they
 * come to more than `bytes` on disk.
 *
 * A count on its own is the wrong measure for a store whose entries run from
 * an empty marker to a megabyte of drawn page, so a thousand photographs
 * costs what a thousand markers does. And a file written since is a new name
 * rather than a new picture, so without an age the pictures of every version
 * of a file anyone has ever looked at stay until the count lets them go. One
 * is a few hundred milliseconds of the system's work to draw again, which is
 * worth less than two months of disk.
 */
export async function pruneThumbnails(dir: string, keep: Keep = KEEP) {
  try {
    const now = Date.now();
    const aged = await Promise.all(
      (await fs.readdir(dir)).map(async (name) => {
        const stats = await fs.stat(path.join(dir, name)).catch(() => null);
        return { at: stats?.mtimeMs ?? 0, bytes: stats?.size ?? 0, name };
      }),
    );
    aged.sort((left, right) => left.at - right.at);
    let count = aged.length;
    let bytes = aged.reduce((total, each) => total + each.bytes, 0);
    const gone: string[] = [];
    for (const each of aged) {
      if (
        now - each.at <= keep.ms &&
        count <= keep.count &&
        bytes <= keep.bytes
      ) {
        break;
      }
      gone.push(each.name);
      count -= 1;
      bytes -= each.bytes;
    }
    await Promise.all(
      gone.map((name) => fs.rm(path.join(dir, name), { force: true })),
    );
  } catch (error) {
    // A folder nothing has drawn into yet has nothing to prune.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn(`Could not prune ${dir}: ${String(error)}`);
    }
  }
}

/**
 * The file as the app draws it, scaled to `size` along its longer side from
 * the one drawing kept at the largest size; null when it could not be drawn,
 * which leaves it to the system. A page photographed before it finished
 * loading comes back marked incomplete and is not kept, so the next ask draws
 * it again.
 */
async function renderedAt(
  hostPath: string,
  modifiedAt: number,
  size: ThumbnailSize,
  theme: ThumbnailTheme,
  deps: Deps,
): Promise<null | { complete: boolean; image: NativeImage }> {
  const key = createHash("sha256")
    .update(`${hostPath}\0${modifiedAt}\0rendered\0${theme}\0${DRAWING}`)
    .digest("hex");
  let pending = renderedInFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const kept = await readKept(deps.dir, key);
      if (kept) {
        return {
          complete: true,
          image: nativeImage.createFromBuffer(kept.bytes),
        };
      }
      try {
        const { complete, image } = await renderPicture(hostPath, theme);
        if (complete) {
          const encoded = encode(image);
          await fs.mkdir(deps.dir, { recursive: true });
          await fs.writeFile(
            path.join(deps.dir, `${key}.${encoded.format}`),
            encoded.bytes,
          );
        }
        return { complete, image };
      } catch {
        return null;
      }
    })().finally(() => {
      renderedInFlight.delete(key);
    });
    renderedInFlight.set(key, pending);
  }
  const drawn = await pending;
  if (!drawn || drawn.image.isEmpty()) {
    return null;
  }
  const { complete, image: full } = drawn;
  const { height, width } = full.getSize();
  const longer = Math.max(height, width);
  if (longer <= size) {
    return drawn;
  }
  return {
    complete,
    image: full.resize({
      height: Math.max(1, Math.round((height * size) / longer)),
      quality: "good",
      width: Math.max(1, Math.round((width * size) / longer)),
    }),
  };
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
