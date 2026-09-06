import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { type TaskId } from "../../schemas/task-id";
import { attachFolder } from "../attach-folder";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";

/**
 * The user's home folder, attached read-write to the orchestrator's
 * conversation from the start: what the app can reach, the agent can reach,
 * and a task is handed the part of it the work needs. macOS asks the user
 * itself the first time a protected folder inside it is touched.
 */
export async function ensureHomeFolder(
  orchestratorTaskId: TaskId,
): Promise<string> {
  return ensureAttached(orchestratorTaskId, os.homedir());
}

export async function ensureOutputFolder(
  orchestratorTaskId: TaskId,
): Promise<string> {
  const folderPath = outputFolderPath();
  await fs.mkdir(folderPath, { recursive: true });
  return ensureAttached(orchestratorTaskId, folderPath);
}

/**
 * Where everything Instrument makes lands when nobody said where: a folder in
 * the user's Documents, created on first use and attached writable to the
 * orchestrator's conversation, so a task can be handed it like any other
 * folder and the user can find it in the Finder like any other folder.
 */
export function outputFolderPath(): string {
  return path.join(os.homedir(), "Documents", "Instrument");
}

async function ensureAttached(
  orchestratorTaskId: TaskId,
  folderPath: string,
): Promise<string> {
  const state = await getTaskState(taskDir(orchestratorTaskId));
  const attached = Object.values(state.attachedFolders ?? {}).find(
    (folder) => folder.path === folderPath,
  );
  if (attached?.access === "read-write") {
    return attached.mountName;
  }
  const folder = await attachFolder({
    access: "read-write",
    path: folderPath,
    taskId: orchestratorTaskId,
  });
  return folder.mountName;
}
