import { type TaskDir } from "../schemas/paths";
import { TaskPane } from "../schemas/task-pane";
import { type TaskState } from "../schemas/task-state";
import {
  readTaskRecord,
  recordWithState,
  updateTaskRecord,
} from "./task-record";

/**
 * Where the user left off in a task.
 *
 * One of the two views over the task record; the settings beside it are the
 * other. See task-record.ts for what separates them.
 */
export async function getTaskState(dir: TaskDir): Promise<TaskState> {
  const record = await readTaskRecord(dir);
  return record.state;
}

export async function setTaskState(
  dir: TaskDir,
  state: Partial<TaskState>,
): Promise<void> {
  await updateTaskRecord(dir, (record) => recordWithState(record, state));
}

/**
 * Apply a change to the pane, reading the current one inside the write queue.
 *
 * The tab actions are read-modify-write on top of a read-modify-write, and the
 * whole point of queueing is lost if the read happens before the queue: two
 * `show` calls in one command line would each append to the tabs they saw and
 * the second would drop the first's.
 */
export async function updateTaskPane(
  dir: TaskDir,
  update: (pane: TaskPane.Type) => TaskPane.Type,
): Promise<TaskPane.Type> {
  const written = await updateTaskRecord(dir, (record) =>
    recordWithState(record, {
      pane: update(record.state.pane ?? TaskPane.EMPTY),
    }),
  );

  return written.state.pane ?? TaskPane.EMPTY;
}
