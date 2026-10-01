import { workspaceSettingsDirOf } from "./settings-migration";
import { getResolvedWorkspace } from "./workspaces";

export function getWorkspaceFolder(): string {
  return getResolvedWorkspace().path;
}

/** Where the resolved workspace's electron-store files live. */
export function workspaceSettingsDir(): string {
  return workspaceSettingsDirOf(getWorkspaceFolder());
}
