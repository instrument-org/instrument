import { workspaceBrowserDir } from "@/electron-main/lib/get-workspace-folder";
import { createScopedLogger } from "@/electron-main/lib/electron-logger";
import { captureFrame } from "@/electron-main/browser-view/capture-frame";
import {
  HOVER_PICTURE_NAME_PATTERN,
  hoverPictureUrl,
} from "@/shared/hover-pictures";
import { type Rectangle, type WebContents } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const log = createScopedLogger("HoverPictures");

/** How wide a picture is kept: sharp at 2x on the 320px card it is shown on. */
const WIDTH = 640;
/** How tall one is kept at most: a side in a split is far taller than its card, which shows its top. */
const MAX_HEIGHT = 800;
const QUALITY = 80;

/** How long a picture is waited for. */
const DEADLINE_MS = 2000;

/** A part of the window to keep a picture of: whose it is, and what it has up. */
export interface PictureAsked {
  /** Whose picture: a tab's or a group's. */
  key: string;
  rect: Rectangle;
  /** What was up in it, so it is never shown of anything else. */
  shows: string;
}

/** A picture kept, by when it was taken. Its address comes only where the asker lacks it. */
export interface PictureKept {
  at: number;
  key: string;
  url?: string;
}

/** The file of each key's picture, which says whose it is, what it shows and when it was taken. */
interface Held {
  at: number;
  file: string;
  shows: string;
}

/** What is on disk, read from the folder's names once. */
let index: undefined | { dir: string; held: Promise<Map<string, Held>> };

/** The folder's changes and reads, one after another. */
let work: Promise<unknown> = Promise.resolve();

/** The captures begun, and after which of them each key's pictures were thrown away. */
let captures = 0;
const forgotten = new Map<string, number>();
let allForgotten = 0;

/** When a picture was last taken, which no two share: it tells two of one key apart. */
let lastAt = 0;

/** Pictures taken and not yet kept, a frame's together, the newest few. */
interface Taken {
  at: number;
  mine: number;
  parts: { jpeg: Buffer; key: string; shows: string }[];
}
const unkept = new Map<number, Taken>();
const TAKEN_MAX = 4;

/**
 * Pictures of parts of a window as it is drawn now, web pages included, all
 * cut from the one frame. Nothing says which frame a capture comes back
 * with, and the window may have moved on before it did, so they are kept
 * only once the window says what it shows never changed meanwhile
 * (`keepHoverPictures`). Answers what to keep them by, or nothing when no
 * frame came.
 */
export async function takeHoverPictures(
  contents: WebContents,
  asked: PictureAsked[],
): Promise<null | number> {
  const [first] = asked;
  if (!first || contents.isDestroyed()) {
    return null;
  }
  captures += 1;
  const mine = captures;
  const whole = around(asked.map(({ rect }) => rect));
  let image: Electron.NativeImage;
  try {
    image = await captureFrame(contents, {
      deadlineMs: DEADLINE_MS,
      rect: whole,
      rejectEmpty: true,
    });
  } catch (error) {
    log.info(
      `not taken reason=${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  // The frame comes in the screen's own pixels.
  const scale = image.getSize().width / whole.width;
  lastAt = Math.max(Date.now(), lastAt + 1);
  const at = lastAt;
  const parts = asked.map(({ key, rect, shows }) => {
    const cut = image.crop({
      height: Math.min(
        Math.floor(rect.height * scale),
        Math.round((rect.width * scale * MAX_HEIGHT) / WIDTH),
      ),
      width: Math.floor(rect.width * scale),
      x: Math.round((rect.x - whole.x) * scale),
      y: Math.round((rect.y - whole.y) * scale),
    });
    return {
      jpeg: cut
        .resize({
          quality: "good",
          width: Math.min(WIDTH, cut.getSize().width),
        })
        .toJPEG(QUALITY),
      key,
      shows,
    };
  });
  unkept.set(mine, { at, mine, parts });
  for (const oldest of unkept.keys()) {
    if (unkept.size <= TAKEN_MAX) {
      break;
    }
    unkept.delete(oldest);
  }
  return mine;
}

/**
 * Keeps the pictures taken as `id`, each in place of the one before, on
 * disk, where they outlive a quit. A key thrown away since they were asked
 * for keeps none.
 */
export async function keepHoverPictures(id: number): Promise<PictureKept[]> {
  const frame = unkept.get(id);
  unkept.delete(id);
  if (!frame) {
    return [];
  }
  const { at, mine, parts } = frame;
  return inTurn(async () => {
    const { dir, held } = await opened();
    await fs.mkdir(dir, { recursive: true });
    const kept: PictureKept[] = [];
    for (const { jpeg, key, shows } of parts) {
      const name = hash(key);
      const was = held.get(name);
      if (
        (forgotten.get(name) ?? 0) >= mine ||
        allForgotten >= mine ||
        (was && was.at > at)
      ) {
        continue;
      }
      const file = `${name}.${hash(shows)}.${at.toString()}.jpg`;
      const partial = path.join(dir, `${file}.partial`);
      await fs.writeFile(partial, jpeg);
      await fs.rename(partial, path.join(dir, file));
      held.set(name, { at, file, shows: hash(shows) });
      if (was) {
        retire(path.join(dir, was.file));
      }
      kept.push({ at, key, url: hoverPictureUrl(file) });
    }
    return kept;
  });
}

/**
 * The pictures kept of what is asked for as it stands, with the address of
 * those taken since the asker's (`have`). One with no picture is left out.
 */
export async function readHoverPictures(
  wanted: { have?: number | undefined; key: string; shows: string }[],
): Promise<PictureKept[]> {
  return inTurn(async () => {
    const { held } = await opened();
    return wanted.flatMap(({ have, key, shows }): PictureKept[] => {
      const picture = held.get(hash(key));
      if (!picture || picture.shows !== hash(shows)) {
        return [];
      }
      return picture.at === have
        ? [{ at: picture.at, key }]
        : [{ at: picture.at, key, url: hoverPictureUrl(picture.file) }];
    });
  });
}

/** Throws away every picture but those of `keys`. */
export async function keepOnlyHoverPictures(keys: string[]): Promise<void> {
  const kept = new Set(keys.map(hash));
  await inTurn(async () => {
    const { dir, held } = await opened();
    const names = await fs.readdir(dir).catch((): string[] => []);
    await Promise.all(
      names
        .filter(
          (name) =>
            // A write the app quit in the middle of left its partial file.
            name.endsWith(".partial") || !kept.has(name.split(".")[0] ?? ""),
        )
        .map((name) => fs.rm(path.join(dir, name), { force: true })),
    );
    for (const id of held.keys()) {
      if (!kept.has(id)) {
        held.delete(id);
      }
    }
  });
}

/** Throws away the pictures of tabs and groups that are gone. */
export async function forgetHoverPictures(keys: string[]): Promise<void> {
  for (const key of keys) {
    forgotten.set(hash(key), captures);
  }
  await inTurn(async () => {
    const { dir, held } = await opened();
    await Promise.all(
      keys.map(async (key) => {
        const id = hash(key);
        const picture = held.get(id);
        held.delete(id);
        if (picture) {
          await fs.rm(path.join(dir, picture.file), { force: true });
        }
      }),
    );
  });
}

/** Throws away every picture, the ones on their way included. */
export async function clearHoverPictures(): Promise<void> {
  allForgotten = captures;
  await keepOnlyHoverPictures([]);
}

/**
 * The bytes of a kept picture by its file name, for the app protocol's host;
 * nothing for a name that is not one, or a picture since thrown away.
 */
export async function hoverPictureBytes(
  file: string,
): Promise<Buffer | undefined> {
  if (!HOVER_PICTURE_NAME_PATTERN.test(file)) {
    return undefined;
  }
  return fs
    .readFile(path.join(workspaceBrowserDir(), "hover-pictures", file))
    .catch(() => undefined);
}

/** The folder, and what it holds. Asked for in turn only. */
async function opened() {
  const dir = path.join(workspaceBrowserDir(), "hover-pictures");
  if (index?.dir !== dir) {
    index = { dir, held: heldIn(dir) };
  }
  return { dir, held: await index.held };
}

async function heldIn(dir: string): Promise<Map<string, Held>> {
  const held = new Map<string, Held>();
  const names = await fs.readdir(dir).catch((): string[] => []);
  for (const file of names) {
    const [, id, shows, taken] = HOVER_PICTURE_NAME_PATTERN.exec(file) ?? [];
    if (id === undefined || shows === undefined || taken === undefined) {
      continue;
    }
    const at = Number(taken);
    const was = held.get(id);
    // A picture replaced just before the app last quit.
    if (was && was.at >= at) {
      retire(path.join(dir, file));
      continue;
    }
    if (was) {
      retire(path.join(dir, was.file));
    }
    held.set(id, { at, file, shows });
  }
  return held;
}

/** How long a replaced picture is still served: another window may show its address until it next reads. */
const REPLACED_KEPT_MS = 60_000;

/** A replaced picture's file, removed once no window should still be showing it. */
function retire(file: string) {
  setTimeout(() => {
    void fs.rm(file, { force: true });
  }, REPLACED_KEPT_MS).unref();
}

async function inTurn<T>(step: () => Promise<T>): Promise<T> {
  const mine = work.then(step);
  work = mine.catch(() => undefined);
  return mine;
}

/** The least rectangle with all of `rects` in it. */
function around(rects: Rectangle[]): Rectangle {
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    x,
    y,
  };
}

function hash(text: string) {
  return createHash("sha1").update(text).digest("hex");
}
