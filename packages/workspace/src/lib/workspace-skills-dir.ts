import { REGISTRY_FOLDER_NAMES } from "../constants";
import { absolutePathJoin } from "./absolute-path-join";
import { getWorkspaceConfig } from "./workspace-config";

/** The workspace's own writable skills directory. */
export function getWorkspaceSkillsDir() {
  return absolutePathJoin(
    getWorkspaceConfig().rootDir,
    REGISTRY_FOLDER_NAMES.skills,
  );
}
