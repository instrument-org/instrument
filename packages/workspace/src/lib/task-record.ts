import { TASK_SETTINGS_FILE_NAME } from "@instrument-org/shared";
import fs from "node:fs/promises";

import { type AbsolutePath, type TaskDir } from "../schemas/paths";
import {
  type TaskSettings,
  TaskSettingsSchema,
} from "../schemas/task-settings";
import {
  migrateTaskState,
  StoredTaskStateSchema,
  type TaskState,
} from "../schemas/task-state";
import { absolutePathJoin } from "./absolute-path-join";
import { createWriteQueue } from "./create-write-queue";
import { getTaskPrivateDir } from "./task-dir-utils";

const enqueue = createWriteQueue();

/**
 * The one file a task keeps beside its conversation, and the only writer of it.
 *
 * It holds two kinds of thing and the difference is worth knowing, because it
 * is the reason `state` is a nested key rather than more fields:
 *
 * - Everything at the top level is what the app asks *about* a task -- title,
 *   pin, unread, project, timestamps. The task list reads it for every task in
 *   the workspace, and a future cross-task index projects exactly these and is
 *   rebuilt from them.
 * - `state` is where the user left off *inside* one task -- draft, open tabs,
 *   chosen model, attached folders. Read when a task is open, never queried
 *   across tasks, and nothing will ever index it.
 *
 * Two views over one file rather than two files: see the finding on the task
 * list following file timestamps for why they were split and why that reason
 * did not survive.
 *
 * The two views publish differently and the asymmetry is deliberate.
 * `updateTaskSettings` publishes `task.updated` itself, waking the whole list;
 * the state writers leave `task.stateUpdated` to their callers. That looks
 * sloppy and is not, because it makes the dangerous direction unreachable: no
 * state write can wake the task list, so a draft or a tab cannot reorder the
 * sidebar the way a file mtime once did. The opposite mistake, forgetting to
 * publish after a state write, costs a panel that does not refresh until
 * something else does.
 */
export interface TaskRecord {
  /**
   * The object as it was on disk.
   *
   * Writes are built on top of this rather than on the parsed views, so a field
   * this build cannot read is carried forward instead of being dropped by the
   * write that happened to come next.
   */
  raw: Record<string, unknown>;
  /** Undefined when the file is missing or its settings cannot be read. */
  settings: TaskSettings | undefined;
  state: TaskState;
}

/**
 * Reads both views, each tolerant of the other failing.
 *
 * They are parsed separately on purpose. A pane written by a newer build, or a
 * draft holding something the schema rejects, must not cost the task its title
 * and its place in the list -- and a title that cannot be read must not cost the
 * attached folders that decide what the agent can reach.
 */
export async function readTaskRecord(dir: TaskDir): Promise<TaskRecord> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(await fs.readFile(recordPath(dir), "utf8"));
  } catch {
    // Missing, unreadable, or not JSON at all. An empty record is the same
    // answer a task with no file gets, and nothing here writes on a read.
    return emptyRecord();
  }

  return recordFrom(parsed);
}

/**
 * A record with `changes` applied to its state half, ready to be written.
 *
 * The raw state is spread *under* the parsed one, which is the whole point of
 * this existing: `StoredTaskStateSchema` is a plain object schema and strips
 * keys it does not know, so writing the parsed view back would quietly delete a
 * field a newer build had written. The top level is protected by spreading
 * `raw`, and this is the same protection one level down -- which is where it
 * matters more, since the top level is a closed set and `state` is the half
 * that keeps growing.
 *
 * The parsed view still wins over raw, so a value `migrateTaskState` rewrote is
 * not overwritten by the old shape sitting beneath it.
 */
export function recordWithState(
  record: TaskRecord,
  changes: Partial<TaskState>,
): Record<string, unknown> {
  return {
    ...record.raw,
    state: {
      ...(isRecord(record.raw.state) ? record.raw.state : {}),
      ...record.state,
      ...changes,
    },
  };
}

/**
 * Applies a change to the whole file, reading it inside the write queue.
 *
 * The callback receives what is currently on disk and returns what should
 * replace it, so a read-modify-write cannot interleave with another: two tab
 * opens, or a generated title landing on a message send, would otherwise each
 * build on the record the other had not written yet.
 */
export async function updateTaskRecord(
  dir: TaskDir,
  update: (record: TaskRecord) => Record<string, unknown>,
): Promise<TaskRecord> {
  return enqueue(dir, async () => {
    const next = update(await readTaskRecord(dir));
    await writeTaskRecord(dir, next);
    return recordFrom(next);
  });
}

function emptyRecord(): TaskRecord {
  return {
    raw: {},
    settings: undefined,
    state: StoredTaskStateSchema.parse({}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordFrom(parsed: unknown): TaskRecord {
  if (!isRecord(parsed)) {
    return emptyRecord();
  }

  const settings = TaskSettingsSchema.safeParse(parsed);
  const state = StoredTaskStateSchema.safeParse(migrateTaskState(parsed.state));

  return {
    raw: parsed,
    settings: settings.success ? settings.data : undefined,
    state: state.success ? state.data : StoredTaskStateSchema.parse({}),
  };
}

function recordPath(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(getTaskPrivateDir(dir), TASK_SETTINGS_FILE_NAME);
}

/**
 * Writes through a temporary file and renames it into place.
 *
 * One file now carries the title, the sort key and the draft, and the draft is
 * rewritten as the user types. Writing over the live file leaves a window where
 * a crash truncates it, and a truncated file does not read as damaged: the
 * parse fails, the task answers as though it has no settings, and it loses its
 * name and its position in the list. Rename is atomic within a directory, so a
 * reader sees the old file or the new one.
 */
async function writeTaskRecord(
  dir: TaskDir,
  record: Record<string, unknown>,
): Promise<void> {
  const target = recordPath(dir);
  // Named per process so two app instances sharing a workspace cannot write
  // each other's temporary file. That is all it buys: the writes are still
  // unordered across instances and the last rename wins. Within one process the
  // queue orders them.
  const temporary = `${target}.${process.pid}.tmp`;

  await fs.mkdir(getTaskPrivateDir(dir), { recursive: true });

  try {
    await fs.writeFile(temporary, JSON.stringify(record, null, 2), "utf8");
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}
