import { TASK_SETTINGS_FILE_NAME } from "@instrument-org/shared";
import path from "node:path";

import { type AbsolutePath, type TaskDir } from "../schemas/paths";
import { TaskIdSchema } from "../schemas/task-id";
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
import { readJsonRecord, updateJsonRecord } from "./json-record-file";
import { recordChanged } from "./record-changes";
import { getTaskPrivateDir } from "./task-dir-utils";

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
 * - `state` is where the user left off *inside* one task -- open tabs,
 *   chosen model, attached folders. Read when a task is open, never queried
 *   across tasks, and nothing will ever index it.
 *
 * Two views over one file rather than two files: see the finding on the task
 * list following file timestamps for why they were split and why that reason
 * did not survive.
 *
 * Every write says which half it changed on the record change feed
 * (`settings` or `state`), so a reader of the settings is not woken by a
 * model pick or a tab, and a reader of the state hears every write to it
 * without its writer having to announce it.
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
  /**
   * The file is there and could not be read: truncated JSON, something that is
   * not an object, a permission error.
   *
   * Reads answer empty for it, the same answer a task with no file gets, since
   * a caller asking for a title has nothing better to show. Writes must not:
   * that empty answer plus whatever the caller is changing *becomes* the file,
   * so a model pick would replace a title, a pin and every open tab with one
   * field.
   */
  unreadable: boolean;
}

/**
 * Where the user left off in a task.
 *
 * Total rather than optional, unlike the settings view: an empty state means
 * nothing has been set, where an absent settings means the file could not be
 * read. Both callers depend on their half's answer to that.
 */
export async function getTaskState(dir: TaskDir): Promise<TaskState> {
  const record = await readTaskRecord(dir);
  return record.state;
}

/**
 * Reads both views, each tolerant of the other failing.
 *
 * They are parsed separately on purpose. A state written by a newer build, or a
 * field holding something the schema rejects, must not cost the task its title
 * and its place in the list -- and a title that cannot be read must not cost the
 * attached folders that decide what the agent can reach.
 */
export async function readTaskRecord(dir: TaskDir): Promise<TaskRecord> {
  const read = await readJsonRecord(recordPath(dir));
  // A task nobody has written a record for yet is the one case a write may
  // create from nothing; anything else is a file we have but cannot read.
  return read.kind === "read"
    ? recordFrom(read.record)
    : emptyRecord(read.kind === "unreadable");
}

export async function setTaskState(
  dir: TaskDir,
  state: Partial<TaskState>,
): Promise<void> {
  await updateTaskRecord(dir, "state", (record) =>
    recordWithState(record, state),
  );
}

/**
 * Changes the state half from what is on disk, read inside the write queue,
 * so two changes landing together each build on the other.
 */
export async function updateTaskState(
  dir: TaskDir,
  change: (state: TaskState) => Partial<TaskState>,
): Promise<void> {
  await updateTaskRecord(dir, "state", (record) =>
    recordWithState(record, change(record.state)),
  );
}

/**
 * Applies a change to the whole file, reading it inside the write queue.
 *
 * The callback receives what is currently on disk and returns the fields to
 * write over it (`undefined` drops one; one left out is kept), so a
 * read-modify-write cannot interleave with another: two tab opens, or a
 * generated title landing on a message send, would otherwise each build on
 * the record the other had not written yet.
 */
export async function updateTaskRecord(
  dir: TaskDir,
  /** Which half the change is to, which is what the change feed says moved. */
  half: "settings" | "state",
  update: (record: TaskRecord) => Record<string, unknown>,
): Promise<TaskRecord> {
  // An unreadable record is refused rather than built on: the write would
  // build on an empty reading of it, and going ahead costs everything the
  // file holds where failing the caller costs a model pick or a tab.
  const written = recordFrom(
    await updateJsonRecord(recordPath(dir), (raw) => update(recordFrom(raw))),
  );
  // A record's folder is named by its id.
  const id = TaskIdSchema.safeParse(path.basename(dir));
  if (id.success) {
    recordChanged(id.data, half);
  }
  return written;
}

function emptyRecord(unreadable: boolean): TaskRecord {
  return {
    raw: {},
    settings: undefined,
    state: StoredTaskStateSchema.parse({}),
    unreadable,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordFrom(parsed: unknown): TaskRecord {
  if (!isRecord(parsed)) {
    // Valid JSON holding an array, a number, `null`: a record we cannot merge
    // into, which is the same position a truncated file leaves us in.
    return emptyRecord(true);
  }

  const settings = TaskSettingsSchema.safeParse(parsed);
  const state = StoredTaskStateSchema.safeParse(migrateTaskState(parsed.state));

  return {
    raw: parsed,
    settings: settings.success ? settings.data : undefined,
    state: state.success ? state.data : StoredTaskStateSchema.parse({}),
    unreadable: false,
  };
}

function recordPath(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(getTaskPrivateDir(dir), TASK_SETTINGS_FILE_NAME);
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
 * The raw state goes through `migrateTaskState` too, so a key it renamed is
 * written under its new name only rather than kept beside it, and the parsed
 * view still wins over raw.
 */
function recordWithState(
  record: TaskRecord,
  changes: Partial<TaskState>,
): Record<string, unknown> {
  const raw = migrateTaskState(record.raw.state);
  return {
    ...record.raw,
    state: {
      ...(isRecord(raw) ? raw : {}),
      ...record.state,
      ...changes,
    },
  };
}
