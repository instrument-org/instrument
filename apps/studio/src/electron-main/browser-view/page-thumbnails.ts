import { workspaceBrowserDir } from "@/electron-main/lib/get-workspace-folder";
import { captureFrame } from "@/electron-main/browser-view/capture-frame";
import { log } from "@/electron-main/browser-view/log";
import { webContents } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** How wide a thumbnail is kept: sharp on a 400px transcript card at 2x. */
const WIDTH = 800;
const QUALITY = 72;

/** How long a picture is waited for; a guest that draws nothing by then gets none. */
const CAPTURE_DEADLINE_MS = 3000;

/** How many pictures are held in memory; the rest are read back from disk when drawn. */
const HELD = 48;

/** The pictures read or taken lately, by their key, as data URLs, oldest first. */
const pictures = new Map<string, string>();

/**
 * The newest capture kept for each key, by the order they were asked for, so
 * an older one finishing late never replaces a newer one. A capture still on
 * its way, or one that failed, holds nothing back.
 */
const keptCapture = new Map<string, number>();
let captures = 0;

/**
 * How many times each key's pictures were thrown away, so a capture that
 * started before its tab closed keeps nothing of it once it finishes.
 */
const forgotten = new Map<string, number>();

/** Each key's writes and removals of its file, one after another, the newest last. */
const fileWork = new Map<string, Promise<void>>();

/**
 * A picture of a browser guest's page as it is drawn now, kept under `key`
 * (the tab's id) in memory and on disk, so a rail reopened later, or after
 * the app was quit, shows the page at once without loading it. Only a
 * `<webview>` guest is captured; any other contents is refused. The window
 * is kept drawing while the picture is taken, so a page behind another app's
 * window or a minimized one still gives a frame. Nothing when the guest is
 * gone, drew nothing, or a newer capture of the same key was kept meanwhile.
 */
export async function capturePageThumbnail({
  key,
  webContentsId,
}: {
  key: string;
  webContentsId: number;
}): Promise<null | string> {
  const guest = webContents.fromId(webContentsId);
  if (!guest || guest.isDestroyed() || guest.getType() !== "webview") {
    return null;
  }
  captures += 1;
  const mine = captures;
  const era = forgotten.get(key) ?? 0;
  const isForgotten = () => (forgotten.get(key) ?? 0) !== era;
  let image: Electron.NativeImage;
  try {
    image = await captureFrame(guest, {
      deadlineMs: CAPTURE_DEADLINE_MS,
      forceDraw: true,
      rejectEmpty: true,
    });
  } catch (error) {
    // A guest closing as the picture is taken refuses it, and one that drew
    // nothing has nothing to keep.
    log.info(
      `page picture not taken key=${key} reason=${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  // A tab closed while its picture was taken keeps nothing of it.
  if (isForgotten() || (keptCapture.get(key) ?? 0) > mine) {
    return null;
  }
  keptCapture.set(key, mine);
  const jpeg = image.resize({ quality: "good", width: WIDTH }).toJPEG(QUALITY);
  const url = asDataUrl(jpeg);
  hold(key, url);
  await inTurn(key, async () => {
    // A newer picture kept, or the tab gone, while an earlier write ran.
    if (isForgotten() || keptCapture.get(key) !== mine) {
      return;
    }
    const file = path.join(folder(), nameOf(key));
    const partial = `${file}.${mine.toString()}.partial`;
    await fs.mkdir(folder(), { recursive: true });
    await fs.writeFile(partial, jpeg);
    await fs.rename(partial, file);
  });
  return url;
}

/** Throws away the pictures of pages that are gone: a tab closed, or its chat trashed. */
export async function forgetPageThumbnails(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      pictures.delete(key);
      forgotten.set(key, (forgotten.get(key) ?? 0) + 1);
      await inTurn(key, () =>
        fs.rm(path.join(folder(), nameOf(key)), { force: true }),
      );
    }),
  );
}

/**
 * Throws away every picture on disk but those of `keys`: at startup, with
 * the tabs the window restored, anything else is of a page no tab holds.
 */
export async function keepOnlyPageThumbnails(keys: string[]): Promise<void> {
  const kept = new Set(keys.map((key) => nameOf(key)));
  let names: string[];
  try {
    names = await fs.readdir(folder());
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter(
        (name) =>
          // A write the app quit in the middle of left its partial file.
          name.endsWith(".partial") ||
          (name.endsWith(".jpg") && !kept.has(name)),
      )
      .map((name) => fs.rm(path.join(folder(), name), { force: true })),
  );
  for (const key of pictures.keys()) {
    if (!kept.has(nameOf(key))) {
      pictures.delete(key);
    }
  }
}

/** The last picture kept under `key`, or nothing when none was ever taken. */
export async function readPageThumbnail(key: string): Promise<null | string> {
  const kept = pictures.get(key);
  if (kept) {
    hold(key, kept);
    return kept;
  }
  try {
    const url = asDataUrl(await fs.readFile(path.join(folder(), nameOf(key))));
    hold(key, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Runs `work` on `key`'s file once everything already asked of it is done, so
 * two writes never interleave and a removal comes after the write before it.
 * A step that fails leaves the next to run all the same.
 */
async function inTurn(key: string, work: () => Promise<void>): Promise<void> {
  const mine = (fileWork.get(key) ?? Promise.resolve()).then(work);
  const settled = mine.catch(() => undefined);
  fileWork.set(key, settled);
  try {
    await mine;
  } finally {
    if (fileWork.get(key) === settled) {
      fileWork.delete(key);
    }
  }
}

function asDataUrl(jpeg: Buffer) {
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/**
 * Beside the browser profile the pages were signed in on: these are pictures
 * of what they showed, and stay on this computer with it.
 */
function folder() {
  return path.join(workspaceBrowserDir(), "page-thumbnails");
}

function hold(key: string, url: string) {
  pictures.delete(key);
  pictures.set(key, url);
  for (const oldest of pictures.keys()) {
    if (pictures.size <= HELD) {
      break;
    }
    pictures.delete(oldest);
  }
}

function nameOf(key: string) {
  return `${createHash("sha1").update(key).digest("hex")}.jpg`;
}
