import { ok, safeTry } from "neverthrow";
import { z } from "zod";

import { publisher } from "../rpc/publisher";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { TaskPane } from "../schemas/task-pane";
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
    const state: BrowserState = {
      ...(current?.lastTitle ? { lastTitle: current.lastTitle } : {}),
      ...(current?.lastUrl ? { lastUrl: current.lastUrl } : {}),
      ...(title ? { lastTitle: title } : {}),
      ...(url ? { lastUrl: url } : {}),
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
    if (
      url !== undefined &&
      url !== BLANK_PAGE_URL &&
      url !== current?.lastUrl
    ) {
      await revealBrowserTab({ sessionId, signal, storage, taskId });
    }
    return ok(undefined);
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
