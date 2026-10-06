import { type TaskDir } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { chatDir } from "./record-folders";
import { taskDir } from "./task-dir-utils";
import { readWorkdirSync } from "./task-record";

/** Each record folder's working folder, once its record has said. */
const known = new Map<TaskDir, TaskDir>();

/**
 * The folder a task works in: what its agent sees at `/task`, where its
 * shell, scripts and file tools run, and where its uploads, spills and
 * downloads land. That is the task's own folder (`taskDir`), except for a
 * fork, whose settings name the chat it works beside (`workdir`): it works in
 * that chat's folder, so a path the inherited conversation names is the same
 * file for both. What belongs to the record rather than the work (its
 * session, settings and state) stays in `taskDir` either way.
 *
 * Synchronous, like `taskDir`, for the path resolution that cannot wait; a
 * task's working folder never changes once its record exists, so the answer
 * is read from disk once per folder.
 */
export function workDir(id: TaskId): TaskDir {
  const own = taskDir(id);
  const cached = known.get(own);
  if (cached) {
    return cached;
  }
  const read = readWorkdirSync(own);
  if (!read.read) {
    return own;
  }
  const dir = read.workdir ? chatDir(read.workdir) : own;
  known.set(own, dir);
  return dir;
}
