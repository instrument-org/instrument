import { err, ok, safeTry } from "neverthrow";
import { z } from "zod";

import { publisher } from "../rpc/publisher";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { TaskPane } from "../schemas/task-pane";
import { type BrowserTargetId } from "../types";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";
import { taskDir } from "./task-dir-utils";
import { updateTaskPane } from "./task-record";
import { getWorkspaceConfig } from "./workspace-config";
import { type WrappedStorage } from "./wrap-storage";

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
});

type BrowserState = z.output<typeof BrowserStateSchema>;

const RevealedThisTurnSchema = z.boolean();

/**
 * Let the next page this session reaches take the pane again.
 *
 * Called as a user message is composed, which is what scopes a reveal to one
 * per turn. A turn is the unit because it is the unit of the user's attention:
 * they asked for something, so the first page it produces is theirs to see, and
 * where they go afterwards is their own. An agent reading twenty pages over
 * several minutes would otherwise drag the pane back twenty times, past
 * whatever the user deliberately turned to instead.
 */
export function allowBrowserReveal({
  sessionId,
  signal,
  taskId,
}: {
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  taskId: TaskId;
}) {
  return safeTry(async function* () {
    const storage = yield* getSessionsStoreStorage(taskId);
    yield* setParsedStorageItem(
      StorageKey.browserRevealedThisTurn(sessionId),
      false,
      RevealedThisTurnSchema,
      storage,
      { signal },
    );
    return ok(undefined);
  });
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
    const state: BrowserState = {
      ...current,
      ...(nextUrl ? { lastTitle: title, lastUrl: nextUrl } : {}),
      lastUsedAt: new Date(),
    };
    yield* setParsedStorageItem(
      StorageKey.browserState(sessionId),
      state,
      BrowserStateSchema,
      storage,
      { signal },
    );

    // A page the browser did not have before is a page nobody has seen, so the
    // pane goes to it. Naming a URL is what separates arriving somewhere from
    // the rest of the traffic through here: a target opened for a command that
    // only reads state carries none, and a command that read the page it was
    // already on carries the one already recorded.
    if (nextUrl !== undefined && nextUrl !== current?.lastUrl) {
      await revealBrowserTab({ sessionId, signal, storage, taskId });
    }
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

/**
 * Put the pane on the browser, because the page under it just changed.
 *
 * Two commands steer this browser and only one of them used to move the pane.
 * `show <url>` focused the tab; `agent-browser open`, which is the route every
 * recipe in the browsing skill takes, navigated behind whatever the user was
 * already looking at. So the page arrived off screen, and the more discoverable
 * command was the one that left the user staring at an unchanged panel. Reveal
 * lives here instead, on the recorder both of them reach, because an affordance
 * competes with whatever else accomplishes the same task rather than with
 * nothing.
 *
 * Selection, never insertion: the browser is a tab the pane always draws, so
 * this closes nothing, discards no file the user opened, and leaves every one
 * of them a click away in the strip.
 *
 * At most once per turn, latched rather than compared against what the pane
 * currently shows: a user who clicks back to a file mid-turn has said where
 * they want to be, and the pane cannot tell that apart from never having moved.
 */
async function revealBrowserTab({
  sessionId,
  signal,
  storage,
  taskId,
}: {
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  storage: WrappedStorage;
  taskId: TaskId;
}) {
  try {
    const key = StorageKey.browserRevealedThisTurn(sessionId);
    const revealed = await getParsedStorageItem(
      key,
      RevealedThisTurnSchema,
      storage,
      { signal },
    );
    // An error here reads as "nothing recorded yet" as often as it is a real
    // failure, and a turn that has not been composed yet has taken the pane
    // exactly zero times, so both mean the same thing: go ahead.
    if (revealed.isOk() && revealed.value) {
      return;
    }

    await updateTaskPane(taskDir(taskId), (pane) =>
      TaskPane.selectTab(pane, TaskPane.tabKey({ type: "browser" })),
    );
    publisher.publish("task.stateUpdated", { id: taskId });

    // After the move, so a failed one is retried by the next page rather than
    // spending the turn's single reveal on a pane that never went anywhere.
    await setParsedStorageItem(key, true, RevealedThisTurnSchema, storage, {
      signal,
    });
  } catch (error) {
    // The state above is written and correct. A pane that did not move is worth
    // less than an error telling the caller the recording failed.
    getWorkspaceConfig().captureException(error);
  }
}
