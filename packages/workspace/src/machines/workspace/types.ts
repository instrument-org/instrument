import {
  type WorkspaceServerActorRef,
} from "../../logic/server";
import {
  type TaskId,
} from "../../schemas/task-id";
import {
  type WorkspaceConfig,
} from "../../types";
import {
  type ProjectBrowserActorRef,
} from "../project-browser";
import {
  type RuntimeActorRef,
} from "../runtime";
import {
  type SessionActorRef,
} from "../session";

// Declared here to avoid circular dependency
export interface WorkspaceContext {
  appsBeingTrashed: TaskId[];
  config: WorkspaceConfig;
  error?: unknown;
  // Resolvers waiting for the projectBrowser at `subdomain` to reach Stopped
  // before trash-project deletes the directory. Drained when the matching
  // projectBrowser.stopped event arrives (or immediately if no machine
  // existed when prepareToTrashApp ran).
  pendingBrowserReapResolvers: Map<TaskId, (() => void)[]>;
  // One projectBrowser actor per project subdomain with browser activity or an
  // active project-page presence subscription. Spawned lazily and reaped on
  // projectBrowser.stopped.
  projectBrowserRefs: Map<TaskId, ProjectBrowserActorRef>;
  runtimeRefs: Map<TaskId, RuntimeActorRef>;
  sessionRefsBySubdomain: Map<TaskId, SessionActorRef[]>;
  workspaceServerRef: WorkspaceServerActorRef;
}
