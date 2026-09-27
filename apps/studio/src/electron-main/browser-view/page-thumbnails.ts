import { app, webContents } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** How wide a thumbnail is kept: sharp in a rail tile at 2x, a few KB as a JPEG. */
const WIDTH = 360;
const QUALITY = 72;

/** The pictures read or taken since launch, by their key, as data URLs. */
const pictures = new Map<string, string>();

/**
 * A picture of a browser guest's page as it is drawn now, kept under `key`
 * (the tab's id) in memory and on disk, so a rail reopened later, or after
 * the app was quit, shows the page at once without loading it. Only a
 * `<webview>` guest is captured; any other contents is refused. Nothing when
 * the guest is gone or drew nothing.
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
  const image = await guest.capturePage();
  if (image.isEmpty()) {
    return null;
  }
  const jpeg = image.resize({ quality: "good", width: WIDTH }).toJPEG(QUALITY);
  const url = asDataUrl(jpeg);
  pictures.set(key, url);
  await fs.mkdir(folder(), { recursive: true });
  await fs.writeFile(fileOf(key), jpeg);
  return url;
}

/** The last picture kept under `key`, or nothing when none was ever taken. */
export async function readPageThumbnail(key: string): Promise<null | string> {
  const kept = pictures.get(key);
  if (kept) {
    return kept;
  }
  try {
    const url = asDataUrl(await fs.readFile(fileOf(key)));
    pictures.set(key, url);
    return url;
  } catch {
    return null;
  }
}

function asDataUrl(jpeg: Buffer) {
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

function fileOf(key: string) {
  return path.join(
    folder(),
    `${createHash("sha1").update(key).digest("hex")}.jpg`,
  );
}

function folder() {
  return path.join(app.getPath("userData"), "page-thumbnails");
}
