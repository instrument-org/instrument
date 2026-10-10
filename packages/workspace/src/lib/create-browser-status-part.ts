import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { decodeBrowserTargetId } from "../types";
import { BLANK_PAGE_URL } from "./browser-state";
import { agentSpellingOfFileUrls } from "./local-page-address";
import { WINDOW_ID } from "../schemas/window-id";
import { taskFsLayout } from "./resolve-workspace-file-path";
import { heldTabs } from "./held-tabs";
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
    const held = await heldTabsStatus({ sessionId, taskId }, spell);
    return held !== null && held.length > 0
      ? createPart({
          createdAt,
          data: { status: "tabs", tabs: held },
          messageId,
          sessionId,
        })
      : undefined;
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
  { sessionId, taskId }: { sessionId: StoreId.Session; taskId: TaskId },
  spell: (url: string) => string,
): Promise<
  | null
  | { id: string; openedBy: "handed" | "task"; title?: string; url: string }[]
> {
  const { browser } = getWorkspaceConfig();
  const held = await heldTabs(taskId, sessionId);
  if (held.length === 0 || browser.hasNoWindow) {
    return null;
  }
  const windowTargets = await browser.listTargets(WINDOW_ID);
  const titles = new Map(
    windowTargets.map((target) => [target.id, target.title]),
  );
  return held.flatMap((tab) => {
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
