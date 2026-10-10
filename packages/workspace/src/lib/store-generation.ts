import { type TaskId } from "../schemas/task-id";

/**
 * How many times each task's store has been written since this process
 * started. Every write goes through this process's storage, so a value read
 * back unchanged means nothing in that task's store has changed since: what
 * a reader derived from it then is still true.
 */
const GENERATIONS = new Map<TaskId, number>();
let epoch = 0;

/** Every task's store changed at once: a test clearing the storage it shares. */
export function bumpEveryStoreGeneration() {
  epoch += 1;
}

export function bumpStoreGeneration(id: TaskId) {
  GENERATIONS.set(id, (GENERATIONS.get(id) ?? 0) + 1);
}

/**
 * A value derived from a task's store, kept until that store is written.
 * The value is computed against the generation it started at, and kept only
 * if no write landed while it was computed and `keepWhen` accepts it.
 */
export function cacheByStoreGeneration<Value>(
  keepWhen: (value: Value) => boolean = () => true,
) {
  const entries = new Map<
    string,
    { generation: string; value: Promise<Value> }
  >();
  /** `key` tells apart values derived from one store, one per session say. */
  return (
    taskId: TaskId,
    compute: () => Promise<Value>,
    key: string = taskId,
  ): Promise<Value> => {
    const generation = storeGeneration(taskId);
    const known = entries.get(key);
    if (known?.generation === generation) {
      return known.value;
    }
    const value = compute();
    entries.set(key, { generation, value });
    const forget = () => {
      if (entries.get(key)?.value === value) {
        entries.delete(key);
      }
    };
    void value.then((settled) => {
      if (storeGeneration(taskId) !== generation || !keepWhen(settled)) {
        forget();
      }
    }, forget);
    return value;
  };
}

/** A task's store's write count, comparable only for equality. */
function storeGeneration(id: TaskId): string {
  return `${epoch}:${GENERATIONS.get(id) ?? 0}`;
}
