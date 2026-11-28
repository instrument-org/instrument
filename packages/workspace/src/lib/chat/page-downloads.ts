import { type StoreId } from "../../schemas/store-id";
import { type BrowserTargetId } from "../../types";
import { getDownloadsDir } from "../chat-dir-utils";
import { shellPath } from "../shell-path";
import { actsIn, tabOfPage } from "../tab-activity";
import { ownWorkFolder, workDir } from "../work-dir";

/** A download a page an agent drives started, as the session is told of it. */
interface PageDownload {
  /** The tab whose page started it, by the id agents name it by where a command or list named it, else the page's. */
  from: string;
  /** Where it is saved, as the agent's shell names it. */
  path: string;
  state: "canceled" | "completed" | "failed" | "running";
}

/** Per session, the downloads its pages started that it has not been told of, by the app's id for each. */
const owed = new Map<StoreId.Session, Map<string, PageDownload>>();

/**
 * The downloads folder of the chat whose session last acted in a tab, where
 * a download the agent's own click or navigation started goes, made where it
 * is missing; undefined for a tab no session has acted in, whose downloads
 * are the person's, and for a folder reached through a link or that cannot
 * be made, whose download goes to the person's place too. The browser saves
 * there as the app, outside every sandbox, and a program the agent ran can
 * put a link at any name in the work folder (`ownWorkFolder`).
 */
export function agentDownloadsFolder(
  targetId: BrowserTargetId,
): string | undefined {
  const [driver] = actsIn(tabOfPage(targetId));
  if (!driver) {
    return undefined;
  }
  const folder = getDownloadsDir(workDir(driver.chatId));
  try {
    ownWorkFolder(folder, { make: true });
  } catch {
    return undefined;
  }
  return folder;
}

/**
 * A download a page an agent drives started, saved at `path` in the chat's
 * downloads folder (`agentDownloadsFolder`): kept for the next result of the
 * session that last acted in the tab, once as it begins and again as it
 * ends, each told once. `id` is the app's for the download, which ties its
 * end to its beginning.
 */
export function notePageDownload(
  from: BrowserTargetId,
  id: string,
  { path, state }: { path: string; state: PageDownload["state"] },
): void {
  const tabId = tabOfPage(from);
  const [driver] = actsIn(tabId);
  if (!driver) {
    return;
  }
  const downloads =
    owed.get(driver.sessionId) ?? new Map<string, PageDownload>();
  downloads.set(id, { from: tabId, path: shellPath(path), state });
  owed.set(driver.sessionId, downloads);
}

/**
 * The line a result ends with when a page it drove downloaded a file, as a
 * click on a download link does: where the file is, or that it is still
 * coming. Taken, so each is told once.
 */
export function pageDownloadsNote({
  sessionId,
}: {
  sessionId: StoreId.Session;
}): string | undefined {
  const downloads = [...(owed.get(sessionId)?.values() ?? [])];
  owed.delete(sessionId);
  if (downloads.length === 0) {
    return undefined;
  }
  return `${downloads.map((download) => pageDownloadLine(download)).join("\n")}\n`;
}

/** A download's line, its page named by the id agents name its tab by (`from`). */
function pageDownloadLine({
  from,
  path,
  state,
}: Omit<PageDownload, "from"> & { from: string }): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  switch (state) {
    case "canceled":
    case "failed": {
      return `The download of ${name} the page in tab ${from} started ${state === "canceled" ? "was canceled" : "failed"}.`;
    }
    case "completed": {
      return `The page in tab ${from} downloaded ${name} to ${path}.`;
    }
    case "running": {
      return `The page in tab ${from} is downloading ${name} to ${path}; the file is incomplete until a later result says it finished.`;
    }
  }
}
