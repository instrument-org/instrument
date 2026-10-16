import { MEMORY_FOLDER_NAME } from "../../constants";
import { type FolderMoved, moveOutOfDataDir } from "../move-out-of-data-dir";
import { workspaceLayout } from "../workspace-layout";

export type MemoriesMoved = FolderMoved;

/**
 * Brings the memories an earlier build hid in the workspace's `.instrument/`
 * out to `Memory/` at its top level; see {@link moveOutOfDataDir} for the
 * rules every one of these moves keeps.
 */
export function moveMemoriesToFolder(rootDir: string): Promise<MemoriesMoved> {
  return moveOutOfDataDir({
    from: workspaceLayout(rootDir).memoryDir,
    name: MEMORY_FOLDER_NAME,
    rootDir,
  });
}
