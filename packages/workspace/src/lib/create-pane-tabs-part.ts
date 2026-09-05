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

/**
 * What the session was last told about the pane, reduced to what the note it
 * was told through depends on.
 *
 * Which tabs, not their order: the agent is being told what it need not open,
 * and dragging a tab does not change that. Which tab is in front only while
 * the pane is open, since a closed pane shows none of them.
 */
const ReportedSchema = z.object({
  front: z.string().optional(),
  open: z.boolean(),
  tabs: z.array(z.string()),
});

type Reported = z.output<typeof ReportedSchema>;

// What a session that has been told nothing pictures: a pane nobody has
// opened, holding nothing. Telling such a session exactly that is not news.
const UNTOLD: Reported = { open: false, tabs: [] };

/**
 * What the pane is showing, for the turn about to run: whether it is open,
 * which tab is in front, and which file tabs it holds.
 *
 * The restraint on an over-eager `show`: an agent that can see a file is
 * already on screen has no reason to open it again. And the correction for the
 * opposite mistake: an agent that can see the user closed the pane, or turned
 * to another tab, does not describe a file as though it were in front of them.
 *
 * Attached only when the answer has changed since the last time this session
 * was told, the way the browser status part is. Repeating an unchanged answer
 * every turn spends context restating something the agent was told and has no
 * reason to doubt, and reads in the transcript as though something happened.
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
    const state = await getTaskState(taskDir(taskId));
    const pane = state.pane ?? TaskPane.EMPTY;
    const current = reportOf(pane);

    const storage = await getSessionsStoreStorage(taskId);
    if (storage.isErr()) {
      return undefined;
    }

    const reported = await getParsedStorageItem(
      StorageKey.paneTabsReported(sessionId),
      ReportedSchema,
      storage.value,
    );
    // An error here is "nothing recorded yet" as often as it is a real
    // failure, and both mean the same thing: this session has been told
    // nothing, so tell it whatever differs from the pane it would assume.
    const previous = reported.isOk() ? reported.value : UNTOLD;

    if (sameReport(previous, current)) {
      return undefined;
    }

    await setParsedStorageItem(
      StorageKey.paneTabsReported(sessionId),
      current,
      ReportedSchema,
      storage.value,
    );

    // A pane back to closed and empty is said as plainly as any other state.
    // The part the session was told before is still in its history and still
    // being injected, so staying quiet leaves the agent believing a file is on
    // screen for the rest of the session.
    return {
      data: { open: pane.open, selected: pane.selected, tabs: pane.tabs },
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

function reportOf(pane: TaskPane.Type): Reported {
  return {
    front: pane.open ? TaskPane.tabKey(TaskPane.frontTab(pane)) : undefined,
    open: pane.open,
    tabs: pane.tabs.map((tab) => TaskPane.tabKey(tab)).sort(),
  };
}

function sameReport(a: Reported, b: Reported): boolean {
  return (
    a.open === b.open &&
    a.front === b.front &&
    a.tabs.length === b.tabs.length &&
    a.tabs.every((key, index) => key === b.tabs[index])
  );
}
