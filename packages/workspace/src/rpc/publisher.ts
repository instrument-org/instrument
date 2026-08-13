import { EventPublisher } from "@orpc/server";

import { type WorkspaceSnapshot } from "../machines/workspace";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";

export const publisher = new EventPublisher<{
  /**
   * A background process in this task appeared, ended, or was removed. Carries
   * no detail because every listener re-reads the list, and deliberately not
   * published per chunk of output: what a viewer needs is whether the process
   * is still there, not what it just printed.
   */
  "backgroundProcesses.changed": {
    id: TaskId;
  };
  "message.removed": {
    id: TaskId;
    messageId: StoreId.Message;
    sessionId: StoreId.Session;
  };
  "message.updated": {
    id: TaskId;
    messageId: StoreId.Message;
    sessionId: StoreId.Session;
  };
  "part.updated": {
    id: TaskId;
    part: SessionMessagePart.Type;
  };
  "project.updated": null;
  "replay.changed": {
    id: TaskId;
    isActive: boolean;
    sessionId: StoreId.Session;
  };
  "runtime.log.updated": {
    id: TaskId;
  };
  "session.added": {
    id: TaskId;
    sessionId: StoreId.Session;
  };
  "session.done": {
    id: TaskId;
    parentSessionId: StoreId.Session | undefined;
    sessionId: StoreId.Session;
  };
  "session.removed": {
    id: TaskId;
    sessionId: StoreId.Session;
  };
  "session.tagsChanged": {
    id: TaskId;
    sessionId: StoreId.Session;
  };
  "session.updated": {
    id: TaskId;
    sessionId: StoreId.Session;
  };
  /**
   * The workspace skills directory changed: a skill was installed, revised, or
   * deleted. Carries no payload because every listener re-reads the list.
   */
  "skill.changed": null;
  "task.removed": {
    id: TaskId;
  };
  /**
   * A task's own state file changed: the pane, the draft, the selected model.
   *
   * Deliberately not `task.updated`, which the task list subscribes to. The
   * list is ordered by a filesystem timestamp, so every re-read is a chance for
   * a task to jump to the top on a change nobody made -- and opening a panel is
   * not activity in a task. Anything that only wants the state reads this.
   */
  "task.stateUpdated": {
    id: TaskId;
  };
  "task.updated": {
    id: TaskId;
  };
  "workspaceActor.snapshot": WorkspaceSnapshot;
}>({
  maxBufferedEvents: 1, // Holds only last event in memory
});
