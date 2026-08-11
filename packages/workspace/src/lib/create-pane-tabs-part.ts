import { z } from "zod";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { TaskPane } from "../schemas/task-pane";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";
import { taskDir } from "./task-dir-utils";
import { getTaskState } from "./task-record";
import { getWorkspaceConfig } from "./workspace-config";

const ReportedTabsSchema = z.array(z.string());

/**
 * What the pane has open, for the turn about to run.
 *
 * The restraint on an over-eager `show`: an agent that can see a file is
 * already on screen has no reason to open it again.
 *
 * Attached only when the answer has changed since the last time this session
 * was told, the way the browser status part is. Repeating an unchanged list
 * every turn spends context restating something the agent was told and has no
 * reason to doubt, and reads in the transcript as though something happened.
 *
 * Which tabs, not their order: the agent is being told what it need not open,
 * and dragging a tab does not change that. An absent list means nothing is
 * open, and is worth reporting once for the same reason -- the last thing the
 * agent heard was that something was.
 */
export async function createPaneTabsPart({
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
    const { pane } = await getTaskState(taskDir(taskId));
    const tabs = pane?.tabs ?? [];
    const keys = tabs.map((tab) => TaskPane.tabKey(tab)).sort();

    const storage = await getSessionsStoreStorage(taskId);
    if (storage.isErr()) {
      return undefined;
    }

    const reported = await getParsedStorageItem(
      StorageKey.paneTabsReported(sessionId),
      ReportedTabsSchema,
      storage.value,
    );
    // An error here is "nothing recorded yet" as often as it is a real
    // failure, and both mean the same thing: this session has been told
    // nothing, so tell it.
    const previous = reported.isOk() ? reported.value : [];

    if (
      previous.length === keys.length &&
      keys.every((key, index) => key === previous[index])
    ) {
      return undefined;
    }

    await setParsedStorageItem(
      StorageKey.paneTabsReported(sessionId),
      keys,
      ReportedTabsSchema,
      storage.value,
    );

    // Nothing open and nothing open last time is the common case, and it
    // returned above. Reaching here with no tabs means the user closed the
    // last one, which has to be said: the part the session was told before is
    // still in its history and still being injected, so staying quiet leaves
    // the agent believing a file is on screen for the rest of the session.
    return {
      data: { tabs },
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-paneTabs",
    };
  } catch (error) {
    getWorkspaceConfig().captureException(error);
    return undefined;
  }
}
