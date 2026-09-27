import { PAGE_EDITOR_BOOT_CHANNEL } from "@/shared/page-editor-channels";
import { stampPageSource } from "@/shared/page-source";
import { is } from "@electron-toolkit/utils";
import { ipcMain, type WebContents, webContents } from "electron";
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
  /** Which load this is: `stop` names the one it ends, so a late stop never ends a later Edit. */
  generation: number;
  /** The file on this computer the guest shows. */
  path: string;
  /** The text the stamped copy was made from. */
  src: string;
  /** What the editor handed over when it asked to be reloaded: its undo stack, selection, scroll. */
  state: unknown;
  /**
   * The exact address the stamped copy was loaded at. Only a document at this
   * address is this edit: history, a page's own navigation or a reload of an
   * older copy lands anywhere else, and gets no editor.
   */
  url: string;
  version: string;
}

const sessions = new Map<number, EditSession>();

/** Guests whose navigations and end are watched, once each for their lifetime. */
const watched = new Set<number>();

let generations = 0;

/** How a stamped copy's address starts, which tells one apart in a guest's history. */
const STAMPED_PREFIX = "data:text/html;charset=utf-8;base64,";

/** The longest address Chromium loads; a stamped copy past it cannot be shown. */
const MAX_URL_LENGTH = 2 * 1024 * 1024;

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

/**
 * The page file an editing guest shows, for the folder confinement of its
 * data-loaded copy: only for a frame at the stamped copy's own address.
 */
export function editedPageOf(
  webContentsId: number | undefined,
  frameUrl: string | undefined,
) {
  const session =
    webContentsId === undefined ? undefined : sessions.get(webContentsId);
  return session && frameUrl === session.url ? session.path : undefined;
}

/**
 * Shows a page's file in its guest ready to edit: `text` when the editor asks
 * to be reloaded on text it already holds, the file as it is on disk
 * otherwise. A page whose stamped copy is too long an address to load is
 * left as it is.
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
}): Promise<{ generation: number; tooLarge: false } | { tooLarge: true }> {
  const guest = guestOf(webContentsId);
  if (!guest) {
    throw new Error("That page is not open");
  }
  const disk = await fs.promises.readFile(filePath, "utf8");
  const src = text ?? disk;
  const url = `${STAMPED_PREFIX}${Buffer.from(stampPageSource(src)).toString("base64")}`;
  if (url.length > MAX_URL_LENGTH) {
    return { tooLarge: true };
  }
  watch(guest);
  generations += 1;
  const generation = generations;
  sessions.set(guest.id, {
    generation,
    path: filePath,
    src,
    state: state ?? null,
    url,
    version: versionOf(disk),
  });
  await guest.loadURL(url, {
    baseURLForDataURL: pathToFileURL(filePath).href,
  });
  // Each reload replaces the copy before it, so Back never lands on one.
  forgetStampedCopies(guest);
  return { generation, tooLarge: false };
}

export function servePageEditorBoot() {
  ipcMain.on(PAGE_EDITOR_BOOT_CHANNEL, (event) => {
    const session = sessions.get(event.sender.id);
    const frame = event.senderFrame;
    if (
      !session ||
      !frame ||
      frame !== event.sender.mainFrame ||
      frame.url !== session.url
    ) {
      event.returnValue = null;
      return;
    }
    let bundle: string;
    try {
      bundle = readBundle();
    } catch {
      event.returnValue = { error: "The editor is not built." };
      return;
    }
    event.returnValue = {
      bundle,
      name: path.basename(session.path),
      src: session.src,
      state: session.state,
      version: session.version,
    };
  });
}

/**
 * Back to the file at its own address, exactly as View shows it, unless the
 * guest has already left the stamped copy for somewhere else. `generation`
 * names the load this ends; a stop for an earlier one changes nothing.
 */
export async function stopEditingPage({
  generation,
  path: filePath,
  webContentsId,
}: {
  generation: number;
  path: string;
  webContentsId: number;
}) {
  const guest = guestOf(webContentsId);
  if (!guest) {
    return;
  }
  const session = sessions.get(guest.id);
  if (session && session.generation !== generation) {
    return;
  }
  sessions.delete(guest.id);
  if (guest.getURL().startsWith(STAMPED_PREFIX)) {
    const href = pathToFileURL(filePath).href;
    try {
      await guest.loadURL(href);
    } catch {
      // The guest is being torn down or has been sent elsewhere meanwhile;
      // there is no page left to put back.
      return;
    }
    // The visit from before Edit is this same page, now older than the file.
    const history = guest.navigationHistory;
    const active = history.getActiveIndex();
    if (active > 0 && history.getEntryAtIndex(active - 1).url === href) {
      history.removeEntryAtIndex(active - 1);
    }
  }
  forgetStampedCopies(guest);
}

/** Every stamped copy in a guest's history but the one it shows. */
function forgetStampedCopies(guest: WebContents) {
  const history = guest.navigationHistory;
  const active = history.getActiveIndex();
  for (let index = history.length() - 1; index >= 0; index -= 1) {
    if (
      index !== active &&
      history.getEntryAtIndex(index).url.startsWith(STAMPED_PREFIX)
    ) {
      history.removeEntryAtIndex(index);
    }
  }
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

/**
 * The guest's session ends with the guest, and with the guest leaving the
 * stamped copy for any other address: a link, the page's own script, or a
 * step through history.
 */
function watch(guest: WebContents) {
  if (watched.has(guest.id)) {
    return;
  }
  watched.add(guest.id);
  const id = guest.id;
  guest.on("did-navigate", (_event, url) => {
    const session = sessions.get(id);
    if (session && url !== session.url) {
      sessions.delete(id);
    }
  });
  guest.once("destroyed", () => {
    sessions.delete(id);
    watched.delete(id);
  });
}
