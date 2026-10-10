import { type ChatTask, listChildTasks } from "../../chat/children";
import { type TaskCommandContext } from "./context";

/**
 * The task of this chat's a command names: by its handle (`t1`), or by its
 * session or its title. A chat's tasks are the chat's alone: a task started
 * in another chat is that chat's to read and steer, since its outcome
 * reports there.
 */
export async function requireChild(
  rawId: string | undefined,
  { chatId }: TaskCommandContext,
): Promise<ChatTask> {
  if (!rawId) {
    throw new Error("a task id (t1) is required. See `task list`.");
  }
  const children = await listChildTasks(chatId);
  const named = rawId.trim().toLowerCase();
  const task =
    children.find((child) => child.handle === named || child.id === rawId) ??
    children.find((child) => child.title.trim().toLowerCase() === named);
  if (!task) {
    // An id is most often mistyped from the title it was given rather than
    // copied from what `new` printed, so the nearest of the chat's own
    // tasks is offered in the same reply, where `task list` costs a turn.
    const nearest = nearestChild(rawId, children);
    throw new Error(
      `no task "${rawId}" of yours.${nearest ? ` Did you mean ${nearest.handle} ("${nearest.title}")?` : ""} See \`task list\`.`,
    );
  }
  return task;
}

/**
 * The task whose title shares the most words with a mistyped id or title,
 * when it shares more than half of them: a guess from the title gets the
 * words right and their order or their tail wrong.
 */
function nearestChild(
  rawId: string,
  children: ChatTask[],
): ChatTask | undefined {
  const words = new Set(
    rawId
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2),
  );
  if (words.size === 0) {
    return undefined;
  }
  let best: undefined | { child: ChatTask; shared: number };
  for (const child of children) {
    const shared = child.title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => words.has(word)).length;
    if (shared > (best?.shared ?? 0)) {
      best = { child, shared };
    }
  }
  return best && best.shared * 2 > words.size ? best.child : undefined;
}
