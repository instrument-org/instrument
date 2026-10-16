import path from "node:path";

import { SKILLS_FOLDER_NAME } from "../constants";
import { AbsolutePathSchema } from "../schemas/paths";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The workspace's own writable skills directory, at the top level of the
 * folder the person picked, so they can read a skill, change one, or drop
 * one in from a file manager.
 *
 * Builds before this kept it in the workspace's hidden `.instrument/`;
 * `moveSkillsToFolder` brings it out once, at launch.
 */
export function getWorkspaceSkillsDir() {
  return AbsolutePathSchema.parse(
    path.join(getWorkspaceConfig().rootDir, SKILLS_FOLDER_NAME),
  );
}
