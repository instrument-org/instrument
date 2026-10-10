import { type WorkspaceServerActorRef } from "../../logic/server";
import { type ChatId } from "../../schemas/chat-id";
import { type WorkspaceConfig } from "../../types";
import { type SessionActorRef } from "../session";
import { type TaskBrowserActorRef } from "../task-browser";

// Declared here to avoid circular dependency
export interface WorkspaceContext {
  config: WorkspaceConfig;
  error?: unknown;
  // Resolvers waiting for the taskBrowser at `id` to reach Stopped
  // before trash-task deletes the directory. Drained when the matching
  // taskBrowser.stopped event arrives (or immediately if no machine
  // existed when prepareToTrashTask ran).
  pendingBrowserReapResolvers: Map<ChatId, (() => void)[]>;
  sessionRefsByChatId: Map<ChatId, SessionActorRef[]>;
  // One taskBrowser actor per task id with browser activity or an
  // active task-page presence subscription. Spawned lazily and reaped on
  // taskBrowser.stopped.
  taskBrowserRefs: Map<ChatId, TaskBrowserActorRef>;
  tasksBeingTrashed: ChatId[];
  workspaceServerRef: WorkspaceServerActorRef;
}
