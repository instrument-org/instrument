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
      release: os.release(),
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

export function showCapture(name?: string) {
  if (name) {
    shell.showItemInFolder(capturePath(name));
    return;
  }
  void fs
    .mkdir(capturesDir(), { recursive: true })
    .then(() => openPathOnComputer(capturesDir()));
}
