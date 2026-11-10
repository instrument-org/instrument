import { openPathOnComputer } from "@/electron-main/lib/open-path";
import { checkoutRoot, worktreeName } from "@/electron-main/lib/worktree-name";
import {
  type Capture,
  CAPTURE_NAME_PATTERN,
  type CaptureBuild,
  type CaptureContext,
  type CaptureMeta,
  CaptureMetaSchema,
} from "@/shared/captures";
import { APP_FLAVOR } from "@instrument-org/shared";
import {
  app,
  clipboard,
  ClipboardItem,
  nativeImage,
  shell,
  type WebContents,
} from "electron";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { isPng, readCaptureText, withCaptureText } from "./capture-png";

/**
 * One folder every build on this computer saves captures to: the real home
 * folder's `.instrument/captures/`, whatever userData, workspace or data home
 * the build runs with, so a capture taken in a throwaway instance is found
 * again from any other.
 */
function capturesDir() {
  return path.join(os.userInfo().homedir, ".instrument", "captures");
}

/** Where a capture's picture is kept from before its first edit, for Revert. */
function originalsDir() {
  return path.join(capturesDir(), ".originals");
}

/** How many of a capture's first bytes are read to find its text. */
const HEAD_BYTES = 512 * 1024;

const pad = (n: number) => String(n).padStart(2, "0");

/** A file name like the Mac's own screenshots: `Instrument 2026-11-10 at 08.00.06.png`. */
function nameFor(date: Date, attempt: number) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
  return `Instrument ${day} at ${time}${attempt > 0 ? ` ${attempt + 1}` : ""}.png`;
}

function git(args: string[], cwd: string) {
  try {
    return (
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 2000,
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

/** The build running now, as a capture records it. */
export function currentBuild(): CaptureBuild {
  if (app.isPackaged) {
    return {
      env: APP_FLAVOR.kind === "preview" ? "preview" : "production",
      ...(APP_FLAVOR.kind === "preview" && { name: APP_FLAVOR.name }),
      version: app.getVersion(),
    };
  }
  const root = checkoutRoot();
  return {
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"], root),
    commit: git(["rev-parse", "--short", "HEAD"], root),
    env: "development",
    name: worktreeName(),
    version: app.getVersion(),
  };
}

/** A name in the captures folder, or an error for anything the folder can't hold. */
function checkedName(name: string) {
  if (!CAPTURE_NAME_PATTERN.test(name)) {
    throw new Error(`Not a capture: ${name}`);
  }
  return name;
}

export function capturePath(name: string) {
  return path.join(capturesDir(), checkedName(name));
}

/** The width a capture's small picture is made at, enough for a 2x screen. */
const THUMBNAIL_WIDTH = 640;
const thumbnails = new Map<string, Buffer>();

/**
 * A capture made small with a good filter, for the lists and the corner: a
 * whole window scaled down by the browser to a tile's width comes out jagged.
 * Kept per file and version until the app quits.
 */
export async function captureThumbnail(name: string) {
  const file = capturePath(name);
  const stat = await fs.stat(file);
  const key = `${name}@${stat.mtimeMs}`;
  const kept = thumbnails.get(key);
  if (kept) {
    return kept;
  }
  const image = nativeImage.createFromBuffer(await fs.readFile(file));
  const small =
    image.getSize().width > THUMBNAIL_WIDTH
      ? image.resize({ quality: "best", width: THUMBNAIL_WIDTH })
      : image;
  const jpeg = small.toJPEG(88);
  thumbnails.set(key, jpeg);
  return jpeg;
}

async function readMeta(file: string): Promise<CaptureMeta | undefined> {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    const parsed = CaptureMetaSchema.safeParse(
      readCaptureText(buffer.subarray(0, bytesRead)),
    );
    return parsed.success ? parsed.data : undefined;
  } finally {
    await handle.close();
  }
}

/**
 * Takes the window's picture as it is drawn now and saves it with what the
 * window said about itself, the elements' places turned into the picture's
 * pixels so a crop can snap to them later.
 */
export async function takeCapture(
  contents: WebContents,
  context: CaptureContext,
): Promise<Capture> {
  const image = await contents.capturePage();
  const size = image.getSize();
  const scale =
    context.viewport.width > 0 ? size.width / context.viewport.width : 1;
  const meta: CaptureMeta = {
    build: currentBuild(),
    ...(context.chatId && { chatId: context.chatId }),
    ...(context.chatTitle && { chatTitle: context.chatTitle }),
    elements: context.elements.map((element) => ({
      h: Math.round(element.h * scale),
      label: element.label,
      w: Math.round(element.w * scale),
      x: Math.round(element.x * scale),
      y: Math.round(element.y * scale),
    })),
    os: {
      arch: process.arch,
      platform: process.platform,
      release: process.getSystemVersion(),
    },
    screen: context.screen,
    takenAt: Date.now(),
    theme: context.theme,
    window: {
      height: Math.round(context.viewport.height),
      width: Math.round(context.viewport.width),
    },
    ...(context.workspace && { workspace: context.workspace }),
    zoom: context.zoom,
  };
  const png = withCaptureText(image.toPNG(), meta);
  await fs.mkdir(capturesDir(), { recursive: true });
  const date = new Date(meta.takenAt);
  for (let attempt = 0; ; attempt += 1) {
    const name = nameFor(date, attempt);
    try {
      await fs.writeFile(path.join(capturesDir(), name), png, { flag: "wx" });
      return { meta, name, stamp: meta.takenAt };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt > 50) {
        throw error;
      }
    }
  }
}

/** Every capture in the folder, newest first. */
export async function listCaptures(): Promise<Capture[]> {
  void sweepTrashed();
  let names: string[];
  try {
    names = await fs.readdir(capturesDir());
  } catch {
    return [];
  }
  const captures = await Promise.all(
    names
      .filter((name) => CAPTURE_NAME_PATTERN.test(name))
      .map(async (name): Promise<Capture | undefined> => {
        const file = path.join(capturesDir(), name);
        try {
          const stat = await fs.stat(file);
          const meta = await readMeta(file);
          return { ...(meta && { meta }), name, stamp: stat.mtimeMs };
        } catch {
          return undefined;
        }
      }),
  );
  return captures
    .filter((capture) => capture !== undefined)
    .toSorted(
      (a, b) => (b.meta?.takenAt ?? b.stamp) - (a.meta?.takenAt ?? a.stamp),
    );
}

/**
 * Saves an edit over the capture, keeping its picture from before the first
 * edit so Revert can bring it back, and what it said about itself, the
 * elements' places dropped since a crop moved them.
 */
export async function saveCaptureEdit(
  name: string,
  png: Buffer,
): Promise<Capture> {
  const file = capturePath(name);
  if (!isPng(png)) {
    throw new Error("The edit isn't a PNG");
  }
  const meta = await readMeta(file);
  const original = path.join(originalsDir(), name);
  await fs.mkdir(originalsDir(), { recursive: true });
  try {
    await fs.copyFile(file, original, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
  const edited = meta ? { ...meta, edited: true, elements: [] } : undefined;
  await fs.writeFile(file, edited ? withCaptureText(png, edited) : png);
  const stat = await fs.stat(file);
  return { ...(edited && { meta: edited }), name, stamp: stat.mtimeMs };
}

/** Puts back the picture a capture had before it was edited. */
export async function revertCapture(name: string): Promise<Capture> {
  const file = capturePath(name);
  const original = path.join(originalsDir(), checkedName(name));
  await fs.copyFile(original, file);
  await fs.rm(original, { force: true });
  const stat = await fs.stat(file);
  const meta = await readMeta(file);
  return { ...(meta && { meta }), name, stamp: stat.mtimeMs };
}

/** Whether a capture has a picture from before an edit to go back to. */
export async function hasOriginal(name: string) {
  try {
    await fs.access(path.join(originalsDir(), checkedName(name)));
    return true;
  } catch {
    return false;
  }
}

export async function copyCapture(name: string) {
  const png = await fs.readFile(capturePath(name));
  await clipboard.write([
    new ClipboardItem({ "image/png": new Blob([png], { type: "image/png" }) }),
  ]);
}

/**
 * Where a capture waits between Move to Trash and the system Trash, so its
 * Undo can put it back: the Trash itself gives nothing back to an app.
 */
function trashedDir() {
  return path.join(capturesDir(), ".trashed");
}

/** How long a capture waits there before it goes to the system Trash regardless. */
const TRASHED_GRACE_MS = 2 * 60_000;

/** The capture's own file and its picture from before an edit, each with where it waits. */
function trashPairs(name: string) {
  const checked = checkedName(name);
  return [
    [path.join(capturesDir(), checked), path.join(trashedDir(), checked)],
    [
      path.join(originalsDir(), checked),
      path.join(trashedDir(), `${checked}.original`),
    ],
  ] as const;
}

async function moveIfThere(from: string, to: string) {
  try {
    await fs.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

/** Takes a capture out of the list, holding it where Undo can put it back. */
export async function trashCapture(name: string) {
  await fs.mkdir(trashedDir(), { recursive: true });
  for (const [from, to] of trashPairs(name)) {
    await moveIfThere(from, to);
  }
}

/** Puts back a capture Move to Trash took out. */
export async function restoreCapture(name: string) {
  await fs.mkdir(originalsDir(), { recursive: true });
  for (const [to, from] of trashPairs(name)) {
    await moveIfThere(from, to);
  }
}

/** Sends a capture taken out to the system Trash, once its Undo has gone. */
export async function finishTrashingCapture(name: string) {
  for (const [, held] of trashPairs(name)) {
    try {
      await shell.trashItem(held);
    } catch {
      // Already gone, or already sent.
    }
  }
}

/** Sends to the system Trash what waited past its grace, as after a quit with the toast up. */
async function sweepTrashed() {
  let names: string[];
  try {
    names = await fs.readdir(trashedDir());
  } catch {
    return;
  }
  await Promise.all(
    names.map(async (name) => {
      const file = path.join(trashedDir(), name);
      try {
        const stat = await fs.stat(file);
        if (Date.now() - stat.ctimeMs > TRASHED_GRACE_MS) {
          await shell.trashItem(file);
        }
      } catch {
        // Gone while sweeping.
      }
    }),
  );
}

/**
 * What a coding agent needs to look into a capture: where the picture is on
 * disk, and what the window was showing, so a pasted note is enough to open
 * the picture and find the screen and build it came from.
 */
export async function captureAgentNote(name: string) {
  const file = capturePath(name);
  const meta = await readMeta(file);
  const lines = [
    `Screenshot of the Instrument app window: ${file}`,
    "Open the image at that path to see what I captured.",
  ];
  if (meta) {
    const build = meta.build;
    const checkout = [
      build.name && `worktree ${build.name}`,
      build.branch && `branch ${build.branch}`,
      build.commit && `commit ${build.commit}`,
    ].filter(Boolean);
    lines.push(
      "",
      `Taken: ${new Date(meta.takenAt).toLocaleString()}`,
      `Build: ${build.version} ${build.env}${checkout.length > 0 ? ` (${checkout.join(", ")})` : ""}`,
      `Screen: ${meta.screen}${meta.chatTitle ? `, chat "${meta.chatTitle}"` : ""}${meta.chatId ? ` (id ${meta.chatId})` : ""}`,
      `Window: ${meta.window.width} × ${meta.window.height} at ${Math.round(meta.zoom * 100)}% zoom, ${meta.theme} theme, ${meta.os.platform} ${meta.os.release} ${meta.os.arch}`,
      ...(meta.workspace ? [`Workspace: ${meta.workspace}`] : []),
      ...(meta.edited
        ? ["The picture was cropped or marked up after it was taken."]
        : []),
      "",
      `The PNG also carries this as JSON in an iTXt chunk with the keyword "instrument-capture", including the on-screen box of every element when it was taken${meta.edited ? " (dropped by the edit)" : ""}.`,
    );
  }
  return { note: lines.join("\n"), path: file };
}

export function showCapture(name?: string) {
  if (name) {
    shell.showItemInFolder(capturePath(name));
    return;
  }
  void fs
    .mkdir(capturesDir(), { recursive: true })
    .then(() => openPathOnComputer(capturesDir()));
}
