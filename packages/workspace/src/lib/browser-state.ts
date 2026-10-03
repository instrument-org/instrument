import { err, ok, safeTry } from "neverthrow";
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
  // Set when the lifecycle machine reaped this session's browser, cleared once
  // a user message has carried the fact to the model. A reap is invisible from
  // anything the model can observe -- the tab it was driving is simply not the
  // one it left -- so the fact has to be recorded where the next turn can find
  // it rather than inferred from whatever target happens to exist by then.
  closedAt: z.date().optional(),
  lastTitle: z.string().optional(),
  lastUrl: z.string().optional(),
  lastUsedAt: z.date(),
  /**
   * The hosts this session's browser has been on, oldest first, each once,
   * the newest visit moving its host to the end. What a chat shows as the
   * sites its work used: the pages themselves are too many to keep and too
   * many to draw, and a host is the mark a person recognizes.
   */
  visitedHosts: z.array(z.string()).optional(),
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

/** Note that this session's browser was torn down, for the next turn to report. */
export function recordBrowserClosed({
  sessionId,
  taskId,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
}) {
  return safeTry(async function* () {
    const storage = yield* getSessionsStoreStorage(taskId);
    const current = yield* getBrowserState(taskId, sessionId);
    // Nothing was ever loaded here, so there is nothing the model needs to hear
    // about and nothing for a reopened tab to restore.
    if (!current?.lastUrl) {
      return ok(undefined);
    }
    yield* setParsedStorageItem(
      StorageKey.browserState(sessionId),
      { ...current, closedAt: new Date() },
      BrowserStateSchema,
      storage,
    );
    return ok(undefined);
  });
}

export function recordBrowserUse({
  sessionId,
  signal,
  taskId,
  title,
  url,
}: {
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  taskId: TaskId;
  title?: string;
  url?: string;
}) {
  return safeTry(async function* () {
    const storage = yield* getSessionsStoreStorage(taskId);
    const current = yield* getBrowserState(taskId, sessionId, { signal });
    // A blank page is not a page anyone was on, so it never becomes the page a
    // reopened tab restores or the one a teardown notice names. Recording it
    // would also erase the real page still sitting in `lastUrl`, which is the
    // one worth keeping: every command that opens a target for a task that
    // needs no page at all passes through here.
    const nextUrl = url === BLANK_PAGE_URL ? undefined : url;
    // A page the browser did not have before, which decides what becomes of
    // the title.
    const isNewPage = nextUrl !== undefined && nextUrl !== current?.lastUrl;
    const state: BrowserState = {
      ...current,
      ...(nextUrl
        ? {
            // A title belongs to the page it was read from: arriving somewhere
            // new drops the one the last page had, and naming the page already
            // recorded keeps it. Only some of the traffic through here carries a
            // title at all -- `show <url>` carries none -- so a command that
            // reveals the page the session is already on would otherwise throw
            // that page's own title away.
            lastTitle: isNewPage ? title : (title ?? current?.lastTitle),
            lastUrl: nextUrl,
          }
        : {}),
      lastUsedAt: new Date(),
      ...(isNewPage
        ? { visitedHosts: withVisit(current?.visitedHosts, nextUrl) }
        : {}),
    };
    yield* setParsedStorageItem(
      StorageKey.browserState(sessionId),
      state,
      BrowserStateSchema,
      storage,
      { signal },
    );

    return ok(undefined);
  });
}

/**
 * Add the hosts of pages a session's work is on to what it has visited,
 * without the rest of {@link recordBrowserUse}: a chat's task works in tabs
 * of the chat, opened behind whatever the user has up, so the page it lands
 * on is not this session's to record.
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
 * Put a freshly opened tab back on the page its session was last on.
 *
 * Only ever acts on a blank target, so it cannot disturb a live page: this runs
 * on every panel mount, and most of those find a browser that was never reaped
 * and is sitting on the page the user left. The alternative is that coming back
 * to a task whose browser aged out shows a blank tab and loses the page without
 * ever saying so.
 */
export function restoreLastPage({
  sessionId,
  targetId,
  taskId,
}: {
  sessionId: StoreId.Session;
  targetId: BrowserTargetId;
  taskId: TaskId;
}) {
  return safeTry(async function* () {
    const current = yield* getBrowserState(taskId, sessionId);
    if (!current?.lastUrl || current.lastUrl === BLANK_PAGE_URL) {
      return ok(undefined);
    }

    // The browser calls throw rather than returning a Result, and safeTry only
    // catches what it is yielded, so an unreachable guest would otherwise take
    // the whole open with it.
    try {
      const { browser } = getWorkspaceConfig();
      const targets = await browser.listTargets(taskId);
      const target = targets.find(({ id }) => id === targetId);
      if (!target || target.url !== BLANK_PAGE_URL) {
        return ok(undefined);
      }
      await browser.sendCommand(targetId, "Page.navigate", {
        url: current.lastUrl,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
    return ok(undefined);
  });
}

/**
 * Consume the pending teardown notice, if there is one.
 *
 * Reporting clears it, so a reap is announced to the model exactly once rather
 * than heading every message until the browser happens to be used again.
 */
export function takeBrowserClosed(
  taskId: TaskId,
  sessionId: StoreId.Session,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry<BrowserState | undefined, Error>(async function* () {
    const storage = yield* getSessionsStoreStorage(taskId);
    const current = yield* getBrowserState(taskId, sessionId, { signal });
    if (!current?.closedAt) {
      return ok(undefined);
    }
    const { closedAt: _closedAt, ...cleared } = current;
    yield* setParsedStorageItem(
      StorageKey.browserState(sessionId),
      cleared,
      BrowserStateSchema,
      storage,
      { signal },
    );
    return ok(current);
  });
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
