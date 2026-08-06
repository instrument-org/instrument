import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import fs from "node:fs/promises";
import { z } from "zod";

import { TASK_STATE_FILE_NAME } from "../constants";
import { FolderAttachment } from "../schemas/folder-attachment";
import { type AbsolutePath, type TaskDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { getTaskPrivateDir } from "./task-dir-utils";

const StoredTaskStateSchema = z
  .object({
    attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
    promptDraft: z.string().optional(),
    selectedModelURI: z.string().optional(),
    showTutorial: z.boolean().optional(),
  })
  .default(() => ({}));

export const TaskStateSchema = z.object({
  attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
  promptDraft: z.string().optional(),
  selectedModelURI: AIGatewayModelURI.Schema.optional(),
  showTutorial: z.boolean().optional(),
});

export type TaskState = z.output<typeof StoredTaskStateSchema>;

export async function getTaskState(dir: TaskDir): Promise<TaskState> {
  const stateFilePath = getTaskStateFilePath(dir);

  try {
    const content = await fs.readFile(stateFilePath, "utf8");
    const rawState: unknown = migrateTaskState(JSON.parse(content));
    return StoredTaskStateSchema.parse(rawState);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return StoredTaskStateSchema.parse({});
    }
    return StoredTaskStateSchema.parse({});
  }
}

export async function setTaskState(
  dir: TaskDir,
  state: Partial<TaskState>,
): Promise<void> {
  const stateFilePath = getTaskStateFilePath(dir);
  const privateDir = getTaskPrivateDir(dir);

  await fs.mkdir(privateDir, { recursive: true });

  const currentState = await getTaskState(dir);

  const newState = StoredTaskStateSchema.parse({
    ...currentState,
    ...state,
  });

  await fs.writeFile(stateFilePath, JSON.stringify(newState, null, 2), "utf8");
}

function getTaskStateFilePath(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(getTaskPrivateDir(dir), TASK_STATE_FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Brings the stored shape up to what the schema below expects.
 *
 * This file is the task's other store, and it has its own door: a task's state
 * is read in places that never open its database, and a parse failure here is
 * silent -- the catch above answers with empty state, which the next write would
 * then persist over the folders it failed to read. So the migration cannot wait
 * for the database to be opened; see store-migrations.ts for that half and for
 * the rules both halves follow.
 *
 * Applied on read and saved by the next write rather than rewritten here, since
 * every caller of this either writes back or does not care.
 */
function migrateTaskState(state: unknown): unknown {
  if (!isRecord(state) || !isRecord(state.attachedFolders)) {
    return state;
  }

  // Folders were stored under `name`, which was the mount name all along.
  const folders = Object.entries(state.attachedFolders).map(
    ([key, folder]): [string, unknown] => {
      if (!isRecord(folder) || !("name" in folder) || "mountName" in folder) {
        return [key, folder];
      }
      const { name, ...rest } = folder;
      return [key, { ...rest, mountName: name }];
    },
  );

  return { ...state, attachedFolders: Object.fromEntries(folders) };
}
