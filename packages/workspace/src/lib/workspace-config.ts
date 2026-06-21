import { type WorkspaceConfig } from "../types";

// The workspace runs a single WorkspaceConfig per process (constructed once when
// the workspace machine boots and living for the whole app lifetime). Rather
// than threading it through every AppConfig/function, we hold it here as a
// module singleton and read it via `getWorkspaceConfig()`. See the
// `refactor/task-rename-foundation` plan for why this is preferred over
// AsyncLocalStorage (Hono per-request middleware, spawn-runtime stdio
// listeners, and XState spawn-at-init all run outside any `als.run` scope).
let current: undefined | WorkspaceConfig;

export function getWorkspaceConfig(): WorkspaceConfig {
  if (!current) {
    throw new Error("WorkspaceConfig has not been initialized");
  }
  return current;
}

export function setWorkspaceConfig(config: WorkspaceConfig): void {
  current = config;
}
