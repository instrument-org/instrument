import { TASK_PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import {
  type CallbackResponse,
  type OnBeforeRequestListenerDetails,
  type Session,
  type WebContents,
} from "electron";
import fs, { realpathSync } from "node:fs";
import path from "node:path";

import { committedDocumentOf, trackFrameDocumentsIn } from "./frame-documents";

/**
 * What a page loaded from a file on this computer may read from the disk: its
 * own folder, and nothing above or beside it.
 *
 * A guest shows the person's HTML files at their `file://` address, which is
 * what their own browser would do with the file. In this browser a `file://`
 * page can also fetch other `file://` addresses, and the guest has the
 * network, so left alone a page the agent wrote could read any file on the
 * computer and send it anywhere. The sandboxed frame such a file used to open
 * in had no file access at all; this keeps the guest at least that safe while
 * letting the page keep the pictures and styles it sits beside.
 *
 * So the rule is a static server's: a page at `/a/b/page.html` reaches
 * `/a/b/**` and nothing else. A navigation to another file is the person's
 * own act (a link they clicked, a file they opened) and is left alone here;
 * the agent opens and reads only the files its own tools reach, which the CDP
 * bridge enforces. That holds only in a guest: a window a page opened never
 * shows a file (see `isAllowedGuestRequest`). The task's private directory is
 * refused as a segment anywhere, the way every other road to a file refuses
 * it.
 *
 * The page is the document its frame loaded, never the address the frame
 * shows now, which the page's own script can rewrite (see
 * `frame-documents.ts`). Call this before the session's first guest exists.
 */
export function confineLocalPagesToTheirFolder(
  guestSession: Session,
  otherRequests: (details: OnBeforeRequestListenerDetails) => CallbackResponse,
) {
  trackFrameDocumentsIn(guestSession);
  // Electron keeps one `onBeforeRequest` listener per session, so this one
  // hears every request and hands what is not a file to `otherRequests`.
  guestSession.webRequest.onBeforeRequest(
    { urls: ["<all_urls>"] },
    (details, callback) => {
      if (!details.url.startsWith("file:")) {
        callback(otherRequests(details));
        return;
      }
      if (!isAllowedGuestRequest(details)) {
        callback({ cancel: true });
        return;
      }
      if (details.resourceType === "mainFrame") {
        callback({});
        return;
      }
      void leadsBesidePage(
        details.url,
        committedDocumentOf(details.webContentsId, details.frame),
      ).then((allowed) => {
        callback({ cancel: !allowed });
      });
    },
  );
}

const PRIVATE_DIR_SEGMENT_REGEX = new RegExp(
  `(?:^|[/\\\\])${TASK_PRIVATE_FOLDER_NAME.replace(".", "\\.")}(?:[/\\\\]|$)`,
  "i",
);

/**
 * `isAllowedLocalRequest` for a browser guest's session, which also holds the
 * windows a guest's pages open (sign-in popups, see `window-open-policy.ts`).
 * An opener keeps a handle to its popup and every `file://` document shares
 * one origin, so a local page that opened a popup and then sent it to
 * `file:///etc/hosts` would read that file through the handle. So a file is
 * a page of its own only in a guest, the one contents the person navigates;
 * any other contents here is a popup, and never shows one.
 *
 * A request that names no contents at all is let through to the folder rule:
 * a guest's first navigation after a launch arrives that way, with no
 * contents, id, or frame to tell it from anything else. Popups are held back
 * where they are known instead, by {@link refuseLocalFilesInPopups}.
 */
export function isAllowedGuestRequest(
  details: Parameters<typeof isAllowedLocalRequest>[0] & {
    webContents?: Pick<WebContents, "getType">;
  },
): boolean {
  if (
    details.resourceType === "mainFrame" &&
    details.webContents !== undefined &&
    details.webContents.getType() !== "webview"
  ) {
    return false;
  }
  return isAllowedLocalRequest(details);
}

/**
 * Whether a page may save a local file as a download. A download never passes
 * through the request filter, so without this a page could hand any file on
 * the computer to whoever reads the downloads folder, which for the agent's
 * tab is the agent. Same rule as the page's own reads, so `pageUrl` is the
 * document the page loaded, never the address it shows.
 */
export function isAllowedLocalDownload(
  url: string,
  pageUrl: string | undefined,
): boolean {
  const requested = hostPathOf(url);
  return (
    requested !== undefined &&
    !PRIVATE_DIR_SEGMENT_REGEX.test(requested) &&
    sitsBesidePage(requested, hostPathOf(pageUrl))
  );
}

/**
 * The page's folder or below it by name, which is what this answers; where the
 * name really leads is {@link leadsBesidePage}, asked of every request this
 * lets through.
 */
export function isAllowedLocalRequest(
  details: Partial<Pick<OnBeforeRequestListenerDetails, "webContentsId">> &
    Pick<OnBeforeRequestListenerDetails, "frame" | "resourceType" | "url">,
): boolean {
  const requested = hostPathOf(details.url);
  if (requested === undefined || PRIVATE_DIR_SEGMENT_REGEX.test(requested)) {
    return false;
  }
  if (details.resourceType === "mainFrame") {
    return true;
  }
  const page = hostPathOf(
    committedDocumentOf(details.webContentsId, details.frame),
  );
  return (
    page !== undefined &&
    requested.startsWith(`${path.dirname(page)}${path.sep}`)
  );
}

/** The navigation half of {@link refuseLocalFilesInPopups}, for one window. */
export function refuseLocalFilesIn(popup: Pick<WebContents, "on">): void {
  popup.on("will-frame-navigate", (event) => {
    if (event.url.toLowerCase().startsWith("file:")) {
      event.preventDefault();
    }
  });
}

/**
 * Keeps a window a guest's page opened, and every window that one opens in
 * turn, from ever showing a file, whoever sends it there: its own script or
 * its opener's, which is how a local page would read another file through
 * the handle it keeps. Opening one at a file is refused before this, by the
 * open policy's http(s) rule.
 */
export function refuseLocalFilesInPopups(popup: WebContents): void {
  refuseLocalFilesIn(popup);
  popup.on("did-create-window", (child) => {
    refuseLocalFilesInPopups(child.webContents);
  });
}

/** A page's folder, resolved, for the next request from the same folder. */
const realFolders = new Map<string, Promise<string | undefined>>();
const REAL_FOLDERS_KEPT = 256;

/**
 * Whether a request the page's folder holds by name is also there by where
 * the name really leads: a symlink beside the page could otherwise point
 * anywhere. Off the main thread, since every picture and script a page loads
 * asks it. A file that does not exist has nothing to give, so its name alone
 * decides.
 *
 * The answer is about the name at the moment it is asked; the browser then
 * opens the name itself, and nothing here can hand it a descriptor instead.
 * Whoever can write into the page's folder between the two (swap a file for
 * a symlink, or create one where nothing was) gets the file it leads to. For
 * the agent that is its own folder, and the gap is a race it would have to
 * win on every read; for the person's own folders it is nobody else.
 */
export async function leadsBesidePage(
  requestUrl: string,
  pageUrl: string | undefined,
): Promise<boolean> {
  const requested = hostPathOf(requestUrl);
  const page = hostPathOf(pageUrl);
  if (requested === undefined || page === undefined) {
    return false;
  }
  const realFolder = realFolderOf(path.dirname(page));
  let realRequested: string;
  try {
    realRequested = await fs.promises.realpath(requested);
  } catch {
    return true;
  }
  const resolvedFolder = await realFolder;
  return (
    resolvedFolder !== undefined &&
    realRequested.startsWith(`${resolvedFolder}${path.sep}`) &&
    !PRIVATE_DIR_SEGMENT_REGEX.test(realRequested)
  );
}

/**
 * Whether a page may take its tab to `toUrl`, for a tab an agent drives whose
 * readable folders on this computer are `agentRoots` (null while no agent has
 * driven it). A page the agent can read may go to another such file and
 * anywhere that is not a file, and never to a file outside them: a link or a
 * script in the agent's own page is otherwise a way to open, and then read,
 * any file on the computer. A file the agent cannot read is the person's own
 * page, which the agent cannot read either, so where its links lead is left
 * to the person.
 *
 * Only for navigations the page starts. The agent's own navigations are
 * checked by the CDP bridge before they reach the guest, and the person's
 * (the address bar, opening a file) are theirs.
 */
export function mayPageNavigateTo(
  agentRoots: null | readonly string[],
  fromUrl: string | undefined,
  toUrl: string,
): boolean {
  const to = hostPathOf(toUrl);
  if (agentRoots === null || to === undefined) {
    return true;
  }
  if (isUnderAnyRoot(to, agentRoots)) {
    return true;
  }
  const from = hostPathOf(fromUrl);
  return from !== undefined && !isUnderAnyRoot(from, agentRoots);
}

/** The path a `file://` address names, normalized; nothing for any other address. */
function hostPathOf(url: string | undefined): string | undefined {
  if (!url?.startsWith("file:")) {
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    // The leading slash the URL form puts in front of a drive letter.
    const hostPath = /^\/[A-Z]:\//i.test(pathname)
      ? pathname.slice(1)
      : pathname;
    return path.resolve(hostPath);
  } catch {
    return;
  }
}

/** Under one of `roots` by name and by where the name really leads. */
function isUnderAnyRoot(hostPath: string, roots: readonly string[]) {
  const real = realpathOrSelf(hostPath);
  return roots.some((root) => {
    const realRoot = realpathOrSelf(root);
    return (
      (hostPath === root || hostPath.startsWith(`${root}${path.sep}`)) &&
      (real === realRoot || real.startsWith(`${realRoot}${path.sep}`))
    );
  });
}

function realFolderOf(folder: string) {
  let resolved = realFolders.get(folder);
  if (resolved === undefined) {
    if (realFolders.size >= REAL_FOLDERS_KEPT) {
      realFolders.clear();
    }
    resolved = realpathOrNothing(folder);
    realFolders.set(folder, resolved);
  }
  return resolved;
}

async function realpathOrNothing(hostPath: string) {
  try {
    return await fs.promises.realpath(hostPath);
  } catch {
    return;
  }
}

function realpathOrSelf(hostPath: string) {
  try {
    return realpathSync(hostPath);
  } catch {
    return hostPath;
  }
}

/**
 * In the page's folder or below it, by name and by where the name really
 * leads: a symlink beside the page could otherwise point anywhere. A file that
 * does not exist has nothing to give, so its name alone decides.
 */
function sitsBesidePage(requested: string, page: string | undefined) {
  if (page === undefined) {
    return false;
  }
  const folder = path.dirname(page);
  if (!requested.startsWith(`${folder}${path.sep}`)) {
    return false;
  }
  let realRequested: string;
  try {
    realRequested = realpathSync(requested);
  } catch {
    return true;
  }
  let realFolder: string;
  try {
    realFolder = realpathSync(folder);
  } catch {
    return false;
  }
  return (
    realRequested.startsWith(`${realFolder}${path.sep}`) &&
    !PRIVATE_DIR_SEGMENT_REGEX.test(realRequested)
  );
}
