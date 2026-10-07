import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { decodeBrowserTargetId, encodeBrowserTargetId } from "../types";
import {
  BLANK_PAGE_URL,
  getBrowserState,
  takeBrowserClosed,
} from "./browser-state";
import { agentSpellingOfFileUrls } from "./local-page-address";
import { WINDOW_ID } from "../schemas/window-id";
import { taskFsLayout } from "./resolve-workspace-file-path";
import { taskDir } from "./task-dir-utils";
import { getTaskState } from "./task-record";
import { getWorkspaceConfig } from "./workspace-config";

export async function createBrowserStatusPart({
  createdAt,
  messageId,
  sessionId,
  taskId,
}: {
  createdAt: Date;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  taskId: TaskId;
}): Promise<SessionMessagePart.Type | undefined> {
  try {
    // The model hears a page on this computer by its own path for it, never
    // by where the file sits on the person's disk.
    const layout = await taskFsLayout(taskId);
    const spell = (url: string) => agentSpellingOfFileUrls(url, layout);
    const held = await heldTabsStatus(taskId, spell);
    if (held !== null) {
      return held.length > 0
        ? createPart({
            createdAt,
            data: { status: "tabs", tabs: held },
            messageId,
            sessionId,
          })
        : undefined;
    }
    const targets = await getWorkspaceConfig().browser.listTargets(taskId);
    const target = targets.find(
      ({ id }) => id === encodeBrowserTargetId(taskId, sessionId),
    );

    // A teardown since the model last looked outranks whatever is there now.
    // Reopening the panel builds a new tab, so by the time this runs the reap
    // is invisible from the target list -- either nothing is there or a blank
    // (or freshly restored) tab is, and none of those say on their own that the
    // page the model was working in has been thrown away.
    const closedResult = await takeBrowserClosed(taskId, sessionId);
    if (closedResult.isErr()) {
      getWorkspaceConfig().captureException(closedResult.error);
    }
    const closed = closedResult.isOk() ? closedResult.value : undefined;
    if (closed?.lastUrl) {
      const previousTarget = {
        ...(closed.lastTitle ? { title: closed.lastTitle } : {}),
        url: spell(closed.lastUrl),
      };
      return createPart({
        createdAt,
        data:
          target && target.url === closed.lastUrl
            ? { status: "reopened", target: previousTarget }
            : { previousTarget, status: "closed" },
        messageId,
        sessionId,
      });
    }

    if (target) {
      // Telling the model "a browser tab is already open" about a blank one
      // invites it to keep addressing a browser that has nothing in it.
      if (target.url === BLANK_PAGE_URL) {
        return undefined;
      }

      const browserStateResult = await getBrowserState(taskId, sessionId);
      if (browserStateResult.isErr()) {
        getWorkspaceConfig().captureException(browserStateResult.error);
        return undefined;
      }

      const browserState = browserStateResult.value;
      if (
        browserState?.lastUrl === target.url &&
        browserState.lastTitle === target.title
      ) {
        return undefined;
      }

      return createPart({
        createdAt,
        data: {
          status: "open",
          target: { title: target.title, url: spell(target.url) },
        },
        messageId,
        sessionId,
      });
    }

    const browserStateResult = await getBrowserState(taskId, sessionId);
    if (browserStateResult.isErr()) {
      getWorkspaceConfig().captureException(browserStateResult.error);
      return undefined;
    }

    const browserState = browserStateResult.value;
    const lastUrl =
      browserState?.lastUrl === BLANK_PAGE_URL
        ? undefined
        : browserState?.lastUrl;
    // No page to name means the browser closed without ever holding one, so
    // there is nothing for the model to restore and no reason to raise it.
    if (!lastUrl) {
      return undefined;
    }

    return createPart({
      createdAt,
      data: {
        previousTarget: {
          ...(browserState?.lastTitle ? { title: browserState.lastTitle } : {}),
          url: spell(lastUrl),
        },
        status: "closed",
      },
      messageId,
      sessionId,
    });
  } catch (error) {
    getWorkspaceConfig().captureException(error);
    return undefined;
  }
}

function createPart({
  createdAt,
  data,
  messageId,
  sessionId,
}: {
  createdAt: Date;
  data: Extract<
    SessionMessagePart.Type,
    { type: "data-browserStatus" }
  >["data"];
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}): SessionMessagePart.Type {
  return {
    data,
    metadata: {
      createdAt,
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    },
    type: "data-browserStatus",
  };
}

/**
 * The tabs of its chat a task holds, open ones only, as the task names them;
 * null for a task that holds none yet. Where
 * there is no window (the eval harness) a task browses in a browser of its
 * own whatever it holds, so there is nothing true to tell it.
 */
async function heldTabsStatus(
  taskId: TaskId,
  spell: (url: string) => string,
): Promise<
  | null
  | { id: string; openedBy: "handed" | "task"; title?: string; url: string }[]
> {
  const { browser } = getWorkspaceConfig();
  const state = await getTaskState(taskDir(taskId));
  const heldTabs = state.browserTabs ?? [];
  if (heldTabs.length === 0 || browser.hasNoWindow) {
    return null;
  }
  const windowTargets = await browser.listTargets(WINDOW_ID);
  const titles = new Map(
    windowTargets.map((target) => [target.id, target.title]),
  );
  return heldTabs.flatMap((tab) => {
    const decoded = decodeBrowserTargetId(tab.id);
    const url = browser.getTargetUrl(tab.id);
    if (!decoded || !browser.getTargetMeta(tab.id)) {
      return [];
    }
    const title = titles.get(tab.id);
    return [
      {
        id: decoded.sessionId,
        openedBy: tab.openedBy,
        ...(title ? { title } : {}),
        url: spell(url ?? BLANK_PAGE_URL),
      },
    ];
  });
}
