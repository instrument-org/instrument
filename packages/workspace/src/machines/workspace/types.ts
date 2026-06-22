import { type WorkspaceServerActorRef } from "../../logic/server";
import { type TaskId } from "../../schemas/task-id";
import { type WorkspaceConfig } from "../../types";
import { type RuntimeActorRef } from "../runtime";
import { type SessionActorRef } from "../session";
import { type TaskBrowserActorRef } from "../task-browser";

// Declared here to avoid circular dependency
export interface WorkspaceContext {
  appsBeingTrashed: TaskId[];
  config: WorkspaceConfig;
  error?: unknown;
  // Resolvers waiting for the taskBrowser at `id` to reach Stopped
  // before trash-task deletes the directory. Drained when the matching
  // taskBrowser.stopped event arrives (or immediately if no machine
  // existed when prepareToTrashApp ran).
  pendingBrowserReapResolvers: Map<TaskId, (() => void)[]>;
  runtimeRefs: Map<TaskId, RuntimeActorRef>;
  sessionRefsByTaskId: Map<TaskId, SessionActorRef[]>;
  // One taskBrowser actor per task id with browser activity or an
  // active task-page presence subscription. Spawned lazily and reaped on
  // taskBrowser.stopped.
  taskBrowserRefs: Map<TaskId, TaskBrowserActorRef>;
  workspaceServerRef: WorkspaceServerActorRef;
}
