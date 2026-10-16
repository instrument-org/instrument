import { SKILLS_FOLDER_NAME } from "../constants";
import { type FolderMoved, moveOutOfDataDir } from "./move-out-of-data-dir";
import { workspaceLayout } from "./workspace-layout";

export type SkillsMoved = FolderMoved;

/**
 * Brings the workspace's own skills out of its hidden `.instrument/` to
 * `Skills/` at the top level; see {@link moveOutOfDataDir} for the rules
 * every one of these moves keeps.
 *
 * Worth knowing about this one in particular: the agent writes here as part
 * of its work, since a chat may leave a skill behind for the chats after
 * it. So the folder it writes into changes under it at the launch this
 * runs, which is why the move happens before anything opens a chat.
 */
export function moveSkillsToFolder(rootDir: string): Promise<SkillsMoved> {
  return moveOutOfDataDir({
    from: workspaceLayout(rootDir).skillsDir,
    name: SKILLS_FOLDER_NAME,
    rootDir,
  });
}
