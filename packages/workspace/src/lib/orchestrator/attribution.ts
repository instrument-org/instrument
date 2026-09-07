import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { taskDir } from "../task-dir-utils";
import { getTaskState, setTaskState } from "../task-record";

/**
 * Which channel a task was filed from.
 *
 * The conversation is one agent across several channels, so a task started in
 * one has to report back into it rather than into whichever channel is on
 * screen when it finishes. The mapping lives on the orchestrator's own record
 * because that is what reads it: the strip's working dot, the Tasks list's
 * annotation, and the wake that delivers the outcome.
 */
export async function recordTaskChannel({
  orchestratorTaskId,
  sessionId,
  taskId,
}: {
  orchestratorTaskId: TaskId;
  sessionId: StoreId.Session;
  taskId: TaskId;
}): Promise<void> {
  const dir = taskDir(orchestratorTaskId);
  const state = await getTaskState(dir);
  await setTaskState(dir, {
    taskChannels: { ...state.taskChannels, [taskId]: sessionId },
  });
}

/** The channel a task was filed from, or none for a task made before channels. */
export async function channelOfTask({
  orchestratorTaskId,
  taskId,
}: {
  orchestratorTaskId: TaskId;
  taskId: TaskId;
}): Promise<StoreId.Session | undefined> {
  const state = await getTaskState(taskDir(orchestratorTaskId));
  return state.taskChannels?.[taskId];
}

/** Every task the conversation has filed, by the channel it came from. */
export async function taskChannels(
  orchestratorTaskId: TaskId,
): Promise<Record<string, StoreId.Session>> {
  const state = await getTaskState(taskDir(orchestratorTaskId));
  return state.taskChannels ?? {};
}
