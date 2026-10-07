import { type TaskInChat } from "../../../schemas/task";
import { TaskIdSchema } from "../../../schemas/task-id";
import { listChildTasks } from "../../chat/children";
import { getTask } from "../../get-tasks";
import { sessionOfChat } from "../../record-folders";
import { Store } from "../../store";
import { type TaskCommandContext } from "./context";

export async function requireChild(
  rawId: string | undefined,
  { chatId }: TaskCommandContext,
): Promise<TaskInChat> {
  if (!rawId) {
    throw new Error("a task id is required. See `task list`.");
  }
  const parsed = TaskIdSchema.safeParse(rawId);
  if (!parsed.success) {
    throw new Error(`"${rawId}" is not a task id. See \`task list\`.`);
  }
  // Every chat's tasks can be read from any chat; steering one is its own
  // chat's alone (requireOwnChild).
  const task = await getTask(parsed.data);
  if (task.isErr() || task.value.isChat) {
    // An id is most often mistyped from the title it was given rather than
    // copied from what `new` printed, so the nearest of the chat's own
    // tasks is offered in the same reply, where `task list` costs a turn.
    const nearest = nearestChildId(rawId, await listChildTasks(chatId));
    throw new Error(
      `no task "${rawId}" of yours.${nearest ? ` Did you mean "${nearest}"?` : ""} See \`task list\`.`,
    );
  }
  return task.value;
}

/**
 * The task named, and one this chat may act on: a task started in another
 * chat is that chat's to steer, since its outcome reports there and a
 * message sent into it from here would land in a conversation the user is not
 * having. Reading it (`show`, `log`, `list`) stays open to every chat; the
 * refusal says where to go instead.
 */
export async function requireOwnChild(
  rawId: string | undefined,
  context: TaskCommandContext,
): Promise<TaskInChat> {
  const task = await requireChild(rawId, context);
  const filedIn = sessionOfChat(task.chatId);
  if (task.chatId === context.chatId || filedIn === undefined) {
    return task;
  }
  const chat = await Store.getSession(filedIn, task.chatId);
  const named = chat.isOk() ? ` ("${chat.value.title}")` : "";
  throw new Error(
    `"${task.id}" was started in another chat${named}, and is that chat's to steer: you can read it (\`task show\`, \`task log\`) but not send to it, stop it, or change it. Tell the user which chat it is in, or start a task of your own here.`,
  );
}

/**
 * The child whose id shares the most words with a mistyped one, when it
 * shares more than half of them. Words rather than characters, because an id
 * is the date plus the brief's first words, and a guess from the title gets
 * the words right and their order or their tail wrong.
 */
function nearestChildId(
  rawId: string,
  children: TaskInChat[],
): string | undefined {
  const words = new Set(rawId.split("-").filter((word) => word.length > 2));
  if (words.size === 0) {
    return undefined;
  }
  let best: undefined | { id: string; shared: number };
  for (const child of children) {
    const shared = child.id.split("-").filter((word) => words.has(word)).length;
    if (shared > (best?.shared ?? 0)) {
      best = { id: child.id, shared };
    }
  }
  return best && best.shared * 2 > words.size ? best.id : undefined;
}
