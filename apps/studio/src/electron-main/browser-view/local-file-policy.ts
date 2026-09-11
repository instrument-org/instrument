import { TASK_PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import { type OnBeforeRequestListenerDetails, type Session } from "electron";
import path from "node:path";

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
 * own act (a link they clicked, a file they opened) and is left alone; the
 * agent's way of asking a guest for a `file://` address is refused before it
 * reaches the guest at all. The task's private directory is refused as a
 * segment anywhere, the way every other road to a file refuses it.
 */
export function confineLocalPagesToTheirFolder(guestSession: Session) {
  guestSession.webRequest.onBeforeRequest(
    { urls: ["file:///*"] },
    (details, callback) => {
      callback({ cancel: !isAllowedLocalRequest(details) });
    },
  );
}

const PRIVATE_DIR_SEGMENT_REGEX = new RegExp(
  `(?:^|[/\\\\])${TASK_PRIVATE_FOLDER_NAME.replace(".", "\\.")}(?:[/\\\\]|$)`,
  "i",
);

export function isAllowedLocalRequest(
  details: Pick<
    OnBeforeRequestListenerDetails,
    "frame" | "resourceType" | "url"
  >,
): boolean {
  const requested = hostPathOf(details.url);
  if (requested === undefined || PRIVATE_DIR_SEGMENT_REGEX.test(requested)) {
    return false;
  }
  if (details.resourceType === "mainFrame") {
    return true;
  }
  const page = hostPathOf(details.frame?.url);
  if (page === undefined) {
    return false;
  }
  const folder = path.dirname(page);
  return requested.startsWith(`${folder}${path.sep}`);
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
