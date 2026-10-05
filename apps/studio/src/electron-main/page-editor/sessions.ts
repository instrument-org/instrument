import {
  type GuestRecord,
  guests,
} from "@/electron-main/browser-view/guest-registry";
import { utf8Text } from "@/electron-main/lib/utf8-text";
import { PAGE_EDITOR_BOOT_CHANNEL } from "@/shared/page-editor-channels";
import { stampPageSource } from "@/shared/page-source";
import { is } from "@electron-toolkit/utils";
import {
  isPageEditAddress,
  PAGE_EDIT_PARAM,
  withoutPageEditParam,
} from "@instrument-org/shared";
import { ipcMain, net, type Session, type WebContents } from "electron";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Editing a page's file in place, in the guest that shows it.
 *
 * The page keeps running where it always runs: in its sandboxed guest, at its
 * own `file://` address, with the same folder confinement. What changes in
 * Edit is the text the guest is handed. The main process reads the file,
 * stamps a `data-src-id` on every element the file writes (on the copy only;
 * nothing is written to disk), and loads that copy at the file's own address
 * with one query parameter added, `?instrument-edit=<nonce>`. The guest's
 * session answers that exact address with the copy and every other `file://`
 * address from disk ({@link serveEditedPages}), so the document's URL, origin,
 * folder and relative addresses are the file's own, and a page of any size
 * can be edited.
 *
 * The editor itself runs in the guest's isolated world, the one its preload
 * runs in: it shares the page's DOM and none of its JavaScript. The preload
 * asks here, synchronously and before the page's first script, whether this
 * load is an edit; when it is, the answer carries the editor bundle and the
 * exact text that was stamped, so what the editor indexes is byte for byte
 * what the page was built from.
 *
 * A guest's Edit is the `edit` of its record in the guest registry, so it
 * goes with the guest.
 */

/** The last load's generation, across every guest. */
let generations = 0;

/** The browser session whose `file://` requests go through {@link serveEditedPages} now. */
let served: null | Session = null;

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
}): Promise<{ generation: number }> {
  const guest = guestOf(webContentsId);
  if (!guest) {
    throw new Error("That page is not open");
  }
  if (!showsFile(guest, filePath)) {
    throw new Error("That page is not showing this file");
  }
  const disk = utf8Text(await fs.promises.readFile(filePath));
  if (disk === null) {
    throw new Error(
      "This page is not UTF-8 text, so editing it here would change characters it does not touch",
    );
  }
  const src = text ?? disk;
  const url = editAddress(guest.contents, filePath);
  generations += 1;
  const generation = generations;
  serveEditedPages(guest.contents.session);
  guest.edit = {
    generation,
    path: filePath,
    src,
    stamped: stampPageSource(src),
    state: state ?? null,
    url,
    version: versionOf(disk),
  };
  try {
    await guest.contents.loadURL(url);
  } catch (error) {
    // A copy that never showed ends its Edit here, and with the last one the
    // session's `file://` handler, rather than being left to a navigation that
    // may never come.
    if (guest.edit?.generation === generation) {
      endEdit(guest);
    }
    throw error;
  }
  // Each reload replaces the copy before it, so Back never lands on one.
  forgetStampedCopies(guest.contents);
  return { generation };
}

export function servePageEditorBoot() {
  ipcMain.on(PAGE_EDITOR_BOOT_CHANNEL, (event) => {
    const session = guests.get(event.sender.id)?.edit;
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
  webContentsId,
}: {
  generation: number;
  path: string;
  webContentsId: number;
}) {
  const record = guestOf(webContentsId);
  if (!record) {
    return;
  }
  if (record.edit && record.edit.generation !== generation) {
    return;
  }
  endEdit(record);
  const guest = record.contents;
  const shown = guest.getURL();
  if (isPageEditAddress(shown)) {
    const href = withoutPageEditParam(shown);
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

/**
 * The address a page's copy in Edit loads at: the file's own, keeping the
 * query and fragment the guest showed it with, plus a fresh nonce.
 */
function editAddress(guest: WebContents, filePath: string) {
  const address = new URL(pathToFileURL(filePath).href);
  try {
    const current = new URL(withoutPageEditParam(guest.getURL()));
    if (current.protocol === "file:" && current.pathname === address.pathname) {
      address.search = current.search;
      address.hash = current.hash;
    }
  } catch {
    // Not showing an address yet; the file's own will do.
  }
  address.searchParams.append(PAGE_EDIT_PARAM, randomUUID());
  return address.href;
}

/** Ends a guest's Edit, and stops serving the browser session once no Edit is live in it. */
function endEdit(record: GuestRecord) {
  record.edit = null;
  stopServingWhenIdle();
}

/** Every stamped copy in a guest's history but the one it shows. */
function forgetStampedCopies(guest: WebContents) {
  const history = guest.navigationHistory;
  const active = history.getActiveIndex();
  for (let index = history.length() - 1; index >= 0; index -= 1) {
    if (
      index !== active &&
      isPageEditAddress(history.getEntryAtIndex(index).url)
    ) {
      history.removeEntryAtIndex(index);
    }
  }
}

/**
 * A `file://` request of a page in Edit that is not its copy, answered from
 * disk: a file that cannot be read is not found, and a range is a partial
 * answer that names the whole file's size.
 */
async function fromDisk(request: Request) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range) {
    return rangeFromDisk(
      fileURLToPath(request.url),
      range[1] ?? "",
      range[2] ?? "",
    );
  }
  try {
    return await net.fetch(request, { bypassCustomProtocolHandlers: true });
  } catch {
    return new Response(null, { status: 404 });
  }
}

/** A browser guest's record by its id; never a popup or anything else a caller could name. */
function guestOf(webContentsId: number) {
  const record = guests.get(webContentsId);
  return record?.role === "webview" && !record.contents.isDestroyed()
    ? record
    : undefined;
}

async function rangeFromDisk(hostPath: string, from: string, to: string) {
  let file: fs.promises.FileHandle;
  try {
    file = await fs.promises.open(hostPath, "r");
  } catch {
    return new Response(null, { status: 404 });
  }
  try {
    const { size } = await file.stat();
    const [start, end] = from
      ? [Number(from), to ? Math.min(Number(to), size - 1) : size - 1]
      : [Math.max(0, size - Number(to)), size - 1];
    if (start >= size || start > end) {
      return new Response(null, {
        headers: { "content-range": `bytes */${size}` },
        status: 416,
      });
    }
    const body = new Uint8Array(end - start + 1);
    await file.read(body, 0, body.length, start);
    return new Response(body, {
      headers: {
        "accept-ranges": "bytes",
        "content-length": String(body.length),
        "content-range": `bytes ${start}-${end}/${size}`,
      },
      status: 206,
    });
  } finally {
    await file.close();
  }
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
 * Answers the guest session's `file://` requests while an Edit is live in
 * it: the stamped copy for the address that Edit loaded, the file from disk
 * for everything else. A protocol request does not say which guest made it,
 * so the address's nonce is what picks the copy. The folder rule
 * (`local-file-policy.ts`) runs before this, on the same address. Registered
 * by the first Edit and removed with the last ({@link endEdit}), so the
 * browser's own file loading serves every page nobody is editing.
 */
function serveEditedPages(guestSession: Session) {
  if (served) {
    return;
  }
  served = guestSession;
  guestSession.protocol.handle("file", (request) => {
    const url = withoutFragment(request.url);
    if (isPageEditAddress(url)) {
      for (const { edit } of guests.records()) {
        if (edit && withoutFragment(edit.url) === url) {
          return new Response(edit.stamped, {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
      }
      // An Edit that has ended (a reload racing the stop, a stale history
      // entry, an address typed by hand) goes back to the file's own address
      // rather than showing the file under an address that still says Edit.
      return Response.redirect(withoutPageEditParam(request.url), 302);
    }
    return fromDisk(request);
  });
}

/**
 * Whether the guest's page is this file, by the document it last loaded
 * rather than its address: a page's own script can move its address to
 * another file with `history.pushState`, and Edit must never open the file
 * that address names. A guest already editing this file shows its stamped
 * copy, which is the file too.
 */
function showsFile(guest: GuestRecord, filePath: string) {
  const committed = guests.documentOf(guest.id, guest.contents.mainFrame);
  if (committed === undefined) {
    return false;
  }
  if (isPageEditAddress(committed)) {
    return guest.edit?.path === filePath;
  }
  try {
    return path.resolve(fileURLToPath(committed)) === path.resolve(filePath);
  } catch {
    return false;
  }
}

/**
 * Ends a guest's Edit when it leaves the stamped copy for any other address
 * (a link, the page's own script, a step through history), and with the
 * guest itself. Called once for each guest, by the session's setup.
 */
export function followPageEdits(guest: WebContents) {
  const { id } = guest;
  guest.on("did-navigate", (_event, url) => {
    const record = guests.get(id);
    if (record?.edit && url !== record.edit.url) {
      endEdit(record);
    }
    // An Edit address with no Edit behind it (a reload that raced the end of
    // one, or a stale history entry) goes to the file's own address, so the
    // tab never shows the file under an address that still says Edit.
    if (isPageEditAddress(url) && guests.get(id)?.edit?.url !== url) {
      setImmediate(() => {
        if (!guest.isDestroyed() && guest.getURL() === url) {
          guest.loadURL(withoutPageEditParam(url)).then(
            () => {
              forgetStampedCopies(guest);
            },
            () => {
              // A navigation of the page's own overtook this one; the tab is
              // no longer at the Edit address either way.
            },
          );
        }
      });
    }
  });
  // After the registry's own listener, so the guest's record is gone.
  guest.once("destroyed", stopServingWhenIdle);
}

/** Stops serving the browser session's `file://` requests once no guest is editing. */
function stopServingWhenIdle() {
  if (!served || [...guests.records()].some(({ edit }) => edit !== null)) {
    return;
  }
  served.protocol.unhandle("file");
  served = null;
}

function withoutFragment(url: string) {
  const at = url.indexOf("#");
  return at === -1 ? url : url.slice(0, at);
}
