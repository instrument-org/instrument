import { err, ok, type Result, ResultAsync, safeTry } from "neverthrow";
import { z } from "zod";

import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { type BrowserTargetId } from "../types";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * A browser sitting here is not news, in either direction: it has no state to
 * tell the model about, nothing to resume, and nothing worth putting on screen.
 * `agent-browser` creates a page for any command that needs one, including
 * commands that only read state, so a target can exist for a whole session
 * without a page ever being asked for.
 */
export const BLANK_PAGE_URL = "about:blank";

const BrowserStateSchema = z.object({
  lastUsedAt: z.date(),
  /**
   * The hosts this session's browser has been on, oldest first, each once,
   * the newest visit moving its host to the end. What a chat shows as the
   * sites its work used: the pages themselves are too many to keep and too
   * many to draw, and a host is the mark a person recognizes.
   */
  visitedHosts: z.array(z.string()).default([]),
});

type BrowserState = z.output<typeof BrowserStateSchema>;

/** How many hosts a session remembers; a long crawl keeps its newest. */
const VISITED_HOSTS_MAX = 40;

/** The hosts with one more visit at the end, that host said once. */
function withVisit(hosts: string[] | undefined, url: string): string[] {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return hosts ?? [];
  }
  if (host === "") {
    return hosts ?? [];
  }
  const rest = (hosts ?? []).filter((known) => known !== host);
  return [...rest, host].slice(-VISITED_HOSTS_MAX);
}

export function getBrowserState(
  taskId: TaskId,
  sessionId: StoreId.Session,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry<BrowserState | undefined, Error>(async function* () {
    const storage = yield* getSessionsStoreStorage(taskId);
    const result = await getParsedStorageItem(
      StorageKey.browserState(sessionId),
      BrowserStateSchema,
      storage,
      { signal },
    );
    if (result.isErr()) {
      return ok(undefined);
    }
    return ok(result.value);
  });
}

/**
 * Send a target to a page the user just asked for.
 *
 * Unconditional, which is the whole difference from {@link restoreLastPage}:
 * that one is a courtesy paid to a blank tab, this one is an instruction, and
 * refusing it because the guest already holds a page would answer a click with
 * nothing.
 */
export function navigateTarget({
  targetId,
  url,
}: {
  targetId: BrowserTargetId;
  url: string;
}) {
  return safeTry(async function* () {
    // The browser calls throw rather than returning a Result, so the await is
    // wrapped the same way restoreLastPage wraps its own.
    try {
      const { browser } = getWorkspaceConfig();
      yield* ok(await browser.sendCommand(targetId, "Page.navigate", { url }));
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
    return ok(undefined);
  });
}

/**
 * Add the hosts of pages a session's work is on to what it has visited: a
 * chat's task works in tabs of the chat, opened behind whatever the user has
 * up, so the hosts are what is the session's to record.
 */
export function recordVisitedHosts({
  sessionId,
  signal,
  taskId,
  urls,
}: {
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  taskId: TaskId;
  urls: string[];
}) {
  return safeTry(async function* () {
    const current = yield* getBrowserState(taskId, sessionId, { signal });
    const known = new Set(current?.visitedHosts);
    // Every command runs through here with every tab it holds, so only a host
    // the session has not been on is worth a write; one it has been on stays
    // where its first visit put it. A blank page or a file has no host.
    const fresh = urls.filter((url) => {
      const host = hostnameOf(url);
      return host !== "" && !known.has(host);
    });
    if (fresh.length === 0) {
      return ok(undefined);
    }
    let visitedHosts = current?.visitedHosts ?? [];
    for (const url of fresh) {
      visitedHosts = withVisit(visitedHosts, url);
    }
    const storage = yield* getSessionsStoreStorage(taskId);
    yield* setParsedStorageItem(
      StorageKey.browserState(sessionId),
      { ...current, lastUsedAt: new Date(), visitedHosts },
      BrowserStateSchema,
      storage,
      { signal },
    );
    return ok(undefined);
  });
}

/**
 * Put a freshly opened window tab back on the page the window remembers it
 * at, which the window keeps for a tab the person browsed in.
 *
 * Only ever acts on a blank target, so it cannot disturb a live page: this runs
 * on every panel mount, and most of those find a browser that was never reaped
 * and is sitting on the page the user left.
 */
export function restoreLastPage({
  fallbackUrl,
  targetId,
  taskId,
}: {
  /** Where the tab goes. */
  fallbackUrl?: string;
  targetId: BrowserTargetId;
  taskId: TaskId;
}) {
  return new ResultAsync(
    (async (): Promise<Result<undefined, Error>> => {
      if (!fallbackUrl || fallbackUrl === BLANK_PAGE_URL) {
        return ok(undefined);
      }
      // The browser calls throw rather than returning a Result, so an
      // unreachable guest would otherwise take the whole open with it.
      try {
        const { browser } = getWorkspaceConfig();
        const targets = await browser.listTargets(taskId);
        const target = targets.find(({ id }) => id === targetId);
        if (!target || target.url !== BLANK_PAGE_URL) {
          return ok(undefined);
        }
        browser.noteRestore?.(targetId, fallbackUrl);
        await browser.sendCommand(targetId, "Page.navigate", {
          url: fallbackUrl,
        });
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
      }
      return ok(undefined);
    })(),
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
