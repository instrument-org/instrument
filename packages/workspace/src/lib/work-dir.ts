import { type TaskDir } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { taskDir } from "./task-dir-utils";

/**
 * The folder a record works in: what its agent sees at `/task`, where its
 * shell, scripts and file tools run, and where its uploads, spills and
 * downloads land. A chat's tasks work in it too, since they run in the
 * chat's record.
 */
export function workDir(id: TaskId): TaskDir {
  return taskDir(id);
}
