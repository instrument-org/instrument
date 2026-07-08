export { closeAllAgentBrowserSessions } from "./lib/agent-browser-cleanup";
export {
  migrateWorkspaceLayout,
  type WorkspaceLayoutMigration,
} from "./lib/migrate-workspace-layout";
export { clearOrphanedProjectRefs, resolveProjectDir } from "./lib/project";
export { readTaskFile } from "./lib/read-task-file";
export { resolvePathWithinTaskDir } from "./lib/resolve-path-within-task-dir";
export { taskDir } from "./lib/task-dir-utils";
export { stopAllTaskFileWatchers } from "./lib/task-file-watcher";
export {
  type WorkspaceActorRef,
  type WorkspaceEvent,
  workspaceMachine,
} from "./machines/workspace";
export { router as workspaceRouter } from "./rpc";
export type { WorkspaceRPCContext } from "./rpc/base";
export { publisher as workspacePublisher } from "./rpc/publisher";
export {
  type AbsolutePath,
  RelativePathSchema,
  RelativeTaskPathSchema,
} from "./schemas/paths";
export { type ProjectId, ProjectIdSchema } from "./schemas/project-id";
export { SessionMessage } from "./schemas/session/message";
export { StoreId } from "./schemas/store-id";
export { type SubdomainPart } from "./schemas/subdomain-part";
export { SubdomainPartSchema } from "./schemas/subdomain-part";
export { type TaskId, TaskIdSchema } from "./schemas/task-id";
export {
  type BrowserConfig,
  type BrowserTarget,
  type BrowserTargetId,
  BrowserTargetIdSchema,
  decodeBrowserTargetId,
  encodeBrowserTargetId,
  type WorkspaceConfig,
} from "./types";
