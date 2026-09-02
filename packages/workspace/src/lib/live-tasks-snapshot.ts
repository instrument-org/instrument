import { type Task } from "../schemas/task";
import { type TaskId } from "../schemas/task-id";
import { sortTasks, type TaskListOptions } from "./get-tasks";

// An id-keyed view of the workspace's tasks. The live task subscription seeds
// it from a single full scan, then replaces one task per change event instead
// of re-globbing the tasks directory and re-parsing every record file. It holds
// every task rather than the window a subscriber asked for, so a task the limit
// excluded can still move into view; `list` applies the sort and limit over the
// held set the way a full scan would.
export class LiveTasksSnapshot {
  private readonly byId = new Map<TaskId, Task>();

  constructor(tasks: Task[] = []) {
    this.reset(tasks);
  }

  list(options: TaskListOptions) {
    return sortTasks([...this.byId.values()], options);
  }

  remove(taskId: TaskId) {
    this.byId.delete(taskId);
  }

  reset(tasks: Task[]) {
    this.byId.clear();
    for (const task of tasks) {
      this.byId.set(task.id, task);
    }
  }

  upsert(task: Task) {
    this.byId.set(task.id, task);
  }
}
