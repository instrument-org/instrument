import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import fs from "node:fs/promises";
import { z } from "zod";

import { TASK_STATE_FILE_NAME } from "../constants";
import { FolderAttachment } from "../schemas/folder-attachment";
import { type AbsolutePath, type TaskDir } from "../schemas/paths";
import { TaskPane } from "../schemas/task-pane";
import { absolutePathJoin } from "./absolute-path-join";
import { getTaskPrivateDir } from "./task-dir-utils";

// `projectFolderName` names the folder under `projects/` belonging to the
// project this task is in, kept here beside the attached folders because every
// caller that builds the filesystem layout already reads this state and needs
// both. Denormalized rather than resolved from the project id per call, because
// the file tools build a layout on every read and write and every asset request,
// synchronously, while resolving an id means reading every project's settings to
// find the match.
//
// The folder name and not its absolute path, so that nothing here is true only
// of the machine that wrote it: this file ships inside an exported task, and a
// host path from someone else's disk names nothing on the machine that imports
// it. `syncTaskProjectRoot` owns keeping it current; nothing else should write
// it.
const StoredTaskStateSchema = z
  .object({
    attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
    // A pane this build cannot read costs the pane, not the folder list beside
    // it, which the silent catch below would otherwise write away.
    // eslint-disable-next-line unicorn/prefer-top-level-await -- zod's catch, not a promise's
    pane: TaskPane.Schema.optional().catch(undefined),
    projectFolderName: z.string().optional(),
    promptDraft: z.string().optional(),
    selectedModelURI: z.string().optional(),
    showTutorial: z.boolean().optional(),
  })
  .default(() => ({}));

// The RPC-facing shape. Deliberately without `projectFolderName`: the renderer
// has no use for it, and it selects the directory of a writable agent mount, so
// it is not something a client should be able to set.
export const TaskStateSchema = z.object({
  attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
  pane: TaskPane.Schema.optional(),
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

// Read-modify-write, so two writes that overlap would each merge onto the state
// the other had not yet written and the later one would win outright. Rare while
// the writers were a debounced draft and a model change; the pane adds tab
// writes from the renderer and from `show`, which do overlap. Serializing per
// task is enough: the file belongs to one task and nothing writes across two.
const writeQueues = new Map<TaskDir, Promise<unknown>>();

export async function setTaskState(
  dir: TaskDir,
  state: Partial<TaskState>,
): Promise<void> {
  await enqueue(dir, () => writeTaskState(dir, state));
}

/**
 * Apply a change to the pane, reading the current one inside the write queue.
 *
 * The tab actions are read-modify-write on top of a read-modify-write, and the
 * whole point of serializing is lost if the read happens before the queue: two
 * `show` calls in one command line would each append to the tabs they saw and
 * the second would drop the first's.
 */
export async function updateTaskPane(
  dir: TaskDir,
  update: (pane: TaskPane.Type) => TaskPane.Type,
): Promise<TaskPane.Type> {
  return enqueue(dir, async () => {
    const current = await getTaskState(dir);
    const pane = update(current.pane ?? TaskPane.EMPTY);
    await writeTaskState(dir, { pane });
    return pane;
  });
}

function enqueue<T>(dir: TaskDir, work: () => Promise<T>): Promise<T> {
  // Both arms run the work: a failed write ahead of this one is that caller's
  // to report, and dropping every write behind it would be worse.
  const queued = (writeQueues.get(dir) ?? Promise.resolve()).then(work, work);

  writeQueues.set(dir, queued);

  return queued.finally(() => {
    if (writeQueues.get(dir) === queued) {
      writeQueues.delete(dir);
    }
  });
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

async function writeTaskState(
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
