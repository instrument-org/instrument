import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { taskDir } from "../task-dir-utils";
import { getTaskState, updateTaskState } from "../task-record";

/**
 * Which thread an app was asked for in.
 *
 * A sign-in finishes in the browser and a key is saved on a card, neither of
 * which knows a thread, so the ask records where it was made and the event
 * that answers it is delivered there rather than to whichever thread is
 * newest. Recorded on each ask, so an app asked for again from another
 * thread reports into that one.
 */
export async function recordAppThread({
  orchestratorTaskId,
  sessionId,
  slug,
}: {
  orchestratorTaskId: TaskId;
  sessionId: StoreId.Session;
  slug: string;
}): Promise<void> {
  await updateTaskState(taskDir(orchestratorTaskId), (state) => ({
    appThreads: { ...state.appThreads, [slug]: sessionId },
  }));
}

/**
 * Which thread a task was filed from.
 *
 * Each thread has an orchestrator of its own, so a task started in one has to
 * report back into it rather than into whichever thread is newest when it
 * finishes. The mapping lives on the orchestrator's own record because that
 * is what reads it: the thread list's working state, the running-task cards,
 * and the wake that delivers the outcome.
 */
export async function recordTaskThread({
  orchestratorTaskId,
  sessionId,
  taskId,
}: {
  orchestratorTaskId: TaskId;
  sessionId: StoreId.Session;
  taskId: TaskId;
}): Promise<void> {
  await updateTaskState(taskDir(orchestratorTaskId), (state) => ({
    taskThreads: { ...state.taskThreads, [taskId]: sessionId },
  }));
}

/** Every task the conversation has filed, by the thread it came from. */
export async function taskThreads(
  orchestratorTaskId: TaskId,
): Promise<Record<string, StoreId.Session>> {
  const state = await getTaskState(taskDir(orchestratorTaskId));
  return state.taskThreads ?? {};
}

/** The thread an app was last asked for in, or none for an app nobody asked for. */
export async function threadOfApp({
  orchestratorTaskId,
  slug,
}: {
  orchestratorTaskId: TaskId;
  slug: string;
}): Promise<StoreId.Session | undefined> {
  const state = await getTaskState(taskDir(orchestratorTaskId));
  return state.appThreads?.[slug];
}

/** The thread a task was filed from, or none for a task filed outside a turn. */
export async function threadOfTask({
  orchestratorTaskId,
  taskId,
}: {
  orchestratorTaskId: TaskId;
  taskId: TaskId;
}): Promise<StoreId.Session | undefined> {
  const state = await getTaskState(taskDir(orchestratorTaskId));
  return state.taskThreads?.[taskId];
}
