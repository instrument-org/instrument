import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { taskDir } from "../task-dir-utils";
import { getTaskState, setTaskState } from "../task-record";

/** The channel an app was last asked for in, or none for an app nobody asked for. */
export async function channelOfApp({
  orchestratorTaskId,
  slug,
}: {
  orchestratorTaskId: TaskId;
  slug: string;
}): Promise<StoreId.Session | undefined> {
  const state = await getTaskState(taskDir(orchestratorTaskId));
  return state.appChannels?.[slug];
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

/**
 * Which channel an app was asked for in.
 *
 * A sign-in finishes in the browser and a key is saved on a card, neither of
 * which knows a channel, so the ask records where it was made and the event
 * that answers it is delivered there rather than to whichever channel is
 * newest. Recorded on each ask, so an app asked for again from another
 * channel reports into that one.
 */
export async function recordAppChannel({
  orchestratorTaskId,
  sessionId,
  slug,
}: {
  orchestratorTaskId: TaskId;
  sessionId: StoreId.Session;
  slug: string;
}): Promise<void> {
  const dir = taskDir(orchestratorTaskId);
  const state = await getTaskState(dir);
  await setTaskState(dir, {
    appChannels: { ...state.appChannels, [slug]: sessionId },
  });
}

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

/** Every task the conversation has filed, by the channel it came from. */
export async function taskChannels(
  orchestratorTaskId: TaskId,
): Promise<Record<string, StoreId.Session>> {
  const state = await getTaskState(taskDir(orchestratorTaskId));
  return state.taskChannels ?? {};
}
