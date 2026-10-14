import { AbsolutePathSchema } from "../schemas/paths";
import { getWorkspaceConfig } from "./workspace-config";
import { workspaceLayout } from "./workspace-layout";

/** The workspace's own writable skills directory. */
export function getWorkspaceSkillsDir() {
  return AbsolutePathSchema.parse(
    workspaceLayout(getWorkspaceConfig().rootDir).skillsDir,
  );
}
