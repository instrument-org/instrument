import { stampPageSource } from "@/shared/page-source";
import { is } from "@electron-toolkit/utils";
import { ipcMain, webContents } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Editing a page's file in place, in the guest that shows it.
 *
 * The page keeps running where it always runs: in its sandboxed guest, at its
 * own `file://` address, with the same folder confinement. What changes in
 * Edit is the text the guest is handed. The main process reads the file,
 * stamps a `data-src-id` on every element the file writes (on the copy only;
 * nothing is written to disk), and loads that copy into the guest as data
 * whose base address is the file's, so the document's URL, origin and
 * relative addresses are the file's own.
 *
 * The editor itself runs in the guest's isolated world, the one its preload
 * runs in: it shares the page's DOM and none of its JavaScript. The preload
 * asks here, synchronously and before the page's first script, whether this
 * load is an edit; when it is, the answer carries the editor bundle and the
 * exact text that was stamped, so what the editor indexes is byte for byte
 * what the page was built from.
 */
interface EditSession {
  /** The file on this computer the guest shows. */
  path: string;
  /** The text the stamped copy was made from. */
  src: string;
  /** What the editor handed over when it asked to be reloaded: its undo stack, selection, scroll. */
  state: unknown;
  version: string;
}

const sessions = new Map<number, EditSession>();

export const PAGE_EDITOR_BOOT_CHANNEL = "page-editor:boot";

/** Same fingerprint as `files.read` / `files.write` give, so versions compare across them. */
function versionOf(text: string) {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

const bundlePath = () =>
  path.join(import.meta.dirname, "../page-editor/guest.js");

/** The guest's preload: tiny, and inert unless the load is an edit. */
export const pageEditorPreloadPath = () =>
  path.join(import.meta.dirname, "../page-editor/preload.cjs");

let cachedBundle: string | undefined;

/** The page file an editing guest shows, for the folder confinement of its data-loaded copy. */
export function editedPageOf(webContentsId: number | undefined) {
  return webContentsId === undefined
    ? undefined
    : sessions.get(webContentsId)?.path;
}

/**
 * Shows a page's file in its guest ready to edit: `text` when the editor asks
 * to be reloaded on text it already holds, the file as it is on disk
 * otherwise.
 */
export async function loadEditablePage({
  path: filePath,
  state,
  text,
  webContentsId,
}: {
  path: string;
  state?: unknown;
  text?: string;
  webContentsId: number;
}) {
  const guest = guestOf(webContentsId);
  if (!guest) {
    throw new Error("That page is not open");
  }
  const disk = await fs.promises.readFile(filePath, "utf8");
  const src = text ?? disk;
  if (!sessions.has(guest.id)) {
    guest.once("destroyed", () => {
      sessions.delete(guest.id);
    });
  }
  sessions.set(guest.id, {
    path: filePath,
    src,
    state: state ?? null,
    version: versionOf(disk),
  });
  const data = `data:text/html;charset=utf-8;base64,${Buffer.from(stampPageSource(src)).toString("base64")}`;
  await guest.loadURL(data, {
    baseURLForDataURL: pathToFileURL(filePath).href,
  });
}

export function servePageEditorBoot() {
  ipcMain.on(PAGE_EDITOR_BOOT_CHANNEL, (event) => {
    const session = sessions.get(event.sender.id);
    if (!session) {
      event.returnValue = null;
      return;
    }
    try {
      event.returnValue = {
        bundle: readBundle(),
        name: path.basename(session.path),
        src: session.src,
        state: session.state,
        version: session.version,
      };
    } catch {
      // No bundle built: the page shows as it is, without an editor.
      event.returnValue = null;
    }
  });
}

/** Back to the file at its own address, exactly as View shows it. */
export async function stopEditingPage({
  path: filePath,
  webContentsId,
}: {
  path: string;
  webContentsId: number;
}) {
  const guest = guestOf(webContentsId);
  if (!guest) {
    return;
  }
  sessions.delete(guest.id);
  await guest.loadURL(pathToFileURL(filePath).href);
}

/** A browser guest by id; never a window or anything else a caller could name. */
function guestOf(webContentsId: number) {
  const wc = webContents.fromId(webContentsId);
  return wc && !wc.isDestroyed() && wc.getType() === "webview" ? wc : undefined;
}

/** Read on every boot in development, so a rebuilt bundle is picked up by the next Edit. */
function readBundle() {
  if (cachedBundle !== undefined) {
    return cachedBundle;
  }
  const text = fs.readFileSync(bundlePath(), "utf8");
  if (!is.dev) {
    cachedBundle = text;
  }
  return text;
}
