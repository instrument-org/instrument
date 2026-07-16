import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import fs from "node:fs/promises";
import { noop } from "radashi";
import { z } from "zod";

import { TASK_STATE_FILE_NAME } from "../constants";
import { FolderAttachment } from "../schemas/folder-attachment";
import { type AbsolutePath, type TaskDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { getTaskPrivateDir } from "./task-dir-utils";

const StoredTaskStateSchema = z
  .object({
    attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
    // Connector slugs whose guide.md the agent has already been shown in this
    // task. The connector_request tool returns the guide (instead of calling
    // the API) until the slug appears here.
    connectorGuidesRead: z.array(z.string()).optional(),
    promptDraft: z.string().optional(),
    selectedModelURI: z.string().optional(),
    showTutorial: z.boolean().optional(),
  })
  .default(() => ({}));

export const TaskStateSchema = z.object({
  attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
  connectorGuidesRead: z.array(z.string()).optional(),
  promptDraft: z.string().optional(),
  selectedModelURI: AIGatewayModelURI.Schema.optional(),
  showTutorial: z.boolean().optional(),
});

export type TaskState = z.output<typeof StoredTaskStateSchema>;

const pendingUpdates = new Map<AbsolutePath, Promise<void>>();

export async function getTaskState(dir: TaskDir): Promise<TaskState> {
  const stateFilePath = getTaskStateFilePath(dir);

  try {
    const content = await fs.readFile(stateFilePath, "utf8");
    const rawState = JSON.parse(content) as unknown;
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
  await updateTaskState(dir, (currentState) => ({
    ...currentState,
    ...state,
  }));
}

export async function updateTaskState(
  dir: TaskDir,
  update: (currentState: TaskState) => TaskState,
): Promise<void> {
  const stateFilePath = getTaskStateFilePath(dir);
  const previous = pendingUpdates.get(stateFilePath) ?? Promise.resolve();
  const pending = previous.catch(noop).then(async () => {
    await fs.mkdir(getTaskPrivateDir(dir), { recursive: true });
    const currentState = await getTaskState(dir);
    const newState = StoredTaskStateSchema.parse(update(currentState));
    await fs.writeFile(
      stateFilePath,
      JSON.stringify(newState, null, 2),
      "utf8",
    );
  });
  pendingUpdates.set(stateFilePath, pending);
  try {
    await pending;
  } finally {
    if (pendingUpdates.get(stateFilePath) === pending) {
      pendingUpdates.delete(stateFilePath);
    }
  }
}

function getTaskStateFilePath(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(getTaskPrivateDir(dir), TASK_STATE_FILE_NAME);
}
