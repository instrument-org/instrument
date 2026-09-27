import { app, webContents } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** How wide a thumbnail is kept: sharp in a rail tile at 2x, a few KB as a JPEG. */
const WIDTH = 360;
const QUALITY = 72;

/** How many pictures are held in memory; the rest are read back from disk when drawn. */
const HELD = 48;

/** The pictures read or taken lately, by their key, as data URLs, oldest first. */
const pictures = new Map<string, string>();

/** The newest capture started for each key, so an older one finishing late is dropped. */
const latest = new Map<string, number>();
let captures = 0;

function folder() {
  return path.join(app.getPath("userData"), "page-thumbnails");
}

function nameOf(key: string) {
  return `${createHash("sha1").update(key).digest("hex")}.jpg`;
}

function asDataUrl(jpeg: Buffer) {
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
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

/**
 * A picture of a browser guest's page as it is drawn now, kept under `key`
 * (the tab's id) in memory and on disk, so a rail reopened later, or after
 * the app was quit, shows the page at once without loading it. Only a
 * `<webview>` guest is captured; any other contents is refused. Nothing when
 * the guest is gone, drew nothing, or a newer capture of the same key
 * started meanwhile.
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
  latest.set(key, mine);
  const image = await guest.capturePage();
  if (image.isEmpty() || latest.get(key) !== mine) {
    return null;
  }
  const jpeg = image.resize({ quality: "good", width: WIDTH }).toJPEG(QUALITY);
  const url = asDataUrl(jpeg);
  hold(key, url);
  await fs.mkdir(folder(), { recursive: true });
  await fs.writeFile(path.join(folder(), nameOf(key)), jpeg);
  return url;
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

/** Throws away the pictures of pages that are gone: a tab closed, or its chat trashed. */
export async function forgetPageThumbnails(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      pictures.delete(key);
      latest.delete(key);
      await fs.rm(path.join(folder(), nameOf(key)), { force: true });
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
      .filter((name) => name.endsWith(".jpg") && !kept.has(name))
      .map((name) => fs.rm(path.join(folder(), name), { force: true })),
  );
  for (const key of pictures.keys()) {
    if (!kept.has(nameOf(key))) {
      pictures.delete(key);
    }
  }
}
